import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertInSpace, assertRefs, requireSpace } from '../access.js';
import { db, q, q1 } from '../db.js';
import { HttpError, parse, zDate, zId, zMinor } from '../http.js';
import { addDays, localParts } from '../lib/dates.js';
import { DEFAULT_MEAL_LAYOUTS, STARTER_PRODUCTS, mealLabel, type MealSlot, type MealType } from '../lib/defaults.js';
import { layoutFor, solvePerson, TIERS, type EnginePerson, type EngineProduct, type PersonResult, type Tier } from '../lib/mealEngine.js';
import { computeTargets, type ProfileBody } from '../lib/targets.js';
import { getSpace } from './budget.js';
import { crud } from './crud.js';

const slotEnum = z.enum(['breakfast', 'main', 'snack']);

const productSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category_id: zId.nullable().optional(),
  unit: z.enum(['g', 'ml', 'pcs']).optional(),
  grams_per_piece: z.number().positive().max(10000).nullable().optional(),
  kcal_100: z.number().min(0).max(1000),
  protein_100: z.number().min(0).max(100),
  carbs_100: z.number().min(0).max(100),
  fat_100: z.number().min(0).max(100),
  min_g_day: z.number().min(0).max(5000).optional(),
  max_g_day: z.number().min(0).max(5000).optional(),
  quality: z.number().int().min(1).max(3).optional(),
  slots: z.array(slotEnum).min(1).optional(),
  active: z.boolean().optional()
});

const priceSchema = z.object({
  store_id: zId.nullable().optional(),
  pack_qty: z.number().positive().max(1e6),
  price_minor: zMinor,
  observed_on: zDate.optional()
});

const generateSchema = z.object({
  days: z.number().int().min(1).max(31).default(7),
  meals_per_day: z.number().int().min(1).max(6).nullable().optional(),
  profile_ids: z.array(zId).min(1).max(20),
  store_id: zId.nullable().optional(),
  exclude: z.array(zId).max(500).optional(),
  start_on: zDate.optional()
});

export interface PriceRow {
  product_id: string;
  store_id: string | null;
  pack_qty: number;
  price_minor: number;
  price_per_unit: number;
  observed_on: string;
  rn: number;
}

interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  unit: 'g' | 'ml' | 'pcs';
  grams_per_piece: number | null;
  kcal_100: number;
  protein_100: number;
  carbs_100: number;
  fat_100: number;
  min_g_day: number;
  max_g_day: number;
  quality: number;
  slots: MealType[];
  active: boolean;
}

export async function recentPrices(spaceId: string): Promise<PriceRow[]> {
  return q<PriceRow[]>(db().from('recent_prices').select('product_id,store_id,pack_qty,price_minor,price_per_unit,observed_on,rn').eq('space_id', spaceId));
}

/**
 * Цена продукта для магазина: своя цена магазина → общая цена → (для «Любой») самый дешёвый магазин.
 */
export function resolvePrice(prices: PriceRow[], productId: string, storeId: string | null, anyStoreFallback: boolean): PriceRow | null {
  const latest = prices.filter((p) => p.product_id === productId && Number(p.rn) === 1);
  if (storeId) {
    const own = latest.find((p) => p.store_id === storeId);
    if (own) return own;
  }
  const general = latest.find((p) => p.store_id === null);
  if (general) return general;
  if (anyStoreFallback && !storeId) {
    const stores = latest.filter((p) => p.store_id !== null).sort((a, b) => Number(a.price_per_unit) - Number(b.price_per_unit));
    return stores[0] ?? null;
  }
  return null;
}

/** Стоимость грамма (копейки) по цене упаковки. Для штучных — через вес штуки. */
export function costPerGram(p: Pick<ProductRow, 'unit' | 'grams_per_piece'>, price: Pick<PriceRow, 'pack_qty' | 'price_minor'>): number | null {
  const perUnit = Number(price.price_minor) / Number(price.pack_qty);
  if (p.unit === 'pcs') {
    if (!p.grams_per_piece) return null;
    return perUnit / Number(p.grams_per_piece);
  }
  return perUnit;
}

/** Количество в единицах продукта (г, мл или шт) из граммов. */
export function gramsToUnits(p: Pick<ProductRow, 'unit' | 'grams_per_piece'>, grams: number): number {
  if (p.unit === 'pcs' && p.grams_per_piece) return grams / Number(p.grams_per_piece);
  return grams;
}

function priceInfo(prices: PriceRow[], productId: string, storeId: string | null) {
  const rows = prices.filter((p) => p.product_id === productId && p.store_id === storeId);
  const cur = rows.find((r) => Number(r.rn) === 1);
  const prev = rows.find((r) => Number(r.rn) === 2);
  if (!cur) return null;
  const curU = Number(cur.price_per_unit);
  const prevU = prev ? Number(prev.price_per_unit) : null;
  return {
    store_id: storeId,
    pack_qty: Number(cur.pack_qty),
    price_minor: Number(cur.price_minor),
    per_unit: curU,
    observed_on: cur.observed_on,
    prev_per_unit: prevU,
    change_pct: prevU ? Math.round(((curU - prevU) / prevU) * 1000) / 10 : null
  };
}

function decorateProduct(p: ProductRow, prices: PriceRow[], storeIds: string[]) {
  const general = priceInfo(prices, p.id, null);
  const stores = storeIds.map((s) => priceInfo(prices, p.id, s)).filter((x): x is NonNullable<typeof x> => !!x);
  const cheapest = [...stores].sort((a, b) => a.per_unit - b.per_unit)[0] ?? null;
  const display = general ?? cheapest;
  return {
    ...p,
    price: display,
    general_price: general,
    store_prices: stores,
    cheapest_store_id: cheapest?.store_id ?? null
  };
}

export function foodRoutes(app: FastifyInstance) {
  crud(app, {
    path: 'stores',
    table: 'stores',
    create: z.object({ name: z.string().trim().min(1).max(60) }),
    order: { column: 'name' }
  });

  // ---------- Продукты ----------

  app.get('/spaces/:sid/products', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const [products, prices, stores] = await Promise.all([
      q<ProductRow[]>(db().from('products').select('*').eq('space_id', ctx.spaceId).order('name')),
      recentPrices(ctx.spaceId),
      q<{ id: string }[]>(db().from('stores').select('id').eq('space_id', ctx.spaceId))
    ]);
    const storeIds = stores.map((s) => s.id);
    return products.map((p) => decorateProduct(p, prices, storeIds));
  });

  app.get('/spaces/:sid/products/:id', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { id } = req.params as { id: string };
    const product = await q1<ProductRow | null>(db().from('products').select('*').eq('id', id).eq('space_id', ctx.spaceId).maybeSingle(), 'Продукт не найден');
    const [prices, stores, history] = await Promise.all([
      recentPrices(ctx.spaceId),
      q<{ id: string; name: string }[]>(db().from('stores').select('id,name').eq('space_id', ctx.spaceId)),
      q(db().from('product_prices').select('*').eq('product_id', id).order('observed_on', { ascending: false }).order('created_at', { ascending: false }).limit(100))
    ]);
    return { ...decorateProduct(product, prices, stores.map((s) => s.id)), history };
  });

  crud(app, {
    path: 'products',
    table: 'products',
    create: productSchema,
    methods: ['create', 'update', 'delete'],
    refs: (b) => ({ c: { table: 'categories', id: b.category_id } }),
    validate: (b) => {
      if (b.unit === 'pcs' && b.grams_per_piece == null) throw new HttpError(400, 'Для штучного продукта укажите вес одной штуки');
      if (b.min_g_day != null && b.max_g_day != null && b.min_g_day > b.max_g_day) throw new HttpError(400, 'Минимум больше максимума');
    }
  });

  app.post('/spaces/:sid/products/starter', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const existing = await q<{ name: string }[]>(db().from('products').select('name').eq('space_id', ctx.spaceId));
    const names = new Set(existing.map((e) => e.name.toLowerCase()));
    const cat = await q<{ id: string }[]>(db().from('categories').select('id').eq('space_id', ctx.spaceId).eq('kind', 'grocery').limit(1));
    const rows = STARTER_PRODUCTS.filter((p) => !names.has(p.name.toLowerCase())).map((p) => ({
      ...p,
      grams_per_piece: p.grams_per_piece ?? null,
      min_g_day: p.min_g_day ?? 0,
      category_id: cat[0]?.id ?? null,
      space_id: ctx.spaceId
    }));
    if (rows.length) await q(db().from('products').insert(rows));
    return { added: rows.length };
  });

  app.post('/spaces/:sid/products/:id/prices', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id } = req.params as { id: string };
    await assertInSpace('products', id, ctx.spaceId, 'Продукт');
    const b = parse(priceSchema, req.body);
    await assertRefs(ctx.spaceId, { s: { table: 'stores', id: b.store_id } });
    const space = await getSpace(ctx.spaceId);
    return q1(
      db()
        .from('product_prices')
        .insert({
          product_id: id,
          store_id: b.store_id ?? null,
          pack_qty: b.pack_qty,
          price_minor: b.price_minor,
          observed_on: b.observed_on ?? localParts(space.timezone).date,
          created_by: ctx.tgId
        })
        .select()
        .single()
    );
  });

  app.delete('/spaces/:sid/products/:id/prices/:priceId', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { id, priceId } = req.params as { id: string; priceId: string };
    await assertInSpace('products', id, ctx.spaceId, 'Продукт');
    await q(db().from('product_prices').delete().eq('id', priceId).eq('product_id', id));
    return { ok: true };
  });

  // ---------- Планы питания ----------

  app.post('/spaces/:sid/meal-plans/generate', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const b = parse(generateSchema, req.body);
    if (b.store_id) await assertInSpace('stores', b.store_id, ctx.spaceId, 'Магазин');
    const space = await getSpace(ctx.spaceId);
    const layouts = { ...DEFAULT_MEAL_LAYOUTS, ...((space.meal_layouts as Record<string, MealSlot[]>) ?? {}) };

    const profiles = await q<(ProfileBody & { id: string; name: string; meals_per_day: number })[]>(
      db().from('profiles').select('*').eq('space_id', ctx.spaceId).in('id', b.profile_ids).in('kind', ['adult', 'child'])
    );
    if (!profiles.length) throw new HttpError(400, 'Выберите хотя бы одного человека');

    const warnings: string[] = [];
    const people: (EnginePerson & { mealsCount: number })[] = [];
    for (const p of profiles) {
      const targets = computeTargets(p);
      if (!targets) {
        const missing = [
          !p.sex && 'пол',
          !p.birth_date && 'возраст',
          !p.height_cm && 'рост',
          !p.weight_kg && 'вес'
        ].filter(Boolean);
        throw new HttpError(
          400,
          p.kind === 'child'
            ? `Для ребёнка «${p.name}» укажите калорийность в профиле`
            : `В профиле «${p.name}» не указано: ${missing.join(', ') || 'данные'}. Заполните или задайте калории вручную`
        );
      }
      const meals = b.meals_per_day ?? p.meals_per_day ?? 3;
      people.push({ profile_id: p.id, name: p.name, targets, meals: layoutFor(meals, layouts), mealsCount: meals });
    }

    const [productRows, prices, stores] = await Promise.all([
      q<ProductRow[]>(db().from('products').select('*').eq('space_id', ctx.spaceId).eq('active', true)),
      recentPrices(ctx.spaceId),
      q<{ id: string; name: string }[]>(db().from('stores').select('id,name').eq('space_id', ctx.spaceId).order('name'))
    ]);
    const exclude = new Set(b.exclude ?? []);
    const storeId = b.store_id ?? null;
    const engineProducts: EngineProduct[] = [];
    const missingPrice: string[] = [];
    for (const p of productRows) {
      if (exclude.has(p.id)) continue;
      const price = resolvePrice(prices, p.id, storeId, true);
      if (!price) {
        missingPrice.push(p.name);
        continue;
      }
      const cpg = costPerGram(p, price);
      if (cpg == null) {
        warnings.push(`«${p.name}»: не указан вес одной штуки, продукт пропущен.`);
        continue;
      }
      engineProducts.push({
        id: p.id,
        name: p.name,
        unit: p.unit,
        grams_per_piece: p.grams_per_piece == null ? null : Number(p.grams_per_piece),
        kcal_100: Number(p.kcal_100),
        protein_100: Number(p.protein_100),
        fat_100: Number(p.fat_100),
        carbs_100: Number(p.carbs_100),
        min_g_day: Number(p.min_g_day),
        max_g_day: Number(p.max_g_day),
        quality: Number(p.quality),
        slots: p.slots,
        cost_per_g: cpg
      });
    }
    if (missingPrice.length) {
      warnings.push(`Без цены${storeId ? ' в этом магазине' : ''} (не участвуют): ${missingPrice.slice(0, 8).join(', ')}${missingPrice.length > 8 ? ` и ещё ${missingPrice.length - 8}` : ''}.`);
    }
    if (!engineProducts.length) throw new HttpError(400, 'Нет продуктов с ценами. Добавьте продукты и укажите цены.');

    // Решаем: сначала дешёвый (для ограничения премиального), затем средний и премиум.
    const results: Record<Tier, PersonResult[]> = { cheap: [], middle: [], top: [] };
    for (const person of people) {
      const cheap = await solvePerson(person, engineProducts, 'cheap', { topCostFactor: Number(space.top_cost_factor) });
      results.cheap.push(cheap);
      results.middle.push(await solvePerson(person, engineProducts, 'middle', { topCostFactor: Number(space.top_cost_factor) }));
      results.top.push(
        await solvePerson(person, engineProducts, 'top', {
          topCostFactor: Number(space.top_cost_factor),
          cheapDailyCost: cheap.ok ? cheap.daily_cost_minor : undefined
        })
      );
    }

    const productById = new Map(productRows.map((p) => [p.id, p]));
    const batchId = randomUUID();
    const startOn = b.start_on ?? localParts(space.timezone).date;
    const planIds: string[] = [];

    for (const tier of TIERS) {
      const res = results[tier];
      const dailyCost = res.reduce((s, r) => s + r.daily_cost_minor, 0);

      // Сравнение магазинов: только магазины с собственными ценами на все продукты плана.
      const used = new Map<string, number>(); // product_id → граммы в день (все люди)
      for (const r of res) for (const it of r.items) used.set(it.product_id, (used.get(it.product_id) ?? 0) + it.grams);
      const comparison: { store_id: string | null; name: string; total_minor: number }[] = [];
      const candidates: { id: string | null; name: string }[] = [{ id: null, name: 'Общие цены' }, ...stores];
      for (const s of candidates) {
        let total = 0;
        let complete = used.size > 0;
        for (const [pid, grams] of used) {
          const pr = prices.find((x) => x.product_id === pid && x.store_id === s.id && Number(x.rn) === 1);
          const prod = productById.get(pid)!;
          const cpg = pr ? costPerGram(prod, pr) : null;
          if (cpg == null) {
            complete = false;
            break;
          }
          total += cpg * grams * b.days;
        }
        if (complete) comparison.push({ store_id: s.id, name: s.name, total_minor: Math.round(total) });
      }
      comparison.sort((a, b2) => a.total_minor - b2.total_minor);

      const persons = res.map((r, i) => ({
        profile_id: r.profile_id,
        name: r.name,
        ok: r.ok,
        error: r.error ?? null,
        warnings: r.warnings,
        relax_level: r.relax_level,
        meals_per_day: people[i].mealsCount,
        meals: r.per_meal.map((m) => ({ ...m, label: mealLabel(people[i].mealsCount, m.meal_no - 1, m.type) })),
        targets: r.targets,
        day: r.day,
        daily_cost_minor: r.daily_cost_minor
      }));

      const plan = await q1<{ id: string }>(
        db()
          .from('meal_plans')
          .insert({
            space_id: ctx.spaceId,
            batch_id: batchId,
            tier,
            store_id: storeId,
            start_on: startOn,
            days: b.days,
            meals_per_day: b.meals_per_day ?? people[0].mealsCount,
            total_minor: Math.round(dailyCost * b.days),
            targets: { persons, warnings, store_comparison: comparison, exclude: [...exclude], profile_ids: b.profile_ids },
            status: 'draft'
          })
          .select('id')
          .single()
      );
      planIds.push(plan.id);
      const items = res.flatMap((r) => r.items.map((it) => ({ plan_id: plan.id, profile_id: r.profile_id, product_id: it.product_id, meal_no: it.meal_no, grams: it.grams })));
      if (items.length) await q(db().from('meal_plan_items').insert(items));
    }

    // Старые черновики больше не нужны.
    await q(db().from('meal_plans').delete().eq('space_id', ctx.spaceId).eq('status', 'draft').neq('batch_id', batchId));

    return { batch_id: batchId, plan_ids: planIds };
  });

  app.get('/spaces/:sid/meal-plans', async (req) => {
    const ctx = await requireSpace(req, 'read');
    return q(
      db()
        .from('meal_plans')
        .select('id,batch_id,tier,store_id,start_on,days,meals_per_day,total_minor,status,created_at')
        .eq('space_id', ctx.spaceId)
        .order('created_at', { ascending: false })
        .limit(30)
    );
  });

  async function loadPlan(spaceId: string, filter: { id?: string; batch?: string }) {
    let query = db().from('meal_plans').select('*').eq('space_id', spaceId);
    if (filter.id) query = query.eq('id', filter.id);
    if (filter.batch) query = query.eq('batch_id', filter.batch);
    const plans = await q<Record<string, unknown>[]>(query);
    if (!plans.length) throw new HttpError(404, 'План не найден');
    const ids = plans.map((p) => p.id as string);
    const items = await q<{ plan_id: string; profile_id: string; product_id: string; meal_no: number; grams: number }[]>(
      db().from('meal_plan_items').select('*').in('plan_id', ids)
    );
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const products = productIds.length
      ? await q<ProductRow[]>(db().from('products').select('id,name,unit,grams_per_piece,kcal_100,protein_100,fat_100,carbs_100').in('id', productIds))
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return plans
      .map((p) => ({
        ...p,
        items: items
          .filter((i) => i.plan_id === p.id)
          .map((i) => {
            const pr = byId.get(i.product_id);
            return {
              ...i,
              grams: Number(i.grams),
              name: pr?.name ?? '—',
              unit: pr?.unit ?? 'g',
              qty: pr ? gramsToUnits(pr, Number(i.grams)) : Number(i.grams),
              kcal: pr ? Math.round((Number(pr.kcal_100) * Number(i.grams)) / 100) : 0
            };
          })
      }))
      .sort((a, b) => TIERS.indexOf((a as { tier?: Tier }).tier!) - TIERS.indexOf((b as { tier?: Tier }).tier!));
  }

  app.get('/spaces/:sid/meal-plans/batch/:batchId', async (req) => {
    const ctx = await requireSpace(req, 'read');
    return loadPlan(ctx.spaceId, { batch: (req.params as { batchId: string }).batchId });
  });

  app.get('/spaces/:sid/meal-plans/:pid', async (req) => {
    const ctx = await requireSpace(req, 'read');
    return (await loadPlan(ctx.spaceId, { id: (req.params as { pid: string }).pid }))[0];
  });

  app.post('/spaces/:sid/meal-plans/:pid/activate', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { pid } = req.params as { pid: string };
    const b = parse(z.object({ start_on: zDate.optional() }), req.body ?? {});
    await assertInSpace('meal_plans', pid, ctx.spaceId, 'План');
    await q(db().from('meal_plans').update({ status: 'done' }).eq('space_id', ctx.spaceId).eq('status', 'active'));
    const patch: Record<string, unknown> = { status: 'active' };
    if (b.start_on) patch.start_on = b.start_on;
    return q1(db().from('meal_plans').update(patch).eq('id', pid).select().single());
  });

  app.delete('/spaces/:sid/meal-plans/:pid', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { pid } = req.params as { pid: string };
    await q(db().from('meal_plans').delete().eq('id', pid).eq('space_id', ctx.spaceId));
    return { ok: true };
  });

  // ---------- Список покупок ----------

  async function groceryList(spaceId: string, pid: string, storeParam: string | undefined) {
    const plan = (await loadPlan(spaceId, { id: pid }))[0] as unknown as {
      id: string;
      days: number;
      store_id: string | null;
      total_minor: number;
      items: { product_id: string; grams: number }[];
    };
    const storeId = storeParam === undefined ? plan.store_id : storeParam === 'general' || storeParam === '' ? null : storeParam;
    const totals = new Map<string, number>();
    for (const it of plan.items) totals.set(it.product_id, (totals.get(it.product_id) ?? 0) + it.grams * plan.days);
    const ids = [...totals.keys()];
    const [products, prices, checks, stores, categories] = await Promise.all([
      ids.length ? q<ProductRow[]>(db().from('products').select('*').in('id', ids)) : Promise.resolve([] as ProductRow[]),
      recentPrices(spaceId),
      q<{ product_id: string; checked: boolean; purchase_id: string | null; checked_by: number | null }[]>(db().from('grocery_checks').select('*').eq('plan_id', pid)),
      q<{ id: string; name: string }[]>(db().from('stores').select('id,name').eq('space_id', spaceId).order('name')),
      q<{ id: string; name: string }[]>(db().from('categories').select('id,name').eq('space_id', spaceId))
    ]);
    const checkBy = new Map(checks.map((c) => [c.product_id, c]));
    const catName = new Map(categories.map((c) => [c.id, c.name]));

    const priceRows = (sid: string | null, anyFallback: boolean) =>
      products.map((p) => {
        const grams = totals.get(p.id) ?? 0;
        const qty = gramsToUnits(p, grams);
        const price = resolvePrice(prices, p.id, sid, anyFallback);
        const packs = price ? Math.max(1, Math.ceil(qty / Number(price.pack_qty) - 1e-9)) : null;
        return {
          product_id: p.id,
          name: p.name,
          unit: p.unit,
          category: catName.get(p.category_id ?? '') ?? 'Прочее',
          qty: Math.round(qty * 10) / 10,
          pack_qty: price ? Number(price.pack_qty) : null,
          pack_price_minor: price ? Number(price.price_minor) : null,
          packs,
          cost_minor: price && packs ? packs * Number(price.price_minor) : null,
          price_store_id: price?.store_id ?? null,
          checked: checkBy.get(p.id)?.checked ?? false,
          recorded: !!checkBy.get(p.id)?.purchase_id
        };
      });

    const rows = priceRows(storeId, true).sort((a, b) => a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'));
    const storeTotals = stores.map((s) => {
      const r = priceRows(s.id, false);
      return { store_id: s.id, name: s.name, total_minor: r.reduce((x, y) => x + (y.cost_minor ?? 0), 0), missing: r.filter((y) => y.cost_minor == null).length };
    });
    return {
      plan_id: pid,
      store_id: storeId,
      days: plan.days,
      items: rows,
      total_minor: rows.reduce((s, r) => s + (r.cost_minor ?? 0), 0),
      missing_prices: rows.filter((r) => r.cost_minor == null).length,
      stores: storeTotals
    };
  }

  app.get('/spaces/:sid/meal-plans/:pid/grocery', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { pid } = req.params as { pid: string };
    const { store_id } = req.query as { store_id?: string };
    return groceryList(ctx.spaceId, pid, store_id);
  });

  app.post('/spaces/:sid/meal-plans/:pid/grocery/:productId', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { pid, productId } = req.params as { pid: string; productId: string };
    await assertInSpace('meal_plans', pid, ctx.spaceId, 'План');
    const b = parse(z.object({ checked: z.boolean() }), req.body);
    await q(
      db()
        .from('grocery_checks')
        .upsert({ plan_id: pid, product_id: productId, checked: b.checked, checked_by: ctx.tgId, checked_at: new Date().toISOString() }, { onConflict: 'plan_id,product_id' })
    );
    return { ok: true };
  });

  /** Записать отмеченные позиции как покупку в категории «Продукты». */
  app.post('/spaces/:sid/meal-plans/:pid/grocery-purchase', async (req) => {
    const ctx = await requireSpace(req, 'write');
    const { pid } = req.params as { pid: string };
    const b = parse(z.object({ store_id: zId.nullable().optional(), total_minor: zMinor.optional() }), req.body ?? {});
    const list = await groceryList(ctx.spaceId, pid, b.store_id === undefined ? undefined : (b.store_id ?? 'general'));
    const rows = list.items.filter((i) => i.checked && !i.recorded);
    if (!rows.length) throw new HttpError(400, 'Нет отмеченных позиций для записи');
    const cat = await q<{ id: string }[]>(db().from('categories').select('id').eq('space_id', ctx.spaceId).eq('kind', 'grocery').limit(1));
    const space = await getSpace(ctx.spaceId);
    const total = b.total_minor ?? rows.reduce((s, r) => s + (r.cost_minor ?? 0), 0);
    const purchase = await q1<{ id: string }>(
      db()
        .from('purchases')
        .insert({
          space_id: ctx.spaceId,
          store_id: list.store_id,
          category_id: cat[0]?.id ?? null,
          purchased_on: localParts(space.timezone).date,
          total_minor: total,
          note: 'Из списка покупок',
          created_by: ctx.tgId
        })
        .select('id')
        .single()
    );
    await q(
      db()
        .from('purchase_items')
        .insert(rows.map((r) => ({ purchase_id: purchase.id, product_id: r.product_id, label: r.name, qty: r.packs && r.pack_qty ? r.packs * r.pack_qty : r.qty, price_minor: r.cost_minor ?? 0 })))
    );
    await q(db().from('grocery_checks').update({ purchase_id: purchase.id }).eq('plan_id', pid).in('product_id', rows.map((r) => r.product_id)));
    return { purchase_id: purchase.id, total_minor: total, count: rows.length };
  });

  // ---------- План против факта ----------

  app.get('/spaces/:sid/meal-plans/:pid/check', async (req) => {
    const ctx = await requireSpace(req, 'read');
    const { pid } = req.params as { pid: string };
    return planCheck(ctx.spaceId, pid);
  });
}

export async function planCheck(spaceId: string, pid: string) {
  const plan = await q1<{ id: string; start_on: string; days: number; total_minor: number; tier: string } | null>(
    db().from('meal_plans').select('id,start_on,days,total_minor,tier').eq('id', pid).eq('space_id', spaceId).maybeSingle(),
    'План не найден'
  );
  const end = addDays(plan.start_on, plan.days - 1);
  const [items, purchases, categories] = await Promise.all([
    q<{ product_id: string; grams: number }[]>(db().from('meal_plan_items').select('product_id,grams').eq('plan_id', pid)),
    q<{ id: string; total_minor: number; category_id: string | null; purchase_items: { product_id: string | null; qty: number | null; price_minor: number; label: string | null }[] }[]>(
      db().from('purchases').select('id,total_minor,category_id,purchase_items(product_id,qty,price_minor,label)').eq('space_id', spaceId).gte('purchased_on', plan.start_on).lte('purchased_on', end)
    ),
    q<{ id: string; kind: string }[]>(db().from('categories').select('id,kind').eq('space_id', spaceId))
  ]);
  const groceryCats = new Set(categories.filter((c) => c.kind === 'grocery').map((c) => c.id));

  const plannedGrams = new Map<string, number>();
  for (const it of items) plannedGrams.set(it.product_id, (plannedGrams.get(it.product_id) ?? 0) + Number(it.grams) * plan.days);

  const bought = new Map<string, { qty: number; money: number }>();
  let groceryMoney = 0;
  let linkedMoney = 0;
  for (const p of purchases) {
    if (groceryCats.has(p.category_id ?? '')) groceryMoney += Number(p.total_minor);
    for (const it of p.purchase_items ?? []) {
      if (!it.product_id) continue;
      const cur = bought.get(it.product_id) ?? { qty: 0, money: 0 };
      cur.qty += Number(it.qty ?? 0);
      cur.money += Number(it.price_minor);
      linkedMoney += Number(it.price_minor);
      bought.set(it.product_id, cur);
    }
  }

  const allIds = [...new Set([...plannedGrams.keys(), ...bought.keys()])];
  const products = allIds.length
    ? await q<ProductRow[]>(db().from('products').select('id,name,unit,grams_per_piece').in('id', allIds))
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const rows = [...plannedGrams.entries()].map(([id, grams]) => {
    const p = byId.get(id);
    const planned = p ? gramsToUnits(p, grams) : grams;
    const got = bought.get(id)?.qty ?? 0;
    return {
      product_id: id,
      name: p?.name ?? '—',
      unit: p?.unit ?? 'g',
      planned: Math.round(planned * 10) / 10,
      bought: Math.round(got * 10) / 10,
      pct: planned > 0 ? Math.min(999, Math.round((got / planned) * 100)) : 0
    };
  });
  rows.sort((a, b) => a.pct - b.pct);
  const unplanned = [...bought.entries()]
    .filter(([id]) => !plannedGrams.has(id))
    .map(([id, v]) => ({ product_id: id, name: byId.get(id)?.name ?? '—', unit: byId.get(id)?.unit ?? 'g', qty: v.qty, money: v.money }));

  const pct = rows.length ? Math.round((rows.reduce((s, r) => s + Math.min(100, r.pct), 0) / rows.length)) : 0;
  return {
    plan_id: pid,
    start_on: plan.start_on,
    end_on: end,
    items: rows,
    unplanned,
    done_count: rows.filter((r) => r.pct >= 90).length,
    total_count: rows.length,
    pct,
    money: { planned: Number(plan.total_minor), grocery_spent: groceryMoney, linked: linkedMoney, unlinked: Math.max(0, groceryMoney - linkedMoney) }
  };
}
