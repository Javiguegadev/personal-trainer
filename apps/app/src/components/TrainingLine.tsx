import type { PlannedActivity, TrainingFocus } from '@pt/contracts';
import {
  formatList,
  formatNumber,
  sportActivityNames,
  trainingMinutesPerWeek,
  trainingSessionsPerWeek,
} from '@pt/core';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Card } from './Card';

/**
 * The planned training of the week in one line (spec 003 AC3), and what the user trains for (spec 004
 * AC12): "For: gain strength", or "For: perform in football and padel" with the sport names.
 */
export function TrainingLine({
  activities,
  focus,
}: {
  activities: readonly PlannedActivity[];
  focus: TrainingFocus | null;
}) {
  const { t, format, locale } = useI18n();
  const sessions = trainingSessionsPerWeek(activities);
  const minutes = trainingMinutesPerWeek(activities);
  const sports = sportActivityNames(activities);
  return (
    <Card title={t.today.trainingTitle} testID="training-line">
      <AppText>
        {sessions === 0
          ? t.today.noTraining
          : format(t.today.training, {
              sessions:
                sessions === 1
                  ? t.today.sessionsOne
                  : format(t.today.sessionsOther, { count: formatNumber(sessions, locale) }),
              minutes: formatNumber(minutes, locale),
            })}
      </AppText>
      {focus ? (
        <AppText tone="muted" testID="training-for">
          {format(t.today.trainingFor[focus], {
            sports:
              sports.length > 0 ? formatList(sports, locale) : t.today.trainingForSportFallback,
          })}
        </AppText>
      ) : null}
    </Card>
  );
}
