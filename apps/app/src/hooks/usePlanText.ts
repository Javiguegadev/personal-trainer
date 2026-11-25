import type { PlannedWorkout } from '@pt/contracts';
import { formatMinuteOfDay } from '@pt/core';
import { useI18n } from './useI18n';

/** How a planned session is written (spec 013 AC2, AC14): "Rutina B · 18:30", "Fútbol · partido 11:00". */
export function usePlanText() {
  const { t, locale } = useI18n();
  const name = (planned: Pick<PlannedWorkout, 'kind' | 'activity' | 'name'>) =>
    planned.name ??
    (planned.kind === 'gym'
      ? t.plan.session.freeGym
      : t.training.activities[planned.activity ?? 'other']);

  return {
    /** The routine session or workout name, the activity, or "Gimnasio libre". */
    name,
    time: (minute: number) => formatMinuteOfDay(minute, locale),
    /** The name, "partido" for a match, and the start time when there is one. */
    line: (
      planned: Pick<PlannedWorkout, 'kind' | 'activity' | 'name' | 'isMatch' | 'startMinute'>,
    ) => {
      const time =
        planned.startMinute === null ? null : formatMinuteOfDay(planned.startMinute, locale);
      const tail = [planned.isMatch ? t.plan.session.match : null, time].filter(Boolean).join(' ');
      return tail ? `${name(planned)} · ${tail}` : name(planned);
    },
  };
}
