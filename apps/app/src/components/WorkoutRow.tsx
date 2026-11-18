import type { Workout } from '@pt/contracts';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { AppText } from './AppText';
import { useDayLabel } from './DaySelector';
import { RecordMark } from './RecordMark';
import { SyncBadge } from './SyncBadge';

/**
 * One entry of the history (spec 009 AC20): day, name or type, duration, exercises and sets (or the
 * effort of an activity), a "Récord" mark and "pendiente de sincronizar" (AC22). Opens it (AC19).
 */
export function WorkoutRow({
  workout,
  today,
  records,
  pending,
}: {
  workout: Workout;
  today: string;
  records: number;
  pending: boolean;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const dayLabel = useDayLabel(today);
  const text = useWorkoutText();
  const label = text.label(workout);
  const detail = text.detail(workout);
  return (
    <Pressable
      role="button"
      accessibilityLabel={`${dayLabel(workout.localDate)}, ${label}, ${text.minutes(workout.minutes)}${
        detail ? `, ${detail}` : ''
      }${records ? `, ${text.records(records)}` : ''}`}
      onPress={() =>
        router.push({ pathname: '/training/workout/[id]', params: { id: workout.id } })
      }
      testID={`workout-${workout.id}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.text}>
        <AppText weight="bold">
          {dayLabel(workout.localDate)} · {label}
        </AppText>
        <AppText variant="caption" tone="muted">
          {[text.minutes(workout.minutes), detail].filter(Boolean).join(' · ')}
        </AppText>
        <View style={styles.marks}>
          {records > 0 ? <RecordMark label={t.training.record} testID="workout-record" /> : null}
          {pending ? <SyncBadge /> : null}
        </View>
      </View>
      <AppText tone="muted">›</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: tokens.layout.minTouchTarget,
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    padding: tokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  text: { flex: 1, gap: 2 },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs },
});
