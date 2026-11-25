export interface ProfileBody {
  kind: 'adult' | 'child' | 'pet';
  sex: 'm' | 'f' | null;
  birth_date: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity: number | null;
  goal_offset_kcal: number;
  kcal_override: number | null;
  protein_g_per_kg: number | null;
  fat_g_per_kg: number | null;
}

export interface Targets {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  bmr: number | null;
  tdee: number | null;
  source: 'formula' | 'override' | 'child';
}

export const ACTIVITY_PRESETS = [
  { value: 1.2, label: 'Сидячий образ жизни' },
  { value: 1.375, label: 'Лёгкая активность' },
  { value: 1.55, label: 'Умеренная активность' },
  { value: 1.725, label: 'Высокая активность' },
  { value: 1.9, label: 'Очень высокая активность' }
];

export function ageYears(birth: string, today = new Date()): number {
  const b = new Date(birth + 'T00:00:00Z');
  let age = today.getUTCFullYear() - b.getUTCFullYear();
  const m = today.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** Детям: фиксированное распределение 15% белок, 30% жиры, 55% углеводы. */
const CHILD_SPLIT = { protein: 0.15, fat: 0.3, carbs: 0.55 };

/**
 * Расчёт целей КБЖУ (Миффлин — Сан-Жеор). Возвращает null, если данных недостаточно.
 */
export function computeTargets(p: ProfileBody, today = new Date()): Targets | null {
  if (p.kind === 'pet') return null;

  if (p.kind === 'child') {
    if (!p.kcal_override) return null;
    const kcal = p.kcal_override;
    return {
      kcal,
      protein: round1((kcal * CHILD_SPLIT.protein) / 4),
      fat: round1((kcal * CHILD_SPLIT.fat) / 9),
      carbs: round1((kcal * CHILD_SPLIT.carbs) / 4),
      bmr: null,
      tdee: null,
      source: 'child'
    };
  }

  const kg = num(p.weight_kg);
  if (!kg) {
    if (!p.kcal_override) return null;
  }

  let bmr: number | null = null;
  let tdee: number | null = null;
  if (kg && p.height_cm && p.birth_date && p.sex) {
    const age = ageYears(p.birth_date, today);
    bmr = 10 * kg + 6.25 * num(p.height_cm) - 5 * age + (p.sex === 'm' ? 5 : -161);
    tdee = bmr * (num(p.activity) || 1.375);
  }

  let kcal: number;
  let source: Targets['source'];
  if (p.kcal_override) {
    kcal = p.kcal_override;
    source = 'override';
  } else if (tdee != null) {
    kcal = tdee + (p.goal_offset_kcal || 0);
    source = 'formula';
  } else {
    return null;
  }

  let protein: number;
  let fat: number;
  if (kg) {
    protein = num(p.protein_g_per_kg ?? 1.8) * kg;
    fat = num(p.fat_g_per_kg ?? 0.9) * kg;
  } else {
    protein = (kcal * 0.25) / 4;
    fat = (kcal * 0.3) / 9;
  }
  let carbs = (kcal - 4 * protein - 9 * fat) / 4;
  if (carbs < 0) carbs = 0;

  return {
    kcal: Math.round(kcal),
    protein: round1(protein),
    fat: round1(fat),
    carbs: round1(carbs),
    bmr: bmr == null ? null : Math.round(bmr),
    tdee: tdee == null ? null : Math.round(tdee),
    source
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
