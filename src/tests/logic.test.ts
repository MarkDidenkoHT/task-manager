import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../auth.js';
import { computeTargets } from '../lib/targets.js';
import { DEFAULT_BRACKETS, netIncome, progressiveTax } from '../lib/tax.js';
import { suggestNext } from '../lib/progression.js';
import { computeStreak } from '../lib/streak.js';
import { DEFAULT_MEAL_LAYOUTS, STARTER_PRODUCTS } from '../lib/defaults.js';
import { layoutFor, solvePerson, TIERS, type EngineProduct } from '../lib/mealEngine.js';

function signInitData(fields: Record<string, string>, token: string): string {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

test('initData: верная подпись принимается, подделка отклоняется', () => {
  const token = '123:ABC';
  const now = 1_700_000_000;
  const data = signInitData({ auth_date: String(now - 60), user: JSON.stringify({ id: 42, first_name: 'Марк' }), start_param: 'inv' }, token);
  const info = verifyInitData(data, token, 86400, now);
  assert.equal(info.user.id, 42);
  assert.equal(info.startParam, 'inv');
  assert.throws(() => verifyInitData(data.replace('42', '43'), token, 86400, now));
  assert.throws(() => verifyInitData(data, '123:OTHER', 86400, now));
  assert.throws(() => verifyInitData(data, token, 86400, now + 90000), /устарели/);
});

test('цели КБЖУ по Миффлину — Сан-Жеору', () => {
  const t = computeTargets(
    { kind: 'adult', sex: 'm', birth_date: '1990-01-01', height_cm: 180, weight_kg: 80, activity: 1.55, goal_offset_kcal: -400, kcal_override: null, protein_g_per_kg: 1.8, fat_g_per_kg: 0.9 },
    new Date('2026-06-01T00:00:00Z')
  )!;
  // BMR = 800 + 1125 - 180 + 5 = 1750; TDEE = 2712.5; цель = 2312.5
  assert.equal(t.bmr, 1750);
  assert.equal(t.kcal, 2313);
  assert.equal(t.protein, 144);
  assert.equal(t.fat, 72);
  const child = computeTargets({ kind: 'child', sex: null, birth_date: null, height_cm: null, weight_kg: null, activity: null, goal_offset_kcal: 0, kcal_override: 1600, protein_g_per_kg: null, fat_g_per_kg: null });
  assert.equal(child!.kcal, 1600);
  assert.equal(computeTargets({ kind: 'child', sex: null, birth_date: null, height_cm: null, weight_kg: null, activity: null, goal_offset_kcal: 0, kcal_override: null, protein_g_per_kg: null, fat_g_per_kg: null }), null);
});

test('НДФЛ по прогрессивной шкале', () => {
  assert.equal(progressiveTax(1_000_000_00, DEFAULT_BRACKETS), 130_000_00);
  // 2.4 млн × 13% + 0.6 млн × 15% = 312 000 + 90 000
  assert.equal(progressiveTax(3_000_000_00, DEFAULT_BRACKETS), 402_000_00);
  const r = netIncome([{ id: 'a', owner_tg_id: 1, name: 'Зарплата', gross_monthly_minor: 100_000_00, tax_mode: 'ndfl_progressive', flat_rate: null, active: true }], DEFAULT_BRACKETS);
  assert.equal(r[0].net_monthly_minor, 87_000_00);
  const npd = netIncome([{ id: 'b', owner_tg_id: 1, name: 'Самозанятость', gross_monthly_minor: 50_000_00, tax_mode: 'npd', flat_rate: 6, active: true }], DEFAULT_BRACKETS);
  assert.equal(npd[0].net_monthly_minor, 47_000_00);
});

test('двойная прогрессия', () => {
  const pe = { sets: 3, target_reps: 10, load_kg: 10, rep_ceiling: 15, load_step_kg: 2.5, rep_step: 1 };
  assert.equal(suggestNext(pe, [1, 2, 3].map((n) => ({ set_no: n, reps: 15, load_kg: 10 }))).load_kg, 12.5);
  assert.equal(suggestNext(pe, [1, 2, 3].map((n) => ({ set_no: n, reps: 11, load_kg: 10 }))).target_reps, 11);
  assert.equal(suggestNext(pe, [{ set_no: 1, reps: 11, load_kg: 10 }, { set_no: 2, reps: 9, load_kg: 10 }, { set_no: 3, reps: 8, load_kg: 10 }]).action, 'keep');
  const bw = { sets: 1, target_reps: 20, load_kg: 0, rep_ceiling: 25, load_step_kg: 0, rep_step: 2 };
  assert.equal(suggestNext(bw, [{ set_no: 1, reps: 25, load_kg: 0 }]).target_reps, 22);
});

test('серии напоминаний', () => {
  const all = [1, 2, 3, 4, 5, 6, 7];
  const ev = (d: string, s: 'done' | 'skipped' | 'sent') => ({ due_on: d, status: s });
  assert.equal(computeStreak([ev('2026-11-23', 'done'), ev('2026-11-24', 'done')], all, '2026-11-25', '2026-01-01'), 2);
  assert.equal(computeStreak([ev('2026-11-23', 'done'), ev('2026-11-24', 'done'), ev('2026-11-25', 'done')], all, '2026-11-25', '2026-01-01'), 3);
  assert.equal(computeStreak([ev('2026-11-23', 'skipped'), ev('2026-11-24', 'done')], all, '2026-11-25', '2026-01-01'), 1);
  // Только пн/ср (2026-11-23 — понедельник): вторник не влияет
  assert.equal(computeStreak([ev('2026-11-23', 'done'), ev('2026-11-25', 'done')], [1, 3], '2026-11-25', '2026-01-01'), 2);
});

test('движок питания: три варианта для набора базовых продуктов', async () => {
  const products: EngineProduct[] = STARTER_PRODUCTS.map((p, i) => ({
    id: 'p' + i,
    name: p.name,
    unit: p.unit,
    grams_per_piece: p.grams_per_piece ?? null,
    kcal_100: p.kcal_100,
    protein_100: p.protein_100,
    fat_100: p.fat_100,
    carbs_100: p.carbs_100,
    min_g_day: 0,
    max_g_day: p.max_g_day,
    quality: p.quality,
    slots: p.slots,
    cost_per_g: 0.05 + ((i * 7) % 13) / 10
  }));
  const targets = { kcal: 2400, protein: 150, fat: 75, carbs: 280, bmr: null, tdee: null, source: 'override' as const };
  let cheap = 0;
  for (const tier of TIERS) {
    for (const meals of [3, 5]) {
      const r = await solvePerson(
        { profile_id: 'me', name: 'Я', targets, meals: layoutFor(meals, DEFAULT_MEAL_LAYOUTS) },
        products,
        tier,
        { topCostFactor: 2.2, cheapDailyCost: cheap || undefined }
      );
      assert.ok(r.ok, `${tier}/${meals}: ${r.error}`);
      assert.ok(r.day.kcal >= 2400 * 0.97 - 1 && r.day.kcal <= 2400 * 1.03 + 1, `${tier} kcal ${r.day.kcal}`);
      assert.ok(r.day.protein >= 150 * 0.9 - 1, `${tier} protein ${r.day.protein}`);
      const distinct = new Set(r.items.map((i) => i.product_id)).size;
      if (tier === 'middle' && r.relax_level < 3) assert.ok(distinct >= 8, `middle distinct ${distinct}`);
      if (tier === 'cheap' && meals === 3) cheap = r.daily_cost_minor;
      console.log(`${tier} ${meals} приёмов: ${r.daily_cost_minor} коп/день, продуктов ${distinct}, ослабление ${r.relax_level}`);
    }
  }
});

test('движок питания: недостижимая цель даёт понятную ошибку', async () => {
  const products: EngineProduct[] = [
    { id: 'a', name: 'Яблоки', unit: 'g', grams_per_piece: null, kcal_100: 47, protein_100: 0.4, fat_100: 0.4, carbs_100: 9.8, min_g_day: 0, max_g_day: 300, quality: 2, slots: ['breakfast', 'main', 'snack'], cost_per_g: 0.1 }
  ];
  const r = await solvePerson(
    { profile_id: 'me', name: 'Я', targets: { kcal: 2400, protein: 150, fat: 75, carbs: 280, bmr: null, tdee: null, source: 'override' }, meals: layoutFor(3, DEFAULT_MEAL_LAYOUTS) },
    products,
    'cheap',
    { topCostFactor: 2.2 }
  );
  assert.equal(r.ok, false);
  assert.ok(r.error && r.error.length > 10);
});
