export interface Bracket {
  from_annual_minor: number;
  rate: number; // проценты
}

export interface IncomeSource {
  id: string;
  owner_tg_id: number;
  name: string;
  gross_monthly_minor: number;
  tax_mode: 'ndfl_progressive' | 'flat' | 'npd' | 'none';
  flat_rate: number | null;
  active: boolean;
}

/** Прогрессивная шкала НДФЛ резидента РФ (в копейках). Это данные — редактируются в настройках. */
export const DEFAULT_BRACKETS: Bracket[] = [
  { from_annual_minor: 0, rate: 13 },
  { from_annual_minor: 2_400_000_00, rate: 15 },
  { from_annual_minor: 5_000_000_00, rate: 18 },
  { from_annual_minor: 20_000_000_00, rate: 20 },
  { from_annual_minor: 50_000_000_00, rate: 22 }
];

/** Годовой налог по прогрессивной шкале. */
export function progressiveTax(annualGross: number, brackets: Bracket[]): number {
  const sorted = [...brackets].sort((a, b) => a.from_annual_minor - b.from_annual_minor);
  let tax = 0;
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i].from_annual_minor;
    const to = i + 1 < sorted.length ? sorted[i + 1].from_annual_minor : Infinity;
    if (annualGross <= from) break;
    tax += ((Math.min(annualGross, to) - from) * Number(sorted[i].rate)) / 100;
  }
  return tax;
}

export interface NetResult {
  id: string;
  name: string;
  owner_tg_id: number;
  gross_monthly_minor: number;
  tax_monthly_minor: number;
  net_monthly_minor: number;
}

/**
 * Чистый месячный доход по каждому источнику. Для НДФЛ доходы одного человека
 * складываются (шкала применяется к сумме), налог распределяется пропорционально.
 * Месячная сумма — среднегодовая: реальное удержание идёт нарастающим итогом.
 */
export function netIncome(sources: IncomeSource[], brackets: Bracket[]): NetResult[] {
  const active = sources.filter((s) => s.active);
  const ndflByOwner = new Map<number, number>();
  for (const s of active) {
    if (s.tax_mode === 'ndfl_progressive') {
      ndflByOwner.set(s.owner_tg_id, (ndflByOwner.get(s.owner_tg_id) ?? 0) + Number(s.gross_monthly_minor) * 12);
    }
  }
  return active.map((s) => {
    const gross = Number(s.gross_monthly_minor);
    let tax = 0;
    switch (s.tax_mode) {
      case 'ndfl_progressive': {
        const annual = ndflByOwner.get(s.owner_tg_id) ?? 0;
        const totalTax = progressiveTax(annual, brackets.length ? brackets : DEFAULT_BRACKETS);
        tax = annual > 0 ? (totalTax / 12) * ((gross * 12) / annual) : 0;
        break;
      }
      case 'flat':
      case 'npd':
        tax = (gross * Number(s.flat_rate ?? 0)) / 100;
        break;
      case 'none':
        tax = 0;
    }
    tax = Math.round(tax);
    return {
      id: s.id,
      name: s.name,
      owner_tg_id: s.owner_tg_id,
      gross_monthly_minor: gross,
      tax_monthly_minor: tax,
      net_monthly_minor: gross - tax
    };
  });
}

export function monthlyAmount(amount: number, period: 'month' | 'quarter' | 'year'): number {
  if (period === 'quarter') return Math.round(Number(amount) / 3);
  if (period === 'year') return Math.round(Number(amount) / 12);
  return Number(amount);
}
