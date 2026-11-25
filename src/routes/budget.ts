import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertRefs, requireSpace } from '../access.js';
import { db, q, q1 } from '../db.js';
import { HttpError, parse, zDate, zId, zMinor } from '../http.js';
import { localParts, monthRange } from '../lib/dates.js';
import { DEFAULT_BRACKETS, monthlyAmount, netIncome, type Bracket, type IncomeSource } from '../lib/tax.js';
import { crud } from './crud.js';

const incomeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  gross_monthly_minor: zMinor,
  tax_mode: z.enum(['ndfl_progressive', 'flat', 'npd', 'none']),
  flat_rate: z.number().min(0).max(100).nullable().optional(),
  owner_tg_id: z.number().int().optional(),
  active: z.boolean().optional()
});

const fixedSchema = z.object({
  name: z.string().trim().min(1).max(100),
  amount_minor: zMinor,
  period: z.enum(['month', 'quarter', 'year']).optional(),
  due_day: z.number().int().min(1).max(31).nullable().optional(),
  category_id: zId.nullable().optional(),
  pet_id: zId.nullable().optional(),
  active: z.boolean().optional()
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['fixed', 'grocery', 'variable', 'pet', 'savings'])
});

const purchaseItem = z.object({
  product_id: zId.nullable().optional(),
  label: z.string().trim().max(100).nullable().optional(),
  qty: z.number().positive().max(1e6).nullable().optional(),
  price_minor: zMinor
});

const purchaseSchema = z.object({
  total_minor: zMinor.optional(),
  category_id: zId.nullable().optional(),
  store_id: zId.nullable().optional(),
  pet_id: zId.nullable().optional(),
  purchased_on: zDate.optional(),
  note: z.string().trim().max(300).nullable().optional(),
  items: z.array(purchaseItem).max(200).optional(),
  update_prices: z.boolean().optional()
});

export interface SpaceRow {
  id: string;
  name: string;
  owner_tg_id: number;
  usd_rate: number;
  timezone: string;
  meal_layouts: unknown;
  top_cost_factor: number;
}

export async function getSpace(spaceId: string): Promise<SpaceRow> {
  return q1(db().from('spaces').select('*').eq('id', spaceId).maybeSingle(), 'Пространство не найдено');
}

export async function budgetSummary(spaceId: string, month?: string) {
  const space = await getSpace(spaceId);
  const today = localParts(space.timezone).date;
  const m = month ?? today.slice(0, 7);
  const { from, to } = monthRange(m);

  const [sources, brackets, fixed, purchases, categories, pets] = await Promise.all([
    q<IncomeSource[]>(db().from('income_sources').select('*').eq('space_id', spaceId)),
    q<Bracket[]>(db().from('tax_brackets').select('*').eq('space_id', spaceId)),
    q<{ id: string; name: string; amount_minor: number; period: 'month' | 'quarter' | 'year'; pet_id: string | null; category_id: string | null; due_day: number | null }[]>(
      db().from('fixed_costs').select('*').eq('space_id', spaceId).eq('active', true)
    ),
    q<{ id: string; total_minor: number; category_id: string | null; pet_id: string | null }[]>(
      db().from('purchases').select('id,total_minor,category_id,pet_id').eq('space_id', spaceId).gte('purchased_on', from).lte('purchased_on', to)
    ),
    q<{ id: string; name: string; kind: string }[]>(db().from('categories').select('id,name,kind').eq('space_id', spaceId)),
    q<{ id: string; name: string; species: string | null }[]>(db().from('profiles').select('id,name,species').eq('space_id', spaceId).eq('kind', 'pet').eq('active', true))
  ]);

  const net = netIncome(sources, brackets.length ? brackets : DEFAULT_BRACKETS);
  const income = {
    gross: net.reduce((s, r) => s + r.gross_monthly_minor, 0),
    tax: net.reduce((s, r) => s + r.tax_monthly_minor, 0),
    net: net.reduce((s, r) => s + r.net_monthly_minor, 0),
    sources: net
  };

  const catById = new Map(categories.map((c) => [c.id, c]));
  let fixedTotal = 0;
  let fixedPets = 0;
  const petFixed = new Map<string, number>();
  for (const f of fixed) {
    const monthly = monthlyAmount(Number(f.amount_minor), f.period);
    fixedTotal += monthly;
    const isPet = f.pet_id || catById.get(f.category_id ?? '')?.kind === 'pet';
    if (isPet) fixedPets += monthly;
    if (f.pet_id) petFixed.set(f.pet_id, (petFixed.get(f.pet_id) ?? 0) + monthly);
  }

  const spent = { grocery: 0, pet: 0, other: 0, total: 0 };
  const byCat = new Map<string, number>();
  const petSpent = new Map<string, number>();
  for (const p of purchases) {
    const amount = Number(p.total_minor);
    const kind = catById.get(p.category_id ?? '')?.kind;
    if (p.pet_id || kind === 'pet') spent.pet += amount;
    else if (kind === 'grocery') spent.grocery += amount;
    else spent.other += amount;
    spent.total += amount;
    const key = p.category_id ?? 'none';
    byCat.set(key, (byCat.get(key) ?? 0) + amount);
    if (p.pet_id) petSpent.set(p.pet_id, (petSpent.get(p.pet_id) ?? 0) + amount);
  }

  const free = income.net - fixedTotal;
  return {
    month: m,
    today,
    usd_rate: Number(space.usd_rate),
    income,
    fixed: { total: fixedTotal, pets: fixedPets, count: fixed.length },
    free,
    spent,
    remaining: free - spent.total,
    by_category: [...byCat.entries()]
      .map(([id, total]) => ({
        category_id: id === 'none' ? null : id,
        name: catById.get(id)?.name ?? 'Без категории',
        kind: catById.get(id)?.kind ?? 'variable',
        total
      }))
      .sort((a, b) => b.total - a.total),
    pets: pets.map((p) => ({
      id: p.id,
      name: p.name,
      species: p.species,
      spent_month: petSpent.get(p.id) ?? 0,
      fixed_month: petFixed.get(p.id) ?? 0
    }))
  };
}

export function budgetRoutes(app: FastifyInstance) {
  crud(app, {
    path: 'income',
    table: 'income_sources',
    create: incomeSchema,
    order: { column: 'name' },
    prepare: (b, ctx) => ({ owner_tg_id: b.owner_tg_id ?? ctx.tgId }),
    validate: (b) => {
      if ((b.tax_mode === 'flat' || b.tax_mode === 'npd') && b.flat_rate == null) {
        throw new HttpError(400, 'Укажите ставку налога');
      }
    },
    decorate: async (rows, ctx) => {
      const brackets = await q<Bracket[]>(db().from('tax_brackets').select('*').eq('space_id', ctx.spaceId));
      const net = netIncome(rows as unknown as IncomeSource[], brackets.length ? brackets : DEFAULT_BRACKETS);
      const byId = new Map(net.map((n) => [n.id, n]));
      return rows.map((r) => ({ ...r, tax_monthly_minor: byId.get(r.id as string)?.tax_monthly_minor ?? 0, net_monthly_minor: byId.get(r.id as string)?.net_monthly_minor ?? 0 }));
    }
  });

  crud(app, {
    path: 'fixed-costs',
    table: 'fixed_costs',
    create: fixedSchema,
    order: { column: 'name' },
    refs: (b) => ({ c: { table: 'categories', id: b.category_id }, p: { table: 'profiles', id: b.pet_id } }),
    decorate: (rows) => rows.map((r) => ({ ...r, monthly_minor: monthlyAmount(Number(r.amount_minor), r.period as 'month') }))
  });

  crud(app, {
    path: 'categories',
    table: 'categories',
    create: categorySchema,
    order: { column: 'name' }
  });

  // Налоговая шкала
  app.get('/spaces/:sid/tax-brackets', async (req) => {
    const ctx = await requireSpace(req, 'read');
    return q(db().from('tax_brackets').select('*').eq('space_id', ctx.spaceId).order('from_annual_minor'));
  });
  app.put('/spaces/:sid/tax-brackets', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const rows = parse(
      z.array(z.object({ from_annual_minor: zMinor, rate: z.number().min(0).max(100) })).min(1).max(20),
      req.body
    );
    if (!rows.some((r) => r.from_annual_minor === 0)) throw new HttpError(400, 'Шкала должна начинаться с нуля');
    await q(db().from('tax_brackets').delete().eq('space_id', ctx.spaceId));
    await q(db().from('tax_brackets').insert(rows.map((r) => ({ ...r, space_id: ctx.spaceId }))));
    return { ok: true };
  });

  app.get('/spaces/:sid/summary', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { month } = req.query as { month?: string };
    if (month && !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Месяц в формате ГГГГ-ММ');
    return budgetSummary(ctx.spaceId, month);
  });

  // Покупки
  app.get('/spaces/:sid/purchases', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { month, category_id, pet_id } = req.query as { month?: string; category_id?: string; pet_id?: string };
    const space = await getSpace(ctx.spaceId);
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : localParts(space.timezone).date.slice(0, 7);
    const { from, to } = monthRange(m);
    let query = db()
      .from('purchases')
      .select('*, purchase_items(*)')
      .eq('space_id', ctx.spaceId)
      .gte('purchased_on', from)
      .lte('purchased_on', to)
      .order('purchased_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (category_id) query = query.eq('category_id', category_id);
    if (pet_id) query = query.eq('pet_id', pet_id);
    return { month: m, purchases: await q(query) };
  });

  app.post('/spaces/:sid/purchases', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(purchaseSchema, req.body);
    await assertRefs(ctx.spaceId, {
      c: { table: 'categories', id: b.category_id },
      s: { table: 'stores', id: b.store_id },
      p: { table: 'profiles', id: b.pet_id }
    });
    const items = b.items ?? [];
    for (const it of items) if (it.product_id) await assertRefs(ctx.spaceId, { p: { table: 'products', id: it.product_id } });
    const total = b.total_minor ?? items.reduce((s, i) => s + i.price_minor, 0);
    if (!total && !items.length) throw new HttpError(400, 'Укажите сумму покупки');
    const space = await getSpace(ctx.spaceId);
    const date = b.purchased_on ?? localParts(space.timezone).date;
    const purchase = await q1(
      db()
        .from('purchases')
        .insert({
          space_id: ctx.spaceId,
          store_id: b.store_id ?? null,
          category_id: b.category_id ?? null,
          pet_id: b.pet_id ?? null,
          purchased_on: date,
          total_minor: total,
          note: b.note ?? null,
          created_by: ctx.tgId
        })
        .select()
        .single()
    );
    if (items.length) {
      await q(db().from('purchase_items').insert(items.map((i) => ({ ...i, purchase_id: (purchase as { id: string }).id }))));
      if (b.update_prices) {
        const priceRows = items
          .filter((i) => i.product_id && i.qty && i.qty > 0 && i.price_minor > 0)
          .map((i) => ({
            product_id: i.product_id,
            store_id: b.store_id ?? null,
            pack_qty: i.qty,
            price_minor: i.price_minor,
            observed_on: date,
            created_by: ctx.tgId
          }));
        if (priceRows.length) await q(db().from('product_prices').insert(priceRows));
      }
    }
    return purchase;
  });

  app.patch('/spaces/:sid/purchases/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    const b = parse(purchaseSchema.omit({ items: true, update_prices: true }).partial(), req.body);
    await assertRefs(ctx.spaceId, {
      c: { table: 'categories', id: b.category_id },
      s: { table: 'stores', id: b.store_id },
      p: { table: 'profiles', id: b.pet_id }
    });
    return q1(db().from('purchases').update(b).eq('id', id).eq('space_id', ctx.spaceId).select().maybeSingle(), 'Покупка не найдена');
  });

  app.delete('/spaces/:sid/purchases/:id', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    await q(db().from('purchases').delete().eq('id', id).eq('space_id', ctx.spaceId));
    return { ok: true };
  });
}
