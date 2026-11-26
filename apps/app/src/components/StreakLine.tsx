import type { Streak } from '@pt/contracts';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';

/**
 * The logging streak (spec 014 AC9, AC10): weeks in a row with 4 days logged. Without one it says only
 * how a streak starts, never as a push; a streak that ended says nothing about it. Hidden with an
 * eating-disorder signal.
 */
export function StreakLine({ streak }: { streak: Streak }) {
  const { t, format } = useI18n();
  if (streak.hidden) return null;
  const s = t.streak;
  const text =
    streak.weeks === 0
      ? s.start
      : streak.weeks === 1
        ? s.weeksOne
        : format(s.weeksOther, { count: String(streak.weeks) });
  return (
    <AppText tone={streak.weeks === 0 ? 'muted' : 'default'} testID="streak-line">
      {text}
    </AppText>
  );
}
