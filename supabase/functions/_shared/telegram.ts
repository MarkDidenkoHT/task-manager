// Общий код Edge Functions: Telegram Bot API, текст напоминаний, серии.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
export const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');

// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase передаёт в функции автоматически.
export const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result as T;
}

/** Секрет вебхука выводится из токена — отдельно хранить не нужно. */
export async function webhookSecret(): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('webhook:' + BOT_TOKEN));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

export const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Даты по часовому поясу ----------

export function localParts(tz: string, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  const wd: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: wd[parts.weekday] ?? 1 };
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isoWeekday = (date: string) => {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
};

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// ---------- Напоминания ----------

export interface Reminder {
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
  active: boolean;
  created_at: string;
}

/** Подряд выполненные запланированные дни, заканчивая сегодня или вчера. */
export async function streak(r: Reminder): Promise<number> {
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

const plural = (n: number, a: string, b: string, c: string) =>
  n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c;

const ICONS: Record<string, string> = { workout: '🏋️', reading: '📖', custom: '⏰', pet: '🐾', payment: '💳' };

export async function reminderText(r: Reminder): Promise<string> {
  const lines: string[] = [];
  const icon = ICONS[r.kind] ?? '⏰';
  if (r.kind === 'workout') {
    lines.push(`${icon} <b>Время тренировки: ${esc(r.title)}</b>`);
    if (r.program_id) {
      const { data: days } = await db.from('program_days').select('id,label,day_idx,part').eq('program_id', r.program_id);
      const order: Record<string, number> = { morning: 0, single: 1, evening: 2 };
      const sorted = (days ?? []).sort((a, b) => a.day_idx - b.day_idx || order[a.part] - order[b.part]);
      let day = sorted.find((d) => d.id === r.program_day_id);
      if (!day && sorted.length) {
        // Ротация: каждый раз следующий день программы.
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

export const reminderKeyboard = (eventId: string) => [[
  { text: '✅ Готово', callback_data: `r:${eventId}:done` },
  { text: '⏰ Через 15 мин', callback_data: `r:${eventId}:snooze` },
  { text: '⏭ Пропустить', callback_data: `r:${eventId}:skip` }
]];
