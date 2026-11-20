import { WEEK_LIMITS } from '@pt/contracts';
import { formatMinuteOfDay, roundToStep } from '@pt/core';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { TimeFieldFrame, dateAtMinute, type TimeFieldProps } from './TimeFieldFrame';

export type { TimeFieldProps } from './TimeFieldFrame';

/**
 * A time of day on Android (spec 010 AC2): a button that opens the system time dialog. The pick is
 * rounded to `step` minutes (15 by default); the dialog has no minute interval.
 */
export function TimeField(props: TimeFieldProps) {
  const { value, onChange, step = WEEK_LIMITS.timeStep, label, optional, testID } = props;
  const { t, locale } = useI18n();
  const { colors, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const text = value === null ? t.week.noTime : formatMinuteOfDay(value, locale);
  return (
    <TimeFieldFrame {...props}>
      <Pressable
        role="button"
        accessibilityLabel={`${label}: ${text}`}
        onPress={() => setOpen(true)}
        testID={testID ? `${testID}-value` : undefined}
        style={({ pressed }) => [
          styles.button,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <AppText weight="bold" tone={value === null && optional ? 'muted' : 'default'}>
          {text}
        </AppText>
      </Pressable>
      {open ? (
        <DateTimePicker
          mode="time"
          presentation="dialog"
          is24Hour={locale === 'es'}
          value={dateAtMinute(value ?? 18 * 60)}
          themeVariant={scheme}
          onValueChange={(_event, date) => {
            setOpen(false);
            onChange(roundToStep(date.getHours() * 60 + date.getMinutes(), step));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </TimeFieldFrame>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: tokens.layout.minTouchTarget,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
