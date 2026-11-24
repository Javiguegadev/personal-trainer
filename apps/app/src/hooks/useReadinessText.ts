import type { ReadinessHeadline, ReadinessLine, SessionCut, SessionReadiness } from '@pt/core';
import { useI18n } from './useI18n';

/**
 * How the readiness is written (spec 011 AC4, AC8, AC9): one reason per line (decision c) and what the
 * routine session loses. Nothing names a condition (Safety).
 */
export function useReadinessText() {
  const { t, format } = useI18n();
  const r = t.readiness;
  const reason = (headline: ReadinessHeadline) => r.headline[headline];
  const cut = (removed: SessionCut) =>
    removed.sets && removed.exercise ? r.cut.both : removed.exercise ? r.cut.exercise : r.cut.sets;
  const withCut = (headline: ReadinessHeadline, removed: SessionCut) =>
    format(r.withCut, { reason: reason(headline), cut: cut(removed) });
  const reasonOnly = (headline: ReadinessHeadline) =>
    format(r.reasonOnly, { reason: reason(headline) });

  return {
    /** The line on Today once the check-in is saved (AC4, AC9). */
    line(line: ReadinessLine): string {
      switch (line.type) {
        case 'checkin':
          return r.checkin;
        case 'ready':
          return r.ready;
        case 'routine':
          return withCut(line.headline, line.cut);
        case 'activity':
          return format(r.withAdvice, {
            reason: reason(line.headline),
            advice: line.match ? r.match : r.activity,
          });
        case 'reason':
          return reasonOnly(line.headline);
      }
    },
    /** The banner of a live session (AC8): what was removed, or only the reason. */
    banner(readiness: SessionReadiness): string {
      const removed = {
        sets: readiness.removedSets.length > 0,
        exercise: readiness.removedExercise !== null,
      };
      return removed.sets || removed.exercise
        ? withCut(readiness.headline, removed)
        : reasonOnly(readiness.headline);
    },
  };
}
