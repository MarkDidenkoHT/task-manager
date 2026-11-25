import { createRequire } from 'node:module';
import type { MealSlot, MealType } from './defaults.js';
import type { Targets } from './targets.js';

export type Tier = 'cheap' | 'middle' | 'top';
export const TIERS: Tier[] = ['cheap', 'middle', 'top'];

export interface EngineProduct {
  id: string;
  name: string;
  unit: 'g' | 'ml' | 'pcs';
  grams_per_piece: number | null;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  min_g_day: number;
  max_g_day: number;
  quality: number;
  slots: MealType[];
  /** копеек за грамм */
  cost_per_g: number;
}

export interface EnginePerson {
  profile_id: string;
  name: string;
  targets: Targets;
  meals: MealSlot[];
}

export interface PlanItem {
  product_id: string;
  meal_no: number; // 1..6
  grams: number;
}

export interface Macro {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface PersonResult {
  profile_id: string;
  name: string;
  ok: boolean;
  relax_level: number;
  items: PlanItem[];
  per_meal: (Macro & { meal_no: number; type: MealType; target_kcal: number })[];
  day: Macro;
  targets: Targets;
  daily_cost_minor: number;
  warnings: string[];
  error?: string;
}

export interface TierOptions {
  /** Стоимость дешёвого варианта в день (для ограничения премиального) */
  cheapDailyCost?: number;
  topCostFactor: number;
}

type Loader = typeof import('highs').default;
const highsLoader: Loader = createRequire(import.meta.url)('highs');
type Highs = Awaited<ReturnType<Loader>>;
let highsPromise: Promise<Highs> | null = null;
function highs(): Promise<Highs> {
  highsPromise ??= highsLoader();
  return highsPromise;
}

interface Relax {
  macroBand: number; // ± для жиров и углеводов
  proteinFactor: number;
  distinctFactor: number; // множитель минимального разнообразия
  capShare: number; // доля max_g_day (средний вариант)
}

const RELAX_LEVELS: Relax[] = [
  { macroBand: 0.15, proteinFactor: 1, distinctFactor: 1, capShare: 0.6 },
  { macroBand: 0.25, proteinFactor: 1, distinctFactor: 1, capShare: 0.6 },
  { macroBand: 0.25, proteinFactor: 0.9, distinctFactor: 1, capShare: 0.6 },
  { macroBand: 0.25, proteinFactor: 0.9, distinctFactor: 0.5, capShare: 1 }
];

const RELAX_NOTES = [
  '',
  'Цели по жирам и углеводам ослаблены до ±25%.',
  'Цели по жирам и углеводам ослаблены до ±25%, белок — до 90% от цели.',
  'Ослаблены цели по макросам и требование к разнообразию продуктов.'
];

type Drop = 'meals' | 'min' | 'max';

const f = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : r.toString();
};

function term(coef: number, name: string): string {
  if (Math.abs(coef) < 1e-9) return '';
  return (coef >= 0 ? ' + ' : ' - ') + f(Math.abs(coef)) + ' ' + name;
}

function expr(terms: [number, string][]): string {
  const s = terms.map(([c, n]) => term(c, n)).join('');
  if (!s) return '';
  return s.startsWith(' + ') ? s.slice(3) : '-' + s.slice(3);
}

interface Model {
  lp: string;
  vars: { name: string; p: number; m: number }[];
}

function buildModel(
  person: EnginePerson,
  products: EngineProduct[],
  tier: Tier,
  relax: Relax,
  opts: TierOptions,
  drop: Set<Drop>
): Model | null {
  const T = person.targets;
  const meals = person.meals;
  const vars: { name: string; p: number; m: number }[] = [];
  const byProduct: string[][] = products.map(() => []);
  const byMeal: [number, string][][] = meals.map(() => []);

  products.forEach((pr, i) => {
    meals.forEach((ml, m) => {
      if (!pr.slots.includes(ml.type)) return;
      const name = `x_${i}_${m}`;
      vars.push({ name, p: i, m });
      byProduct[i].push(name);
      byMeal[m].push([pr.kcal_100 / 100, name]);
    });
  });
  if (!vars.length) return null;

  const all = (coef: (p: EngineProduct) => number): [number, string][] =>
    vars.map((v) => [coef(products[v.p]), v.name]);

  const rows: string[] = [];
  const kcal = all((p) => p.kcal_100 / 100);
  const prot = all((p) => p.protein_100 / 100);
  const fat = all((p) => p.fat_100 / 100);
  const carb = all((p) => p.carbs_100 / 100);
  rows.push(`kcal_lo: ${expr(kcal)} >= ${f(0.97 * T.kcal)}`);
  rows.push(`kcal_hi: ${expr(kcal)} <= ${f(1.03 * T.kcal)}`);
  rows.push(`prot_lo: ${expr(prot)} >= ${f(relax.proteinFactor * T.protein)}`);
  if (T.fat > 0) {
    rows.push(`fat_lo: ${expr(fat)} >= ${f((1 - relax.macroBand) * T.fat)}`);
    rows.push(`fat_hi: ${expr(fat)} <= ${f((1 + relax.macroBand) * T.fat)}`);
  }
  if (T.carbs > 0) {
    rows.push(`carb_lo: ${expr(carb)} >= ${f((1 - relax.macroBand) * T.carbs)}`);
    rows.push(`carb_hi: ${expr(carb)} <= ${f((1 + relax.macroBand) * T.carbs)}`);
  }

  if (!drop.has('meals')) {
    meals.forEach((ml, m) => {
      const target = (ml.share / 100) * T.kcal;
      if (!byMeal[m].length) {
        rows.push(`meal_empty_${m}: 0 x_dummy >= 1`);
        return;
      }
      rows.push(`meal_lo_${m}: ${expr(byMeal[m])} >= ${f(0.9 * target)}`);
      rows.push(`meal_hi_${m}: ${expr(byMeal[m])} <= ${f(1.1 * target)}`);
    });
  }

  const usable = products.map((_, i) => byProduct[i].length > 0);
  const capShare = tier === 'middle' ? relax.capShare : 1;

  products.forEach((pr, i) => {
    if (!usable[i]) return;
    const tot = expr(byProduct[i].map((n) => [1, n]));
    if (!drop.has('min') && pr.min_g_day > 0) rows.push(`pmin_${i}: ${tot} >= ${f(pr.min_g_day)}`);
    if (!drop.has('max')) rows.push(`pmax_${i}: ${tot} <= ${f(pr.max_g_day * capShare)}`);
  });

  const binaries: string[] = [];
  const extraBounds: string[] = [];
  const usableCount = usable.filter(Boolean).length;
  if (tier === 'middle' || tier === 'top') {
    const want = tier === 'middle' ? 8 : 12;
    const minDistinct = Math.min(usableCount, Math.max(1, Math.floor(want * relax.distinctFactor)));
    const ys: [number, string][] = [];
    products.forEach((pr, i) => {
      if (!usable[i]) return;
      const y = `y_${i}`;
      binaries.push(y);
      ys.push([1, y]);
      rows.push(`link_${i}: ${expr([...byProduct[i].map((n): [number, string] => [1, n]), [-30, y]])} >= 0`);
    });
    rows.push(`distinct: ${expr(ys)} >= ${minDistinct}`);
  }

  const costTerms = all((p) => p.cost_per_g);
  let objective: string;
  if (tier === 'cheap') {
    objective = `Minimize\n obj: ${expr(costTerms) || '0 x_dummy'}`;
  } else if (tier === 'middle') {
    // Штраф за перекос: минимизируем максимальную суточную массу одного продукта.
    const avgCost = products.reduce((s, p) => s + p.cost_per_g, 0) / Math.max(1, products.length);
    const lambda = Math.max(0.05, avgCost * 1.5);
    products.forEach((_, i) => {
      if (!usable[i]) return;
      rows.push(`spread_${i}: ${expr([...byProduct[i].map((n): [number, string] => [1, n]), [-1, 'tmax']])} <= 0`);
    });
    objective = `Minimize\n obj: ${expr([...costTerms, [lambda, 'tmax']])}`;
  } else {
    if (opts.cheapDailyCost != null && opts.cheapDailyCost > 0) {
      rows.push(`budget: ${expr(costTerms)} <= ${f(opts.cheapDailyCost * opts.topCostFactor)}`);
    }
    const q = all((p) => p.quality * (p.kcal_100 / 100) - 0.001 * p.cost_per_g);
    objective = `Maximize\n obj: ${expr(q)}`;
  }

  const bounds = vars.map((v) => ` 0 <= ${v.name} <= ${f(products[v.p].max_g_day * (drop.has('max') ? 10 : 1))}`);
  bounds.push(' x_dummy = 0');
  bounds.push(...extraBounds);

  let lp = `${objective}\nSubject To\n${rows.map((r) => ' ' + r).join('\n')}\nBounds\n${bounds.join('\n')}\n`;
  if (binaries.length) lp += `Binary\n ${binaries.join(' ')}\n`;
  lp += 'End\n';
  return { lp, vars };
}

interface SolveOut {
  ok: boolean;
  values: Map<string, number>;
}

async function run(lp: string): Promise<SolveOut> {
  const h = await highs();
  try {
    const r = h.solve(lp, { time_limit: 4, mip_rel_gap: 0.02, output_flag: false });
    const hasPrimal = r.Status === 'Optimal' || r.Status === 'Time limit reached';
    if (!hasPrimal) return { ok: false, values: new Map() };
    const values = new Map<string, number>();
    for (const [name, col] of Object.entries(r.Columns)) {
      const v = (col as { Primal?: number }).Primal;
      if (typeof v !== 'number') return { ok: false, values: new Map() };
      values.set(name, v);
    }
    return { ok: true, values };
  } catch {
    return { ok: false, values: new Map() };
  }
}

function summarize(
  person: EnginePerson,
  products: EngineProduct[],
  model: Model,
  values: Map<string, number>
): Pick<PersonResult, 'items' | 'per_meal' | 'day' | 'daily_cost_minor'> {
  const items: PlanItem[] = [];
  const perMeal = person.meals.map((ml, m) => ({
    meal_no: m + 1,
    type: ml.type,
    target_kcal: Math.round((ml.share / 100) * person.targets.kcal),
    kcal: 0,
    protein: 0,
    fat: 0,
    carbs: 0
  }));
  let cost = 0;
  for (const v of model.vars) {
    const g = values.get(v.name) ?? 0;
    if (g < 0.5) continue;
    const grams = Math.round(g * 10) / 10;
    const p = products[v.p];
    items.push({ product_id: p.id, meal_no: v.m + 1, grams });
    const pm = perMeal[v.m];
    pm.kcal += (p.kcal_100 * grams) / 100;
    pm.protein += (p.protein_100 * grams) / 100;
    pm.fat += (p.fat_100 * grams) / 100;
    pm.carbs += (p.carbs_100 * grams) / 100;
    cost += p.cost_per_g * grams;
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const day = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const pm of perMeal) {
    day.kcal += pm.kcal;
    day.protein += pm.protein;
    day.fat += pm.fat;
    day.carbs += pm.carbs;
    pm.kcal = Math.round(pm.kcal);
    pm.protein = r1(pm.protein);
    pm.fat = r1(pm.fat);
    pm.carbs = r1(pm.carbs);
  }
  return {
    items,
    per_meal: perMeal,
    day: { kcal: Math.round(day.kcal), protein: r1(day.protein), fat: r1(day.fat), carbs: r1(day.carbs) },
    daily_cost_minor: Math.round(cost)
  };
}

/** Решает один вариант (tier) для одного человека с последовательным ослаблением ограничений. */
export async function solvePerson(
  person: EnginePerson,
  products: EngineProduct[],
  tier: Tier,
  opts: TierOptions
): Promise<PersonResult> {
  const base: PersonResult = {
    profile_id: person.profile_id,
    name: person.name,
    ok: false,
    relax_level: -1,
    items: [],
    per_meal: [],
    day: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    targets: person.targets,
    daily_cost_minor: 0,
    warnings: []
  };
  if (!products.length) return { ...base, error: 'Нет продуктов с ценами для расчёта.' };

  const levels = tier === 'cheap' ? RELAX_LEVELS.slice(0, 3) : RELAX_LEVELS;
  for (let lvl = 0; lvl < levels.length; lvl++) {
    const model = buildModel(person, products, tier, levels[lvl], opts, new Set());
    if (!model) return { ...base, error: 'Ни один продукт не подходит к выбранным приёмам пищи.' };
    const out = await run(model.lp);
    if (out.ok) {
      const warnings: string[] = [];
      if (lvl > 0) warnings.push(RELAX_NOTES[lvl]);
      return { ...base, ok: true, relax_level: lvl, warnings, ...summarize(person, products, model, out.values) };
    }
  }

  // Диагностика: какое ограничение мешает.
  const last = levels[Math.min(2, levels.length - 1)];
  const tries: [Drop, string][] = [
    ['max', 'Цели достигаются только с превышением максимальных граммовок продуктов. Добавьте продукты или увеличьте максимумы.'],
    ['meals', `Не удаётся распределить калории по ${person.meals.length} приёмам пищи. Уменьшите число приёмов или добавьте продукты для завтрака и перекусов.`],
    ['min', 'Мешают минимальные граммовки продуктов в день. Уменьшите минимумы.']
  ];
  for (const [drop, message] of tries) {
    const model = buildModel(person, products, tier, last, opts, new Set([drop]));
    if (!model) break;
    const out = await run(model.lp);
    if (out.ok) {
      if (drop === 'max') {
        // Разрешено вернуть решение, но с явным предупреждением.
        return {
          ...base,
          ok: true,
          relax_level: 2,
          warnings: [message],
          ...summarize(person, products, model, out.values)
        };
      }
      return { ...base, error: message };
    }
  }
  return {
    ...base,
    error: 'Цели по калориям и белку недостижимы с текущим набором продуктов. Добавьте продукты (особенно белковые) или проверьте цели профиля.'
  };
}

/** Привязка раскладки приёмов к числу приёмов. */
export function layoutFor(count: number, layouts: Record<string, MealSlot[]>): MealSlot[] {
  const l = layouts[String(count)];
  const total = l.reduce((s, x) => s + x.share, 0) || 100;
  return l.map((x) => ({ type: x.type, share: (x.share * 100) / total }));
}
