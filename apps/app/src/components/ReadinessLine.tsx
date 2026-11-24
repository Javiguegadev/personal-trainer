import type { DailyCheckin, Readiness } from '@pt/contracts';
import { readinessLine, sleepStressNotice, type ReadinessPlan } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useReadinessText } from '@/hooks/useReadinessText';
import { useTheme } from '@/hooks/useTheme';
import { usePendingCheckinDates } from '@/lib/api';
import { updateCheckinPrefs, useCheckinPrefs } from '@/lib/checkinPrefs';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { SyncBadge } from './SyncBadge';

/**
 * Today once the check-in is saved (spec 011 AC4, AC9, AC13): one line with the readiness and its
 * reason, which opens the check-in to change or delete it, and under it, at most once a day, the quiet
 * notice of a pattern over several days ("Entendido" hides it until tomorrow, decision a).
 */
export function ReadinessLine({
  checkin,
  readiness,
  plan,
  checkins,
  today,
}: {
  checkin: DailyCheckin;
  readiness: Readiness;
  plan: ReadinessPlan;
  checkins: readonly DailyCheckin[];
  today: string;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const text = useReadinessText();
  const prefs = useCheckinPrefs();
  const pending = usePendingCheckinDates().includes(today);
  const r = t.readiness;
  const message = text.line(readinessLine(readiness, plan, checkin.sleepMinutes !== null));
  const pattern = sleepStressNotice(checkins, today);

  return (
    <View style={styles.group} testID="readiness">
      <Pressable
        role="button"
        accessibilityLabel={`${message}. ${r.changeA11y}`}
        onPress={() => router.push({ pathname: '/checkin/[date]', params: { date: today } })}
        testID="readiness-line"
        style={({ pressed }) => [
          styles.line,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <AppText style={styles.text} testID="readiness-text">
          {message}
        </AppText>
        <AppText tone="primary" weight="bold">
          {r.change}
        </AppText>
      </Pressable>
      {pending ? <SyncBadge /> : null}
      {pattern && prefs.noticeDismissedOn !== today ? (
        <Notice tone="info" message={r.pattern[pattern]} testID={`readiness-pattern-${pattern}`}>
          <View style={styles.start}>
            <Button
              variant="ghost"
              label={r.patternDismiss}
              onPress={() => updateCheckinPrefs({ noticeDismissedOn: today })}
              testID="readiness-pattern-dismiss"
            />
          </View>
        </Notice>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  line: {
    minHeight: tokens.layout.minTouchTarget,
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  text: { flex: 1 },
  start: { alignSelf: 'flex-start' },
});
