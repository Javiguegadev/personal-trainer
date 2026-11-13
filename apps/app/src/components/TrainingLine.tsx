import type { PlannedActivity } from '@pt/contracts';
import { formatNumber, trainingMinutesPerWeek, trainingSessionsPerWeek } from '@pt/core';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Card } from './Card';

/** The planned training of the week in one line (spec 003 AC3). */
export function TrainingLine({ activities }: { activities: readonly PlannedActivity[] }) {
  const { t, format, locale } = useI18n();
  const sessions = trainingSessionsPerWeek(activities);
  const minutes = trainingMinutesPerWeek(activities);
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
    </Card>
  );
}
