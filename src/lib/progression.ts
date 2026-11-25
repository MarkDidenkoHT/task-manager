export interface ProgramExercise {
  sets: number;
  target_reps: number;
  load_kg: number;
  rep_ceiling: number;
  load_step_kg: number;
  rep_step: number;
}

export interface LoggedSet {
  set_no: number;
  reps: number;
  load_kg: number;
}

export interface Suggestion {
  action: 'load_up' | 'reps_up' | 'keep';
  target_reps: number;
  load_kg: number;
  rep_ceiling: number;
  text: string;
}

const fmtKg = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');

/**
 * Двойная прогрессия.
 * - Все подходы достигли потолка повторов → вес + шаг, повторы сбрасываются к цели.
 *   Если шаг веса 0 (своё тело) — растут только повторы, потолок сдвигается вместе с ними.
 * - Иначе все подходы достигли цели → цель + шаг повторов (не выше потолка).
 * - Иначе — без изменений.
 */
export function suggestNext(pe: ProgramExercise, sets: LoggedSet[], timed = false): Suggestion {
  const unit = timed ? 'с' : 'повт.';
  const keep: Suggestion = {
    action: 'keep',
    target_reps: pe.target_reps,
    load_kg: Number(pe.load_kg),
    rep_ceiling: pe.rep_ceiling,
    text: `Повторить: ${pe.sets}×${pe.target_reps} ${unit}` + (Number(pe.load_kg) > 0 ? ` · ${fmtKg(Number(pe.load_kg))} кг` : '')
  };
  if (!sets.length || sets.length < pe.sets) return keep;

  const step = Number(pe.load_step_kg);
  const repStep = Math.max(1, pe.rep_step);
  const allCeiling = sets.every((s) => s.reps >= pe.rep_ceiling);
  const allTarget = sets.every((s) => s.reps >= pe.target_reps);

  if (allCeiling && step > 0) {
    const load = Number(pe.load_kg) + step;
    return {
      action: 'load_up',
      target_reps: pe.target_reps,
      load_kg: load,
      rep_ceiling: pe.rep_ceiling,
      text: `В следующий раз: ${fmtKg(load)} кг × ${pe.target_reps} ${unit}`
    };
  }
  if (allCeiling && step === 0) {
    const reps = pe.target_reps + repStep;
    return {
      action: 'reps_up',
      target_reps: reps,
      load_kg: Number(pe.load_kg),
      rep_ceiling: Math.max(pe.rep_ceiling, reps) + repStep,
      text: `В следующий раз: ${reps} ${unit}`
    };
  }
  if (allTarget) {
    const reps = Math.min(pe.target_reps + repStep, Math.max(pe.rep_ceiling, pe.target_reps + repStep));
    return {
      action: 'reps_up',
      target_reps: reps,
      load_kg: Number(pe.load_kg),
      rep_ceiling: Math.max(pe.rep_ceiling, reps),
      text: `В следующий раз: ${reps} ${unit}` + (Number(pe.load_kg) > 0 ? ` · ${fmtKg(Number(pe.load_kg))} кг` : '')
    };
  }
  return keep;
}
