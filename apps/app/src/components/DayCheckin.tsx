import type { DailyCheckin } from '@pt/contracts';
import { blockEndsNextDay, sleepChipOf, type DayAccess } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useCheckinActions } from '@/hooks/useCheckin';
import { useI18n } from '@/hooks/useI18n';
import { useWeekText } from '@/hooks/useWeekText';
import { usePendingCheckinDates } from '@/lib/api';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { SyncBadge } from './SyncBadge';

/**
 * "Cómo estaba" on the day screen (spec 011 AC5): the day's check-in (sleep, stress, shift with its
 * hours) or "Sin check-in". Today and the 27 days before offer "Añadir" / "Cambiar" / "Borrar"; older
 * days are read-only. The caller leaves it out on future days.
 */
export function DayCheckin({
  checkin,
  date,
  access,
}: {
  checkin: DailyCheckin | null;
  date: string;
  access: DayAccess;
}) {
  const { t, format } = useI18n();
  const router = useRouter();
  const text = useWeekText();
  const actions = useCheckinActions();
  const pending = usePendingCheckinDates().includes(date);
  const c = t.checkin;
  const open = () => router.push({ pathname: '/checkin/[date]', params: { date } });

  const shift = (value: DailyCheckin) => {
    const { workShift, shiftStartMinute: start, shiftEndMinute: end } = value;
    if (workShift === null) return null;
    if (workShift === 'off' || start === null || end === null) return c.shiftChips[workShift];
    const hours = format(c.shiftHours, {
      shift: c.shiftChips[workShift],
      start: text.time(start),
      end: text.time(end),
    });
    return blockEndsNextDay({ startMinute: start, endMinute: end })
      ? `${hours} · ${t.week.endsNextDay}`
      : hours;
  };
  const lines = checkin
    ? [
        checkin.sleepMinutes === null
          ? null
          : format(c.summarySleep, { value: c.sleepChips[sleepChipOf(checkin.sleepMinutes)] }),
        checkin.stress === null
          ? null
          : format(c.summaryStress, { value: c.stressChips[checkin.stress] }),
        shift(checkin) === null ? null : format(c.summaryShift, { value: shift(checkin)! }),
      ].filter((line): line is string => line !== null)
    : [];

  return (
    <Card title={c.section} aside={pending ? <SyncBadge /> : null} testID="day-checkin">
      {lines.length > 0 ? (
        lines.map((line) => (
          <AppText key={line} testID="day-checkin-line">
            {line}
          </AppText>
        ))
      ) : (
        <AppText tone="muted" testID="day-checkin-none">
          {c.none}
        </AppText>
      )}
      {access === 'add' ? (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            label={checkin ? c.change : c.add}
            onPress={open}
            testID={checkin ? 'day-checkin-change' : 'day-checkin-add'}
          />
          {checkin ? (
            <Button
              variant="ghost"
              label={c.remove}
              accessibilityLabel={c.delete}
              onPress={() => actions.remove(date)}
              testID="day-checkin-delete"
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
