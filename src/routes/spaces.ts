import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSpace } from '../access.js';
import { displayName } from '../auth.js';
import { config } from '../config.js';
import { db, q, q1 } from '../db.js';
import { HttpError, parse } from '../http.js';
import { isValidTz, localParts } from '../lib/dates.js';
import { DEFAULT_CATEGORIES, DEFAULT_MEAL_LAYOUTS } from '../lib/defaults.js';
import { DEFAULT_BRACKETS } from '../lib/tax.js';
import { budgetSummary, getSpace } from './budget.js';
import { planCheck } from './food.js';
import { withTargets } from './people.js';
import { remindersWithStreaks } from './reminders.js';

const mealSlot = z.object({ type: z.enum(['breakfast', 'main', 'snack']), share: z.number().min(1).max(100) });

// Простое ограничение частоты погашения приглашений: 10 попыток в час на пользователя.
const redeemHits = new Map<number, number[]>();
function rateLimitRedeem(tgId: number) {
  const now = Date.now();
  const hits = (redeemHits.get(tgId) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= 10) throw new HttpError(429, 'Слишком много попыток. Попробуйте позже');
  hits.push(now);
  redeemHits.set(tgId, hits);
}

function inviteLink(code: string): string {
  if (!config.botUsername) return code;
  if (config.webappShortName) return `https://t.me/${config.botUsername}/${config.webappShortName}?startapp=${code}`;
  return `https://t.me/${config.botUsername}?startapp=${code}`;
}

async function redeem(code: string, tgId: number, name: string) {
  rateLimitRedeem(tgId);
  const rows = await q<{ space_id: string | null; role: string | null; status: string }[]>(
    db().rpc('redeem_invite', { p_code: code, p_tg_id: tgId, p_name: name })
  );
  return rows[0] ?? { space_id: null, role: null, status: 'not_found' };
}

async function createSpace(tgId: number, name: string, ownerName: string) {
  const space = await q1<{ id: string }>(db().from('spaces').insert({ name, owner_tg_id: tgId }).select('id').single());
  await q(db().from('members').insert({ space_id: space.id, tg_id: tgId, role: 'owner', display_name: ownerName }));
  await q(db().from('categories').insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, space_id: space.id }))));
  await q(db().from('tax_brackets').insert(DEFAULT_BRACKETS.map((b) => ({ ...b, space_id: space.id }))));
  await q(db().from('profiles').insert({ space_id: space.id, kind: 'adult', name: ownerName.split(' ')[0] || 'Я', tg_id: tgId }));
  return space;
}

export function spaceRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const { user, startParam } = req.auth;
    const name = displayName(user);
    let invite: { status: string; space_id: string | null } | null = null;
    if (startParam && startParam.startsWith('inv_')) {
      const r = await redeem(startParam, user.id, name);
      invite = { status: r.status, space_id: r.space_id };
    }
    const memberships = await q<{ space_id: string; role: string; spaces: { id: string; name: string; usd_rate: number; timezone: string } }[]>(
      db().from('members').select('space_id, role, spaces(id, name, usd_rate, timezone)').eq('tg_id', user.id).order('joined_at')
    );
    return {
      user: { id: user.id, name, first_name: user.first_name ?? name },
      spaces: memberships.map((m) => ({ id: m.space_id, name: m.spaces?.name, role: m.role, usd_rate: Number(m.spaces?.usd_rate), timezone: m.spaces?.timezone })),
      invite,
      bot_username: config.botUsername || null
    };
  });

  app.post('/spaces', async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const owned = await q<{ id: string }[]>(db().from('spaces').select('id').eq('owner_tg_id', req.auth.user.id));
    if (owned.length >= 5) throw new HttpError(400, 'Можно создать не больше 5 пространств');
    return createSpace(req.auth.user.id, b.name, displayName(req.auth.user));
  });

  app.post('/invites/:code/redeem', async (req) => {
    const { code } = req.params as { code: string };
    const r = await redeem(code, req.auth.user.id, displayName(req.auth.user));
    const messages: Record<string, string> = {
      not_found: 'Приглашение не найдено',
      expired: 'Срок действия приглашения истёк',
      used_up: 'Приглашение уже использовано'
    };
    if (messages[r.status]) throw new HttpError(400, messages[r.status]);
    return r;
  });

  app.get('/spaces/:sid', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const space = await getSpace(ctx.spaceId);
    return {
      ...space,
      usd_rate: Number(space.usd_rate),
      top_cost_factor: Number(space.top_cost_factor),
      meal_layouts: space.meal_layouts ?? DEFAULT_MEAL_LAYOUTS,
      default_meal_layouts: DEFAULT_MEAL_LAYOUTS,
      role: ctx.role
    };
  });

  app.patch('/spaces/:sid', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        usd_rate: z.number().positive().max(100000).optional(),
        timezone: z.string().refine(isValidTz, 'неизвестный часовой пояс').optional(),
        top_cost_factor: z.number().min(1).max(10).optional(),
        meal_layouts: z
          .record(z.string().regex(/^[1-6]$/), z.array(mealSlot).min(1).max(6))
          .nullable()
          .optional()
      }),
      req.body
    );
    if (b.meal_layouts) {
      for (const [k, v] of Object.entries(b.meal_layouts)) {
        if (v.length !== Number(k)) throw new HttpError(400, `Раскладка на ${k} приёмов должна содержать ${k} строк`);
      }
    }
    return q1(db().from('spaces').update(b).eq('id', ctx.spaceId).select().single());
  });

  app.delete('/spaces/:sid', async (req) => {
    const ctx = await requireSpace(req, 'owner');
    await q(db().from('spaces').delete().eq('id', ctx.spaceId));
    return { ok: true };
  });

  // ---------- Участники ----------

  app.get('/spaces/:sid/members', async (req) => {
    const ctx = await requireSpace(req, 'read');
    return q(db().from('members').select('*').eq('space_id', ctx.spaceId).order('joined_at'));
  });

  app.patch('/spaces/:sid/me', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const b = parse(
      z.object({
        display_name: z.string().trim().min(1).max(60).optional(),
        timezone: z.string().refine(isValidTz, 'неизвестный часовой пояс').nullable().optional()
      }),
      req.body
    );
    return q1(db().from('members').update(b).eq('space_id', ctx.spaceId).eq('tg_id', ctx.tgId).select().single());
  });

  app.patch('/spaces/:sid/members/:tgId', async (req) => {
    const ctx = await requireSpace(req, 'owner');
    const tgId = Number((req.params as { tgId: string }).tgId);
    const b = parse(z.object({ role: z.enum(['editor', 'viewer']) }), req.body);
    if (tgId === ctx.tgId) throw new HttpError(400, 'Нельзя изменить роль владельца');
    return q1(db().from('members').update({ role: b.role }).eq('space_id', ctx.spaceId).eq('tg_id', tgId).select().maybeSingle(), 'Участник не найден');
  });

  app.delete('/spaces/:sid/members/:tgId', async (req) => {
    const tgId = Number((req.params as { tgId: string }).tgId);
    const ctx = await requireSpace(req, 'read');
    if (tgId === ctx.tgId) {
      if (ctx.role === 'owner') throw new HttpError(400, 'Владелец не может покинуть пространство — удалите его в настройках');
    } else if (ctx.role !== 'owner') {
      throw new HttpError(403, 'Действие доступно только владельцу');
    }
    await q(db().from('members').delete().eq('space_id', ctx.spaceId).eq('tg_id', tgId));
    return { ok: true };
  });

  // ---------- Приглашения ----------

  app.get('/spaces/:sid/invites', async (req) => {
    const ctx = await requireSpace(req, 'owner');
    const rows = await q<{ code: string; expires_at: string; uses: number; max_uses: number }[]>(
      db().from('invites').select('*').eq('space_id', ctx.spaceId).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
    );
    return rows.filter((r) => r.uses < r.max_uses).map((r) => ({ ...r, link: inviteLink(r.code) }));
  });

  app.post('/spaces/:sid/invites', async (req) => {
    const ctx = await requireSpace(req, 'owner');
    const b = parse(
      z.object({
        role: z.enum(['editor', 'viewer']),
        expires_in_days: z.number().int().min(1).max(30).default(7),
        max_uses: z.number().int().min(1).max(20).default(1)
      }),
      req.body
    );
    const code = 'inv_' + randomBytes(16).toString('base64url'); // 128 бит
    const row = await q1(
      db()
        .from('invites')
        .insert({ code, space_id: ctx.spaceId, role: b.role, expires_at: new Date(Date.now() + b.expires_in_days * 86400_000).toISOString(), max_uses: b.max_uses })
        .select()
        .single()
    );
    return { ...row, link: inviteLink(code) };
  });

  app.delete('/spaces/:sid/invites/:code', async (req) => {
    const ctx = await requireSpace(req, 'owner');
    await q(db().from('invites').delete().eq('space_id', ctx.spaceId).eq('code', (req.params as { code: string }).code));
    return { ok: true };
  });

  // ---------- Главная ----------

  app.get('/spaces/:sid/home', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const space = await getSpace(ctx.spaceId);
    const [budget, profiles, activePlans, reminders] = await Promise.all([
      budgetSummary(ctx.spaceId),
      q<Record<string, unknown>[]>(db().from('profiles').select('*').eq('space_id', ctx.spaceId).eq('active', true).neq('kind', 'pet')),
      q<{ id: string; tier: string; days: number; start_on: string; total_minor: number; targets: { persons: { profile_id: string; day: { kcal: number; protein: number } }[] } }[]>(
        db().from('meal_plans').select('id,tier,days,start_on,total_minor,targets').eq('space_id', ctx.spaceId).eq('status', 'active').limit(1)
      ),
      remindersWithStreaks(ctx.spaceId, ctx.tgId)
    ]);
    const mine = withTargets(profiles).find((p) => Number(p.tg_id) === ctx.tgId) ?? null;
    const plan = activePlans[0] ?? null;
    const planned = plan && mine ? plan.targets.persons.find((p) => p.profile_id === mine.id) : null;
    const now = localParts(space.timezone);
    return {
      budget,
      me: mine ? { id: mine.id, name: mine.name, targets: mine.targets, planned: planned?.day ?? null } : null,
      plan: plan ? { id: plan.id, tier: plan.tier, days: plan.days, start_on: plan.start_on, total_minor: plan.total_minor, check: await planCheck(ctx.spaceId, plan.id) } : null,
      reminders: reminders
        .filter((r) => r.active && r.weekdays.includes(now.weekday))
        .sort((a, b) => a.local_time.localeCompare(b.local_time))
        .slice(0, 6)
    };
  });

  // ---------- Экспорт ----------

  app.get('/spaces/:sid/export', async (req) => {
    const ctx = await requireSpace(req, 'read');
    return buildExport(ctx.spaceId);
  });

  /** Экспорт файлом в личный чат с ботом (в Mini App скачивание файлов ненадёжно). */
  app.post('/spaces/:sid/export/send', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const data = await buildExport(ctx.spaceId);
    const date = new Date().toISOString().slice(0, 10);
    const form = new FormData();
    form.append('chat_id', String(ctx.tgId));
    form.append('caption', `Экспорт «${data.space.name}» за ${date}`);
    form.append('document', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `life-planner-${date}.json`);
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, { method: 'POST', body: form });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) throw new HttpError(502, 'Не удалось отправить файл: ' + (json.description ?? 'ошибка Telegram') + '. Напишите боту /start и попробуйте снова.');
    return { sent: true };
  });
}

async function buildExport(s: string) {
  {
    // Все данные пространства одним JSON.
    const t = (table: string) => q(db().from(table).select('*').eq('space_id', s));
    const [space, profiles, categories, income, fixed, stores, products, purchases, plans, reminders, programs] = await Promise.all([
      getSpace(s),
      t('profiles'),
      t('categories'),
      t('income_sources'),
      t('fixed_costs'),
      t('stores'),
      t('products'),
      q(db().from('purchases').select('*, purchase_items(*)').eq('space_id', s)),
      q(db().from('meal_plans').select('*, meal_plan_items(*)').eq('space_id', s)),
      t('reminders'),
      q(db().from('programs').select('*, program_days(*, program_exercises(*))').eq('space_id', s))
    ]);
    const productIds = (products as { id: string }[]).map((p) => p.id);
    const prices = productIds.length ? await q(db().from('product_prices').select('*').in('product_id', productIds)) : [];
    return { exported_at: new Date().toISOString(), space, profiles, categories, income, fixed_costs: fixed, stores, products, prices, purchases, meal_plans: plans, reminders, programs };
  }
}
