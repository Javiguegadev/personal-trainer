import { WEEK_LIMITS } from '@pt/contracts';
import { roundToStep } from '@pt/core';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { Button } from './Button';
import { TimeFieldFrame, dateAtMinute, type TimeFieldProps } from './TimeFieldFrame';

/**
 * A time of day on iOS (spec 010 AC2): the compact system picker, inline. With no time yet, a button
 * sets one first. The pick is rounded to `step` minutes (15 by default).
 */
export function TimeField(props: TimeFieldProps) {
  const { value, onChange, step = WEEK_LIMITS.timeStep, label, testID } = props;
  const { t, locale } = useI18n();
  const { colors, scheme } = useTheme();
  return (
    <TimeFieldFrame {...props}>
      {value === null ? (
        <Button
          variant="secondary"
          label={t.week.noTime}
          accessibilityLabel={`${label}: ${t.week.noTime}`}
          onPress={() => onChange(18 * 60)}
          testID={testID ? `${testID}-value` : undefined}
        />
      ) : (
        <DateTimePicker
          mode="time"
          display="compact"
          value={dateAtMinute(value)}
          locale={locale === 'es' ? 'es_ES' : 'en_GB'}
          accentColor={colors.primary}
          themeVariant={scheme}
          onValueChange={(_event, date) =>
            onChange(roundToStep(date.getHours() * 60 + date.getMinutes(), step))
          }
          testID={testID ? `${testID}-value` : undefined}
        />
      )}
    </TimeFieldFrame>
  );
}
