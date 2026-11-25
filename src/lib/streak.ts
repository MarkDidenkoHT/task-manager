import { addDays, isoWeekday } from './dates.js';

export interface EventLite {
  due_on: string;
  status: 'pending' | 'sent' | 'done' | 'snoozed' | 'skipped';
}

/**
 * Серия: подряд идущие запланированные дни со статусом done, заканчивая сегодня или вчера.
 * Пропуск (skipped) или невыполненный запланированный день прерывают серию;
 * незапланированные дни не влияют. Сегодня, если ещё не выполнено, не прерывает серию.
 */
export function computeStreak(events: EventLite[], weekdays: number[], today: string, createdOn: string): number {
  const byDay = new Map(events.map((e) => [e.due_on, e.status]));
  const days = new Set(weekdays);
  let streak = 0;
  let day = today;
  if (byDay.get(today) !== 'done') day = addDays(today, -1);
  for (let i = 0; i < 3660; i++) {
    if (day < createdOn) break;
    if (days.has(isoWeekday(day))) {
      if (byDay.get(day) === 'done') streak++;
      else break;
    }
    day = addDays(day, -1);
  }
  return streak;
}
