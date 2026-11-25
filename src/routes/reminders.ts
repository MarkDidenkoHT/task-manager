import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertRefs, requireSpace } from '../access.js';
import { db, q, q1 } from '../db.js';
import { HttpError, parse, zId, zTime } from '../http.js';
import { addDays, isValidTz, localParts } from '../lib/dates.js';
import { computeStreak, type EventLite } from '../lib/streak.js';
import { getSpace } from './budget.js';

const reminderSchema = z.object({
  kind: z.enum(['workout', 'reading', 'custom', 'pet', 'payment']),
  title: z.string().trim().min(1).max(100),
  local_time: zTime,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  timezone: z.string().refine(isValidTz, 'неизвестный часовой пояс').optional(),
  program_id: zId.nullable().optional(),
  program_day_id: zId.nullable().optional(),
  pet_id: zId.nullable().optional(),
  fixed_cost_id: zId.nullable().optional(),
  active: z.boolean().optional()
});

export interface ReminderRow {
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
  pet_id: string | null;
  fixed_cost_id: string | null;
  active: boolean;
  created_at: string;
}

export async function remindersWithStreaks(spaceId: string, onlyTgId?: number) {
  let query = db().from('reminders').select('*').eq('space_id', spaceId).order('local_time');
  if (onlyTgId) query = query.eq('owner_tg_id', onlyTgId);
  const reminders = await q<ReminderRow[]>(query);
  if (!reminders.length) return [];
  const since = addDays(new Date().toISOString().slice(0, 10), -400);
  const events = await q<(EventLite & { reminder_id: string })[]>(
    db().from('reminder_events').select('reminder_id,due_on,status').in('reminder_id', reminders.map((r) => r.id)).gte('due_on', since)
  );
  return reminders.map((r) => {
    const today = localParts(r.timezone).date;
    const own = events.filter((e) => e.reminder_id === r.id);
    const todayEvent = own.find((e) => e.due_on === today);
    return {
      ...r,
      local_time: r.local_time.slice(0, 5),
      streak: computeStreak(own, r.weekdays, today, localParts(r.timezone, new Date(r.created_at)).date),
      today_status: todayEvent?.status ?? null
    };
  });
}

/** Для workout-напоминания: какой день программы сегодня. */
export async function programDayFor(r: Pick<ReminderRow, 'id' | 'program_id' | 'program_day_id'>) {
  if (!r.program_id) return null;
  const days = await q<{ id: string; day_idx: number; part: string; label: string }[]>(
    db().from('program_days').select('*').eq('program_id', r.program_id).order('day_idx').order('part')
  );
  if (!days.length) return null;
  if (r.program_day_id) return days.find((d) => d.id === r.program_day_id) ?? days[0];
  // Ротация по числу выполненных тренировок.
  const done = await q<{ id: string }[]>(db().from('reminder_events').select('id').eq('reminder_id', r.id).eq('status', 'done'));
  return days[done.length % days.length];
}

export function reminderRoutes(app: FastifyInstance) {
  app.get('/spaces/:sid/reminders', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { mine } = req.query as { mine?: string };
    return remindersWithStreaks(ctx.spaceId, mine === '1' ? ctx.tgId : undefined);
  });

  async function checkRefs(spaceId: string, b: Partial<z.infer<typeof reminderSchema>>) {
    await assertRefs(spaceId, {
      p: { table: 'profiles', id: b.pet_id },
      f: { table: 'fixed_costs', id: b.fixed_cost_id },
      g: { table: 'programs', id: b.program_id }
    });
    if (b.program_day_id) {
      if (!b.program_id) throw new HttpError(400, 'Укажите программу');
      const d = await q<{ id: string }[]>(db().from('program_days').select('id').eq('id', b.program_day_id).eq('program_id', b.program_id));
      if (!d.length) throw new HttpError(400, 'День программы не найден');
    }
  }

  app.post('/spaces/:sid/reminders', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(reminderSchema, req.body);
    await checkRefs(ctx.spaceId, b);
    let tz = b.timezone;
    if (!tz) {
      const m = await q<{ timezone: string | null }[]>(db().from('members').select('timezone').eq('space_id', ctx.spaceId).eq('tg_id', ctx.tgId));
      tz = m[0]?.timezone || (await getSpace(ctx.spaceId)).timezone;
    }
    return q1(db().from('reminders').insert({ ...b, timezone: tz, space_id: ctx.spaceId, owner_tg_id: ctx.tgId }).select().single());
  });

  app.patch('/spaces/:sid/reminders/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    const b = parse(reminderSchema.partial(), req.body);
    await checkRefs(ctx.spaceId, b);
    return q1(db().from('reminders').update(b).eq('id', id).eq('space_id', ctx.spaceId).select().maybeSingle(), 'Напоминание не найдено');
  });

  app.delete('/spaces/:sid/reminders/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    await q(db().from('reminders').delete().eq('id', (req.params as { id: string }).id).eq('space_id', ctx.spaceId));
    return { ok: true };
  });

  /** Отметить сегодняшний день из приложения (без кнопки в боте). */
  app.post('/spaces/:sid/reminders/:id/mark', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    const b = parse(z.object({ status: z.enum(['done', 'skipped']) }), req.body);
    const r = await q1<ReminderRow | null>(db().from('reminders').select('*').eq('id', id).eq('space_id', ctx.spaceId).maybeSingle(), 'Напоминание не найдено');
    const today = localParts(r.timezone).date;
    await q(db().from('reminder_events').upsert({ reminder_id: id, due_on: today, status: b.status, snooze_until: null }, { onConflict: 'reminder_id,due_on' }));
    return { ok: true };
  });
}
