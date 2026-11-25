import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { db, q } from './db.js';
import { addDays, localParts, timeToMinutes } from './lib/dates.js';
import { computeStreak, type EventLite } from './lib/streak.js';
import { programDayFor, type ReminderRow } from './routes/reminders.js';

type InlineButton = { text: string; callback_data?: string; web_app?: { url: string } };

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

function appButton(text: string, path = ''): InlineButton | null {
  if (!config.publicUrl) return null;
  return { text, web_app: { url: `${config.publicUrl}/${path}` } };
}

const ICONS: Record<string, string> = { workout: '🏋️', reading: '📖', custom: '⏰', pet: '🐾', payment: '💳' };

const fmtNum = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
const rub = (minor: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(minor / 100)) + ' ₽';

async function reminderText(r: ReminderRow): Promise<string> {
  const icon = ICONS[r.kind] ?? '⏰';
  const lines: string[] = [];
  if (r.kind === 'workout') {
    lines.push(`${icon} <b>Время тренировки: ${esc(r.title)}</b>`);
    const day = await programDayFor(r);
    if (day) {
      const ex = await q<{ position: number; sets: number; target_reps: number; load_kg: number; exercises: { name: string; kind: string } }[]>(
        db().from('program_exercises').select('position,sets,target_reps,load_kg,exercises(name,kind)').eq('program_day_id', day.id).order('position')
      );
      if (day.label) lines.push(esc(day.label));
      ex.forEach((e, i) => {
        const unit = e.exercises?.kind === 'timed' ? ' с' : '';
        const load = Number(e.load_kg) > 0 ? ` @ ${fmtNum(Number(e.load_kg))} кг` : '';
        lines.push(`${i + 1}. ${esc(e.exercises?.name ?? '')} ${e.sets}×${e.target_reps}${unit}${load}`);
      });
    }
  } else if (r.kind === 'payment' && r.fixed_cost_id) {
    const fc = await q<{ name: string; amount_minor: number }[]>(db().from('fixed_costs').select('name,amount_minor').eq('id', r.fixed_cost_id));
    lines.push(`${icon} <b>${esc(r.title)}</b>`);
    if (fc[0]) lines.push(`${esc(fc[0].name)}: ${rub(Number(fc[0].amount_minor))}`);
  } else {
    lines.push(`${icon} <b>${esc(r.title)}</b>`);
  }

  const events = await q<EventLite[]>(db().from('reminder_events').select('due_on,status').eq('reminder_id', r.id).gte('due_on', addDays(localParts(r.timezone).date, -400)));
  const streak = computeStreak(events, r.weekdays, localParts(r.timezone).date, localParts(r.timezone, new Date(r.created_at)).date);
  if (streak > 0) lines.push(`\n🔥 Серия: ${streak} ${plural(streak, 'день', 'дня', 'дней')}`);
  return lines.join('\n');
}

function keyboard(eventId: string): InlineButton[][] {
  return [
    [
      { text: '✅ Готово', callback_data: `r:${eventId}:done` },
      { text: '⏰ Через 15 мин', callback_data: `r:${eventId}:snooze` },
      { text: '⏭ Пропустить', callback_data: `r:${eventId}:skip` }
    ]
  ];
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendReminder(r: ReminderRow, eventId: string): Promise<void> {
  const text = await reminderText(r);
  const msg = await tg<{ message_id: number }>('sendMessage', {
    chat_id: r.owner_tg_id,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard(eventId) }
  });
  await q(
    db().from('reminder_events').update({ status: 'sent', sent_at: new Date().toISOString(), snooze_until: null, message_id: msg.message_id }).eq('id', eventId)
  );
}

/** Окно, в течение которого пропущенное (например, из-за простоя) напоминание ещё отправляется. */
const CATCH_UP_MINUTES = 180;

export async function runTick(log: { error: (o: unknown) => void }) {
  const now = new Date();
  const reminders = await q<ReminderRow[]>(db().from('reminders').select('*').eq('active', true));
  let sent = 0;

  for (const r of reminders) {
    try {
      const lp = localParts(r.timezone, now);
      if (!r.weekdays.includes(lp.weekday)) continue;
      const at = timeToMinutes(r.local_time);
      if (at > lp.minutes || lp.minutes - at > CATCH_UP_MINUTES) continue;
      if (lp.date < localParts(r.timezone, new Date(r.created_at)).date) continue;
      // Уникальный ключ (reminder_id, due_on) делает тик идемпотентным.
      const inserted = await q<{ id: string }[]>(
        db().from('reminder_events').upsert({ reminder_id: r.id, due_on: lp.date, status: 'pending' }, { onConflict: 'reminder_id,due_on', ignoreDuplicates: true }).select('id')
      );
      if (inserted.length) {
        await sendReminder(r, inserted[0].id);
        sent++;
      }
    } catch (e) {
      log.error({ reminder: r.id, err: String(e) });
    }
  }

  // Повтор: отложенные, срок которых наступил, и не доставленные из-за ошибки.
  const due = await q<{ id: string; reminder_id: string; status: string; sent_at: string | null; due_on: string }[]>(
    db()
      .from('reminder_events')
      .select('id,reminder_id,status,sent_at,due_on')
      .or(`and(status.eq.snoozed,snooze_until.lte.${now.toISOString()}),and(status.eq.pending,sent_at.is.null)`)
      .gte('due_on', addDays(now.toISOString().slice(0, 10), -1))
      .limit(200)
  );
  const byId = new Map(reminders.map((r) => [r.id, r]));
  for (const ev of due) {
    const r = byId.get(ev.reminder_id);
    if (!r) continue;
    try {
      // Для повторной отправки «зависших» pending — только в пределах окна догоняния.
      if (ev.status === 'pending') {
        const lp = localParts(r.timezone, now);
        if (ev.due_on !== lp.date || lp.minutes - timeToMinutes(r.local_time) > CATCH_UP_MINUTES) continue;
      }
      await sendReminder(r, ev.id);
      sent++;
    } catch (e) {
      log.error({ event: ev.id, err: String(e) });
    }
  }
  return { sent };
}

interface Update {
  message?: { chat: { id: number; type: string }; from?: { id: number; first_name?: string }; text?: string };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { chat: { id: number }; message_id: number; text?: string };
  };
}

const STATUS_TEXT: Record<string, string> = {
  done: '✅ Выполнено',
  snooze: '⏰ Напомню через 15 минут',
  skip: '⏭ Пропущено'
};

async function handleCallback(cb: NonNullable<Update['callback_query']>) {
  const m = /^r:([0-9a-f-]{36}):(done|snooze|skip)$/.exec(cb.data ?? '');
  if (!m) return tg('answerCallbackQuery', { callback_query_id: cb.id });
  const [, eventId, action] = m;

  const events = await q<{ id: string; reminder_id: string; status: string }[]>(db().from('reminder_events').select('id,reminder_id,status').eq('id', eventId));
  const ev = events[0];
  if (!ev) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Напоминание не найдено' });
  const rem = (await q<ReminderRow[]>(db().from('reminders').select('*').eq('id', ev.reminder_id)))[0];
  if (!rem) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Напоминание удалено' });

  // Нажимающий должен быть участником пространства (и не только наблюдателем).
  const member = await q<{ role: string }[]>(db().from('members').select('role').eq('space_id', rem.space_id).eq('tg_id', cb.from.id));
  if (!member.length || member[0].role === 'viewer') {
    return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Нет доступа', show_alert: true });
  }

  const patch =
    action === 'done'
      ? { status: 'done', snooze_until: null }
      : action === 'skip'
        ? { status: 'skipped', snooze_until: null }
        : { status: 'snoozed', snooze_until: new Date(Date.now() + 15 * 60_000).toISOString() };
  await q(db().from('reminder_events').update(patch).eq('id', eventId));

  if (cb.message) {
    const buttons: InlineButton[][] = [];
    if (action === 'done' && rem.kind === 'workout') {
      const b = appButton('📝 Открыть и записать подходы', rem.program_id ? `#/growth/program/${rem.program_id}` : '#/growth');
      if (b) buttons.push([b]);
    }
    const base = await reminderText(rem).catch(() => cb.message?.text ?? '');
    await tg('editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: `${base}\n\n<i>${STATUS_TEXT[action]}</i>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => undefined);
  }
  return tg('answerCallbackQuery', { callback_query_id: cb.id, text: STATUS_TEXT[action] });
}

async function handleMessage(msg: NonNullable<Update['message']>) {
  const text = msg.text ?? '';
  if (msg.chat.type !== 'private') return;
  if (text.startsWith('/start') || text.startsWith('/help')) {
    const b = appButton('Открыть планировщик');
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text:
        `Привет${msg.from?.first_name ? ', ' + esc(msg.from.first_name) : ''}! 👋\n\n` +
        'Я — планировщик жизни: бюджет, питание с ценами по магазинам, тренировки и напоминания в одном месте.\n\n' +
        'Откройте приложение кнопкой ниже. Напоминания будут приходить сюда, в этот чат.',
      parse_mode: 'HTML',
      reply_markup: b ? { inline_keyboard: [[b]] } : undefined
    });
  }
}

export function botRoutes(app: FastifyInstance) {
  app.post('/bot', async (req, reply) => {
    if (config.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    const update = req.body as Update;
    try {
      if (update.callback_query) await handleCallback(update.callback_query);
      else if (update.message) await handleMessage(update.message);
    } catch (e) {
      req.log.error(e);
    }
    return { ok: true }; // Telegram не должен повторять обновление
  });

  app.post('/internal/tick', async (req, reply) => {
    if (!config.tickSecret || req.headers['x-tick-secret'] !== config.tickSecret) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    return runTick(req.log);
  });
}
