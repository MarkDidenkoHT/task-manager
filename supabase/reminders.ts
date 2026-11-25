// Edge Function «reminders» — вставьте целиком в Supabase → Edge Functions → Deploy a new function → Via Editor.
// Имя функции: reminders. В настройках функции выключите «Enforce JWT Verification».
// Секрет: Edge Functions → Secrets → BOT_TOKEN = токен от @BotFather.
//
// Один адрес для двух вещей:
//   • вызов от cron (каждую минуту) — отправляет наступившие напоминания;
//   • вызов от Telegram (кнопки «Готово / Через 15 мин / Пропустить», /start) — проверяется секретом вебхука.
// Вебхук бота функция регистрирует сама при запуске.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SELF_URL = `${SUPABASE_URL}/functions/v1/reminders`;
const CATCH_UP_MINUTES = 180; // насколько поздно ещё можно отправить (после сбоя)

const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

interface Reminder {
  id: string;
  space_id: string;
  owner_tg_id: number;
  kind: string;
  title: string;
  local_time: string;
  weekdays: number[];
  timezone: string;
  program_id: string | null;
  program_day_id: string | null;
  fixed_cost_id: string | null;
  created_at: string;
}

// ---------- Telegram ----------

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

// Секрет вебхука выводится из токена — хранить отдельно не нужно.
const webhookSecret = crypto.subtle
  .digest('SHA-256', new TextEncoder().encode('webhook:' + BOT_TOKEN))
  .then((h) => [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48));

// Регистрация вебхука один раз на запуск экземпляра функции.
let webhookReady: Promise<unknown> | null = null;
const ensureWebhook = () =>
  (webhookReady ??= webhookSecret
    .then((secret) => tg('setWebhook', { url: SELF_URL, secret_token: secret, allowed_updates: ['message', 'callback_query'] }))
    .catch((e) => {
      webhookReady = null;
      console.error(e);
    }));

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Даты ----------

function localParts(tz: string, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
    }).formatToParts(at).map((x) => [x.type, x.value])
  );
  const wd: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: wd[p.weekday] ?? 1 };
}

function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isoWeekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay() || 7;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const plural = (n: number, a: string, b: string, c: string) =>
  n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c;

// ---------- Текст напоминания ----------

async function streak(r: Reminder) {
  const today = localParts(r.timezone).date;
  const created = localParts(r.timezone, new Date(r.created_at)).date;
  const { data } = await db.from('reminder_events').select('due_on,status').eq('reminder_id', r.id).gte('due_on', addDays(today, -400));
  const byDay = new Map((data ?? []).map((e) => [e.due_on, e.status]));
  let day = byDay.get(today) === 'done' ? today : addDays(today, -1);
  let n = 0;
  while (day >= created) {
    if (r.weekdays.includes(isoWeekday(day))) {
      if (byDay.get(day) !== 'done') break;
      n++;
    }
    day = addDays(day, -1);
  }
  return n;
}

async function reminderText(r: Reminder) {
  const icon = ({ workout: '🏋️', reading: '📖', pet: '🐾', payment: '💳' } as Record<string, string>)[r.kind] ?? '⏰';
  const lines: string[] = [];
  if (r.kind === 'workout') {
    lines.push(`${icon} <b>Время тренировки: ${esc(r.title)}</b>`);
    if (r.program_id) {
      const { data: days } = await db.from('program_days').select('id,label,day_idx,part').eq('program_id', r.program_id);
      const order: Record<string, number> = { morning: 0, single: 1, evening: 2 };
      const sorted = (days ?? []).sort((a, b) => a.day_idx - b.day_idx || order[a.part] - order[b.part]);
      let day = sorted.find((d) => d.id === r.program_day_id);
      if (!day && sorted.length) {
        // Каждый раз следующий день программы.
        const { count } = await db.from('reminder_events').select('id', { count: 'exact', head: true }).eq('reminder_id', r.id).eq('status', 'done');
        day = sorted[(count ?? 0) % sorted.length];
      }
      if (day) {
        lines.push(esc(day.label));
        const { data: ex } = await db
          .from('program_exercises')
          .select('position,sets,target_reps,load_kg,exercises(name,kind)')
          .eq('program_day_id', day.id)
          .order('position');
        (ex ?? []).forEach((e: any, i: number) => {
          const unit = e.exercises?.kind === 'timed' ? ' с' : '';
          const load = Number(e.load_kg) > 0 ? ` @ ${String(Number(e.load_kg)).replace('.', ',')} кг` : '';
          lines.push(`${i + 1}. ${esc(e.exercises?.name ?? '')} ${e.sets}×${e.target_reps}${unit}${load}`);
        });
      }
    }
  } else {
    lines.push(`${icon} <b>${esc(r.title)}</b>`);
    if (r.kind === 'payment' && r.fixed_cost_id) {
      const { data: fc } = await db.from('fixed_costs').select('name,amount_minor').eq('id', r.fixed_cost_id).maybeSingle();
      if (fc) lines.push(`${esc(fc.name)}: ${new Intl.NumberFormat('ru-RU').format(Math.round(Number(fc.amount_minor) / 100))} ₽`);
    }
  }
  const s = await streak(r);
  if (s > 0) lines.push(`\n🔥 Серия: ${s} ${plural(s, 'день', 'дня', 'дней')}`);
  return lines.join('\n');
}

// ---------- Отправка (вызов от cron) ----------

async function send(r: Reminder, eventId: string) {
  await tg('sendMessage', {
    chat_id: r.owner_tg_id,
    text: await reminderText(r),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Готово', callback_data: `r:${eventId}:done` },
        { text: '⏰ Через 15 мин', callback_data: `r:${eventId}:snooze` },
        { text: '⏭ Пропустить', callback_data: `r:${eventId}:skip` }
      ]]
    }
  });
  await db.from('reminder_events').update({ status: 'sent', sent_at: new Date().toISOString(), snooze_until: null }).eq('id', eventId);
}

async function sendDue() {
  const now = new Date();
  const { data, error } = await db.from('reminders').select('*').eq('active', true);
  if (error) throw error;
  const reminders = (data ?? []) as Reminder[];
  let sent = 0;

  for (const r of reminders) {
    const lp = localParts(r.timezone, now);
    const at = toMinutes(r.local_time);
    if (!r.weekdays.includes(lp.weekday) || at > lp.minutes || lp.minutes - at > CATCH_UP_MINUTES) continue;
    if (lp.date < localParts(r.timezone, new Date(r.created_at)).date) continue;
    // Уникальный ключ (reminder_id, due_on): одно напоминание в день, даже при повторных вызовах.
    const { data: ins } = await db
      .from('reminder_events')
      .upsert({ reminder_id: r.id, due_on: lp.date, status: 'pending' }, { onConflict: 'reminder_id,due_on', ignoreDuplicates: true })
      .select('id');
    if (!ins?.length) continue;
    try {
      await send(r, ins[0].id);
      sent++;
    } catch (e) {
      console.error(r.id, e); // останется pending — повторим на следующем запуске
    }
  }

  // Отложенные «на 15 минут» и недоставленные сегодня.
  const { data: due } = await db
    .from('reminder_events')
    .select('id,reminder_id,status,due_on')
    .or(`and(status.eq.snoozed,snooze_until.lte.${now.toISOString()}),and(status.eq.pending,sent_at.is.null)`)
    .limit(200);
  const byId = new Map(reminders.map((r) => [r.id, r]));
  for (const ev of due ?? []) {
    const r = byId.get(ev.reminder_id);
    if (!r) continue;
    if (ev.status === 'pending') {
      const lp = localParts(r.timezone, now);
      if (ev.due_on !== lp.date || lp.minutes - toMinutes(r.local_time) > CATCH_UP_MINUTES) continue;
    }
    try {
      await send(r, ev.id);
      sent++;
    } catch (e) {
      console.error(ev.id, e);
    }
  }
  return sent;
}

// ---------- Кнопки и /start (вызов от Telegram) ----------

const ACTIONS: Record<string, { status: string; text: string }> = {
  done: { status: 'done', text: '✅ Выполнено' },
  snooze: { status: 'snoozed', text: '⏰ Напомню через 15 минут' },
  skip: { status: 'skipped', text: '⏭ Пропущено' }
};

async function onCallback(cq: any) {
  const m = /^r:([0-9a-f-]{36}):(done|snooze|skip)$/.exec(cq.data ?? '');
  if (!m) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  const [, eventId, action] = m;

  const { data: ev } = await db.from('reminder_events').select('reminder_id').eq('id', eventId).maybeSingle();
  const { data: r } = ev ? await db.from('reminders').select('*').eq('id', ev.reminder_id).maybeSingle() : { data: null };
  if (!r) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Напоминание не найдено' });

  // Нажимать может только участник пространства с правом записи.
  const { data: member } = await db.from('members').select('role').eq('space_id', r.space_id).eq('tg_id', cq.from.id).maybeSingle();
  if (!member || member.role === 'viewer') {
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Нет доступа', show_alert: true });
  }

  const a = ACTIONS[action];
  await db
    .from('reminder_events')
    .update({ status: a.status, snooze_until: action === 'snooze' ? new Date(Date.now() + 15 * 60_000).toISOString() : null })
    .eq('id', eventId);

  if (cq.message) {
    await tg('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: `${await reminderText(r)}\n\n<i>${a.text}</i>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    }).catch(() => undefined);
  }
  return tg('answerCallbackQuery', { callback_query_id: cq.id, text: a.text });
}

async function onMessage(msg: any) {
  const text: string = msg.text ?? '';
  if (msg.chat?.type !== 'private' || !text.startsWith('/start')) return;
  await tg('sendMessage', {
    chat_id: msg.chat.id,
    text:
      '👋 Я — планировщик жизни: бюджет, питание, тренировки и напоминания.\n\n' +
      'Откройте приложение кнопкой меню внизу. Напоминания будут приходить сюда, в этот чат.'
  });
}

// ---------- Точка входа ----------

Deno.serve(async (req) => {
  if (!BOT_TOKEN) return new Response('Не задан секрет BOT_TOKEN', { status: 500 });
  ensureWebhook();

  const tgSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (tgSecret !== null) {
    if (tgSecret !== (await webhookSecret)) return new Response('unauthorized', { status: 401 });
    try {
      const update = await req.json();
      if (update.callback_query) await onCallback(update.callback_query);
      else if (update.message) await onMessage(update.message);
    } catch (e) {
      console.error(e);
    }
    return new Response('ok'); // всегда 200, чтобы Telegram не повторял
  }

  // Вызов от cron. Повторные вызовы безопасны: каждое напоминание уходит один раз в день.
  try {
    await ensureWebhook();
    return Response.json({ sent: await sendDue() });
  } catch (e) {
    console.error(e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
