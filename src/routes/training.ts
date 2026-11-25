import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertInSpace, programExerciseSpace, requireSpace } from '../access.js';
import { config } from '../config.js';
import { db, q, q1 } from '../db.js';
import { HttpError, parse, zDate, zId } from '../http.js';
import { localParts } from '../lib/dates.js';
import { suggestNext, type LoggedSet, type ProgramExercise } from '../lib/progression.js';
import { getSpace } from './budget.js';

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['reps', 'timed']).optional(),
  level: z.enum(['beginner', 'intermediate', 'expert']).nullable().optional(),
  equipment: z.array(z.string().max(40)).max(10).optional(),
  primary_muscles: z.array(z.string().max(40)).max(10).optional(),
  instructions: z.string().max(3000).nullable().optional()
});

const peSchema = z.object({
  exercise_id: zId,
  sets: z.number().int().min(1).max(20),
  target_reps: z.number().int().min(1).max(1000),
  load_kg: z.number().min(0).max(1000).optional(),
  rep_ceiling: z.number().int().min(1).max(1000).optional(),
  load_step_kg: z.number().min(0).max(100).optional(),
  rep_step: z.number().int().min(1).max(100).optional(),
  position: z.number().int().min(0).max(100).optional()
});

const daySchema = z.object({
  label: z.string().trim().min(1).max(60),
  part: z.enum(['single', 'morning', 'evening']).optional(),
  day_idx: z.number().int().min(1).max(14).optional()
});

const programSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).nullable().optional(),
  minutes_per_session: z.number().int().min(1).max(300),
  sessions_per_week: z.number().int().min(1).max(14),
  goal: z.string().max(80).nullable().optional(),
  equipment: z.array(z.string().max(40)).max(10).optional()
});

const PROGRAM_SELECT = '*, program_days(*, program_exercises(*, exercises(id,name,name_en,kind,equipment,primary_muscles,image_paths,instructions)))';

function imageUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${config.supabaseUrl}/storage/v1/object/public/${path.replace(/^\//, '')}`;
}

type ExerciseRow = { id: string; image_paths?: string[] } & Record<string, unknown>;
function withImages<T extends ExerciseRow>(e: T): T & { images: string[] } {
  return { ...e, images: (e.image_paths ?? []).map(imageUrl) };
}

interface ProgramFull {
  id: string;
  space_id: string | null;
  program_days: {
    id: string;
    day_idx: number;
    part: string;
    label: string;
    program_exercises: (ProgramExercise & { id: string; position: number; exercise_id: string; exercises: ExerciseRow & { kind: string } })[];
  }[];
}

function sortProgram<T extends ProgramFull>(p: T): T {
  const partOrder: Record<string, number> = { morning: 0, single: 1, evening: 2 };
  p.program_days.sort((a, b) => a.day_idx - b.day_idx || partOrder[a.part] - partOrder[b.part]);
  for (const d of p.program_days) {
    d.program_exercises.sort((a, b) => a.position - b.position);
    for (const pe of d.program_exercises) if (pe.exercises) pe.exercises = withImages(pe.exercises);
  }
  return p;
}

async function lastSession(peId: string, tgId: number) {
  const latest = await q<{ performed_on: string }[]>(
    db().from('workout_logs').select('performed_on').eq('program_exercise_id', peId).eq('tg_id', tgId).order('performed_on', { ascending: false }).limit(1)
  );
  if (!latest.length) return null;
  const sets = await q<LoggedSet[]>(
    db().from('workout_logs').select('set_no,reps,load_kg').eq('program_exercise_id', peId).eq('tg_id', tgId).eq('performed_on', latest[0].performed_on).order('set_no')
  );
  return { performed_on: latest[0].performed_on, sets: sets.map((s) => ({ ...s, load_kg: Number(s.load_kg) })) };
}

async function requirePe(req: Parameters<typeof requireSpace>[0], need: 'read' | 'write') {
  const ctx = await requireSpace(req, need);
  const { peId } = req.params as { peId: string };
  const { spaceId } = await programExerciseSpace(peId);
  if (spaceId !== ctx.spaceId) throw new HttpError(404, 'Упражнение программы не найдено');
  const pe = await q1<(ProgramExercise & { id: string; exercises: { kind: string } }) | null>(
    db().from('program_exercises').select('*, exercises(kind)').eq('id', peId).maybeSingle()
  );
  return { ctx, pe };
}

async function copyProgram(src: ProgramFull & Record<string, unknown>, spaceId: string, tgId: number) {
  const prog = await q1<{ id: string }>(
    db()
      .from('programs')
      .insert({
        space_id: spaceId,
        owner_tg_id: tgId,
        name: src.name,
        description: src.description,
        minutes_per_session: src.minutes_per_session,
        sessions_per_week: src.sessions_per_week,
        is_template: false,
        audience: src.audience,
        goal: src.goal,
        equipment: src.equipment,
        template_id: src.is_template ? src.id : src.template_id
      })
      .select('id')
      .single()
  );
  for (const d of src.program_days) {
    const day = await q1<{ id: string }>(db().from('program_days').insert({ program_id: prog.id, day_idx: d.day_idx, part: d.part, label: d.label }).select('id').single());
    if (d.program_exercises.length) {
      await q(
        db()
          .from('program_exercises')
          .insert(
            d.program_exercises.map((pe) => ({
              program_day_id: day.id,
              exercise_id: pe.exercise_id,
              position: pe.position,
              sets: pe.sets,
              target_reps: pe.target_reps,
              load_kg: pe.load_kg,
              rep_ceiling: pe.rep_ceiling,
              load_step_kg: pe.load_step_kg,
              rep_step: pe.rep_step
            }))
          )
      );
    }
  }
  return prog;
}

export function trainingRoutes(app: FastifyInstance) {
  // ---------- Библиотека ----------

  app.get('/spaces/:sid/exercises', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { q: text, muscle, equipment, level } = req.query as Record<string, string | undefined>;
    let query = db().from('exercises').select('*').or(`space_id.is.null,space_id.eq.${ctx.spaceId}`);
    const clean = (text ?? '').replace(/[%,()*\\]/g, ' ').trim();
    if (clean) query = query.or(`name.ilike.%${clean}%,name_en.ilike.%${clean}%`);
    if (muscle) query = query.contains('primary_muscles', [muscle]);
    if (equipment) query = query.contains('equipment', [equipment]);
    if (level) query = query.eq('level', level);
    const rows = await q<ExerciseRow[]>(query.order('source').order('name').limit(150));
    return rows.map(withImages);
  });

  app.get('/spaces/:sid/exercises/:id', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { id } = req.params as { id: string };
    const row = await q1<ExerciseRow | null>(
      db().from('exercises').select('*').eq('id', id).or(`space_id.is.null,space_id.eq.${ctx.spaceId}`).maybeSingle(),
      'Упражнение не найдено'
    );
    return withImages(row);
  });

  app.post('/spaces/:sid/exercises', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(exerciseSchema, req.body);
    return q1(db().from('exercises').insert({ ...b, space_id: ctx.spaceId, source: 'custom' }).select().single());
  });

  app.delete('/spaces/:sid/exercises/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    await q(db().from('exercises').delete().eq('id', (req.params as { id: string }).id).eq('space_id', ctx.spaceId));
    return { ok: true };
  });

  // ---------- Шаблоны ----------

  app.get('/program-templates', async (req) => {
    const { audience, equipment, minutes } = req.query as Record<string, string | undefined>;
    let query = db().from('programs').select(PROGRAM_SELECT).eq('is_template', true).is('space_id', null);
    if (audience && audience !== 'all') query = query.eq('audience', audience);
    let rows = (await q<(ProgramFull & { equipment: string[]; minutes_per_session: number })[]>(query.order('minutes_per_session'))).map(sortProgram);
    if (equipment === 'none') rows = rows.filter((r) => r.equipment.length === 0);
    else if (equipment) rows = rows.filter((r) => r.equipment.includes(equipment));
    if (minutes) rows = rows.filter((r) => r.minutes_per_session <= Number(minutes));
    return rows;
  });

  app.post('/spaces/:sid/program-templates/:id/use', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    const tpl = await q1<(ProgramFull & Record<string, unknown>) | null>(
      db().from('programs').select(PROGRAM_SELECT).eq('id', id).eq('is_template', true).maybeSingle(),
      'Шаблон не найден'
    );
    return copyProgram(tpl, ctx.spaceId, ctx.tgId);
  });

  // ---------- Мои программы ----------

  app.get('/spaces/:sid/programs', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const rows = await q<ProgramFull[]>(
      db().from('programs').select(PROGRAM_SELECT).eq('space_id', ctx.spaceId).order('created_at', { ascending: false })
    );
    return rows.map(sortProgram);
  });

  app.get('/spaces/:sid/programs/:id', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { id } = req.params as { id: string };
    const p = sortProgram(
      await q1<ProgramFull | null>(db().from('programs').select(PROGRAM_SELECT).eq('id', id).eq('space_id', ctx.spaceId).maybeSingle(), 'Программа не найдена')
    );
    // Последняя сессия и подсказка по каждому упражнению.
    const days = await Promise.all(
      p.program_days.map(async (d) => ({
        ...d,
        program_exercises: await Promise.all(
          d.program_exercises.map(async (pe) => {
            const last = await lastSession(pe.id, ctx.tgId);
            return { ...pe, last, suggestion: last ? suggestNext(pe, last.sets, pe.exercises?.kind === 'timed') : null };
          })
        )
      }))
    );
    return { ...p, program_days: days };
  });

  app.post('/spaces/:sid/programs', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(programSchema.extend({ days: z.array(daySchema).max(14).optional() }), req.body);
    const { days, ...rest } = b;
    const prog = await q1<{ id: string }>(db().from('programs').insert({ ...rest, space_id: ctx.spaceId, owner_tg_id: ctx.tgId }).select('id').single());
    const list = days?.length ? days : [{ label: 'День 1', part: 'single' as const, day_idx: 1 }];
    await q(db().from('program_days').insert(list.map((d, i) => ({ program_id: prog.id, label: d.label, part: d.part ?? 'single', day_idx: d.day_idx ?? i + 1 }))));
    return prog;
  });

  app.post('/spaces/:sid/programs/:id/copy', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    const src = await q1<(ProgramFull & Record<string, unknown>) | null>(
      db().from('programs').select(PROGRAM_SELECT).eq('id', id).eq('space_id', ctx.spaceId).maybeSingle(),
      'Программа не найдена'
    );
    return copyProgram({ ...src, name: `${src.name} (копия)` }, ctx.spaceId, ctx.tgId);
  });

  app.patch('/spaces/:sid/programs/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(programSchema.partial(), req.body);
    return q1(db().from('programs').update(b).eq('id', (req.params as { id: string }).id).eq('space_id', ctx.spaceId).select().maybeSingle(), 'Программа не найдена');
  });

  app.delete('/spaces/:sid/programs/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    await q(db().from('programs').delete().eq('id', (req.params as { id: string }).id).eq('space_id', ctx.spaceId));
    return { ok: true };
  });

  app.post('/spaces/:sid/programs/:id/days', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    await assertInSpace('programs', id, ctx.spaceId, 'Программа');
    const b = parse(daySchema, req.body);
    const existing = await q<{ day_idx: number }[]>(db().from('program_days').select('day_idx').eq('program_id', id));
    const idx = b.day_idx ?? Math.max(0, ...existing.map((d) => d.day_idx)) + 1;
    return q1(db().from('program_days').insert({ program_id: id, label: b.label, part: b.part ?? 'single', day_idx: idx }).select().single());
  });

  async function requireDay(spaceId: string, programId: string, dayId: string) {
    await assertInSpace('programs', programId, spaceId, 'Программа');
    const d = await q<{ id: string }[]>(db().from('program_days').select('id').eq('id', dayId).eq('program_id', programId));
    if (!d.length) throw new HttpError(404, 'День не найден');
  }

  app.patch('/spaces/:sid/programs/:id/days/:dayId', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id, dayId } = req.params as { id: string; dayId: string };
    await requireDay(ctx.spaceId, id, dayId);
    const b = parse(daySchema.partial(), req.body);
    return q1(db().from('program_days').update(b).eq('id', dayId).select().single());
  });

  app.delete('/spaces/:sid/programs/:id/days/:dayId', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id, dayId } = req.params as { id: string; dayId: string };
    await requireDay(ctx.spaceId, id, dayId);
    await q(db().from('program_days').delete().eq('id', dayId));
    return { ok: true };
  });

  app.post('/spaces/:sid/programs/:id/days/:dayId/exercises', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id, dayId } = req.params as { id: string; dayId: string };
    await requireDay(ctx.spaceId, id, dayId);
    const b = parse(peSchema, req.body);
    const ex = await q<{ id: string; kind: string }[]>(
      db().from('exercises').select('id,kind').eq('id', b.exercise_id).or(`space_id.is.null,space_id.eq.${ctx.spaceId}`)
    );
    if (!ex.length) throw new HttpError(404, 'Упражнение не найдено');
    const timed = ex[0].kind === 'timed';
    const existing = await q<{ position: number }[]>(db().from('program_exercises').select('position').eq('program_day_id', dayId));
    return q1(
      db()
        .from('program_exercises')
        .insert({
          program_day_id: dayId,
          exercise_id: b.exercise_id,
          position: b.position ?? Math.max(0, ...existing.map((e) => e.position)) + 1,
          sets: b.sets,
          target_reps: b.target_reps,
          load_kg: b.load_kg ?? 0,
          rep_ceiling: b.rep_ceiling ?? b.target_reps + (timed ? 30 : 5),
          load_step_kg: b.load_step_kg ?? ((b.load_kg ?? 0) > 0 ? 1 : 0),
          rep_step: b.rep_step ?? (timed ? 5 : 1)
        })
        .select()
        .single()
    );
  });

  app.patch('/spaces/:sid/program-exercises/:peId', async (req) => {
    await requirePe(req, 'write');
    const b = parse(peSchema.omit({ exercise_id: true }).partial(), req.body);
    return q1(db().from('program_exercises').update(b).eq('id', (req.params as { peId: string }).peId).select().single());
  });

  app.delete('/spaces/:sid/program-exercises/:peId', async (req) => {
    await requirePe(req, 'write');
    await q(db().from('program_exercises').delete().eq('id', (req.params as { peId: string }).peId));
    return { ok: true };
  });

  // ---------- Журнал и прогрессия ----------

  app.post('/spaces/:sid/program-exercises/:peId/log', async (req) => {
    const { ctx, pe } = await requirePe(req, 'write');
    const b = parse(
      z.object({
        performed_on: zDate.optional(),
        sets: z.array(z.object({ reps: z.number().int().min(0).max(1000), load_kg: z.number().min(0).max(1000).optional() })).min(1).max(20)
      }),
      req.body
    );
    const space = await getSpace(ctx.spaceId);
    const date = b.performed_on ?? localParts(space.timezone).date;
    await q(db().from('workout_logs').delete().eq('program_exercise_id', pe.id).eq('tg_id', ctx.tgId).eq('performed_on', date));
    const rows = b.sets.map((s, i) => ({ program_exercise_id: pe.id, tg_id: ctx.tgId, performed_on: date, set_no: i + 1, reps: s.reps, load_kg: s.load_kg ?? pe.load_kg }));
    await q(db().from('workout_logs').insert(rows));
    return { ok: true, suggestion: suggestNext(pe, rows.map((r) => ({ set_no: r.set_no, reps: r.reps, load_kg: Number(r.load_kg) })), pe.exercises?.kind === 'timed') };
  });

  app.get('/spaces/:sid/program-exercises/:peId/suggestion', async (req) => {
    const { ctx, pe } = await requirePe(req, 'read');
    const last = await lastSession(pe.id, ctx.tgId);
    return { last, suggestion: last ? suggestNext(pe, last.sets, pe.exercises?.kind === 'timed') : null };
  });

  app.post('/spaces/:sid/program-exercises/:peId/accept', async (req) => {
    const { ctx, pe } = await requirePe(req, 'write');
    const last = await lastSession(pe.id, ctx.tgId);
    if (!last) throw new HttpError(400, 'Нет записанных подходов');
    const s = suggestNext(pe, last.sets, pe.exercises?.kind === 'timed');
    return q1(
      db().from('program_exercises').update({ target_reps: s.target_reps, load_kg: s.load_kg, rep_ceiling: s.rep_ceiling }).eq('id', pe.id).select().single()
    );
  });

  app.get('/spaces/:sid/programs/:id/history', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { id } = req.params as { id: string };
    const p = await q1<ProgramFull | null>(db().from('programs').select(PROGRAM_SELECT).eq('id', id).eq('space_id', ctx.spaceId).maybeSingle(), 'Программа не найдена');
    const peIds = p.program_days.flatMap((d) => d.program_exercises.map((e) => e.id));
    if (!peIds.length) return [];
    const logs = await q<{ program_exercise_id: string; performed_on: string; set_no: number; reps: number; load_kg: number }[]>(
      db().from('workout_logs').select('*').in('program_exercise_id', peIds).eq('tg_id', ctx.tgId).order('performed_on', { ascending: false }).limit(500)
    );
    const byDate = new Map<string, typeof logs>();
    for (const l of logs) byDate.set(l.performed_on, [...(byDate.get(l.performed_on) ?? []), l]);
    return [...byDate.entries()].slice(0, 30).map(([date, sets]) => ({ date, sets }));
  });
}
