import { tokens } from '@pt/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';

/** What every platform's `TimeField` takes (spec 010 AC2, AC3). */
export interface TimeFieldProps {
  label: string;
  /** Minutes after midnight, or null for "no time" (only when `optional`). */
  value: number | null;
  onChange: (minute: number | null) => void;
  /** Shows "No time" and lets the user clear the time. */
  optional?: boolean;
  /** Minutes between options (default 15). */
  step?: number;
  error?: string | null;
  testID?: string;
}

/** A date today at `minute` (the native pickers work on dates; only the time is read back). */
export function dateAtMinute(minute: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date;
}

/** The label, the platform control, the "Remove time" link and the error of a time field. */
export function TimeFieldFrame({
  label,
  value,
  onChange,
  optional,
  error,
  testID,
  clearable = true,
  children,
}: TimeFieldProps & {
  /** False where the control itself offers "No time" (the web select). */
  clearable?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.group} testID={testID}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.row}>
        {children}
        {clearable && optional && value !== null ? (
          <Button
            variant="ghost"
            label={t.week.clearTime}
            accessibilityLabel={`${t.week.clearTime}: ${label}`}
            onPress={() => onChange(null)}
            testID={testID ? `${testID}-clear` : undefined}
          />
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" role="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm, flexWrap: 'wrap' },
});
