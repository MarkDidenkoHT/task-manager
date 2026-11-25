import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertInSpace, requireSpace } from '../access.js';
import { db, q } from '../db.js';
import { HttpError, parse, zDate } from '../http.js';
import { localParts } from '../lib/dates.js';
import { computeTargets, type ProfileBody } from '../lib/targets.js';
import { getSpace } from './budget.js';
import { crud } from './crud.js';

const profileSchema = z.object({
  kind: z.enum(['adult', 'child', 'pet']),
  name: z.string().trim().min(1).max(60),
  tg_id: z.number().int().nullable().optional(),
  sex: z.enum(['m', 'f']).nullable().optional(),
  birth_date: zDate.nullable().optional(),
  height_cm: z.number().min(40).max(250).nullable().optional(),
  weight_kg: z.number().min(2).max(400).nullable().optional(),
  activity: z.number().min(1).max(2.5).nullable().optional(),
  goal_offset_kcal: z.number().int().min(-2000).max(2000).optional(),
  kcal_override: z.number().int().min(300).max(8000).nullable().optional(),
  meals_per_day: z.number().int().min(1).max(6).optional(),
  protein_g_per_kg: z.number().min(0.5).max(4).nullable().optional(),
  fat_g_per_kg: z.number().min(0.3).max(3).nullable().optional(),
  species: z.string().trim().max(60).nullable().optional(),
  active: z.boolean().optional()
});

export function withTargets<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((r) => ({ ...r, targets: computeTargets(r as unknown as ProfileBody) }));
}

export function peopleRoutes(app: FastifyInstance) {
  crud(app, {
    path: 'profiles',
    table: 'profiles',
    create: profileSchema,
    order: { column: 'created_at' },
    validate: (b, ctx) => {
      // Привязать профиль к Telegram-аккаунту можно только к своему.
      if (b.tg_id != null && b.tg_id !== ctx.tgId) throw new HttpError(400, 'Можно привязать только свой профиль');
    },
    decorate: (rows) => withTargets(rows)
  });

  app.get('/spaces/:sid/profiles/:id/weight', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { id } = req.params as { id: string };
    await assertInSpace('profiles', id, ctx.spaceId, 'Профиль');
    return q(db().from('weight_log').select('*').eq('profile_id', id).order('logged_on', { ascending: true }).limit(365));
  });

  app.post('/spaces/:sid/profiles/:id/weight', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    await assertInSpace('profiles', id, ctx.spaceId, 'Профиль');
    const b = parse(z.object({ weight_kg: z.number().min(2).max(400), logged_on: zDate.optional() }), req.body);
    const space = await getSpace(ctx.spaceId);
    const date = b.logged_on ?? localParts(space.timezone).date;
    await q(db().from('weight_log').upsert({ profile_id: id, logged_on: date, weight_kg: b.weight_kg }, { onConflict: 'profile_id,logged_on' }));
    // Текущий вес профиля = последняя запись.
    const latest = await q<{ logged_on: string; weight_kg: number }[]>(
      db().from('weight_log').select('*').eq('profile_id', id).order('logged_on', { ascending: false }).limit(1)
    );
    if (latest[0]) await q(db().from('profiles').update({ weight_kg: latest[0].weight_kg }).eq('id', id));
    return { ok: true };
  });

  app.get('/spaces/:sid/profiles/:id/targets', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { id } = req.params as { id: string };
    const rows = await q<Record<string, unknown>[]>(db().from('profiles').select('*').eq('id', id).eq('space_id', ctx.spaceId));
    if (!rows.length) throw new HttpError(404, 'Профиль не найден');
    return computeTargets(rows[0] as unknown as ProfileBody);
  });

  /** Предпросмотр целей без сохранения (живой расчёт в форме). */
  app.post('/targets/preview', async (req) => {
    const b = parse(profileSchema.partial().extend({ kind: z.enum(['adult', 'child', 'pet']) }), req.body);
    return computeTargets({
      kind: b.kind,
      sex: b.sex ?? null,
      birth_date: b.birth_date ?? null,
      height_cm: b.height_cm ?? null,
      weight_kg: b.weight_kg ?? null,
      activity: b.activity ?? 1.375,
      goal_offset_kcal: b.goal_offset_kcal ?? 0,
      kcal_override: b.kcal_override ?? null,
      protein_g_per_kg: b.protein_g_per_kg ?? 1.8,
      fat_g_per_kg: b.fat_g_per_kg ?? 0.9
    });
  });
}
