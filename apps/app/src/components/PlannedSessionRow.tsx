import type { PlannedWorkout } from '@pt/contracts';
import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { usePlanText } from '@/hooks/usePlanText';
import { useWorkoutText } from '@/hooks/useWorkoutText';
import { AppText } from './AppText';
import { Button } from './Button';
import { SyncBadge } from './SyncBadge';

/** What a planned session row offers: start it today, mark an activity done, log a past one. */
export type PlannedSessionAction = 'start' | 'done' | 'log';

/**
 * A pending planned session (spec 013 AC14, AC17): "Rutina B · 18:30" or "Fútbol · 19:00 · 90 min",
 * neutral, with its action. A done one is never shown here: its workout shows instead, once.
 */
export function PlannedSessionRow({
  planned,
  action,
  prefix,
  pending = false,
  onAction,
  onOpen,
}: {
  planned: PlannedWorkout;
  action: PlannedSessionAction | null;
  /** "Hoy: {session}" on the Training tab and Today. */
  prefix?: string;
  pending?: boolean;
  onAction?: () => void;
  /** Opens the planning sheet to change or remove it (spec 013 AC12): today and future days. */
  onOpen?: () => void;
}) {
  const { t, format } = useI18n();
  const text = usePlanText();
  const workoutText = useWorkoutText();
  const s = t.plan.session;
  const line = [
    text.line(planned),
    planned.kind !== 'gym' && planned.minutes !== null
      ? workoutText.minutes(planned.minutes)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = text.name(planned);
  const label = action === 'start' ? s.start : action === 'done' ? s.done : s.log;
  const a11y = action === 'start' ? s.startA11y : action === 'done' ? s.doneA11y : s.logA11y;

  return (
    <View style={styles.row} testID={`planned-session-${planned.id}`}>
      <Pressable
        role={onOpen ? 'button' : undefined}
        accessibilityLabel={onOpen ? format(t.plan.workout.openA11y, { session: line }) : undefined}
        disabled={!onOpen}
        onPress={onOpen}
        style={({ pressed }) => [styles.main, { opacity: pressed ? 0.6 : 1 }]}
        testID={onOpen ? 'planned-session-open' : undefined}
      >
        <AppText weight={prefix ? 'bold' : 'regular'}>
          {prefix ? format(prefix, { session: line }) : line}
        </AppText>
        {pending ? <SyncBadge /> : null}
      </Pressable>
      {action && onAction ? (
        <Button
          variant={action === 'start' ? 'primary' : 'secondary'}
          label={label}
          accessibilityLabel={format(a11y, { session: name })}
          onPress={onAction}
          testID={`planned-session-${action}`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: tokens.layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  main: { flex: 1, gap: 2, minHeight: tokens.layout.minTouchTarget, justifyContent: 'center' },
});
