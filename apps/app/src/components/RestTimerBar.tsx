import { WORKOUT_LIMITS } from '@pt/contracts';
import { formatDuration } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * The rest after a completed set (spec 009 AC9), in the screen's footer so it stays above the keyboard:
 * the countdown, −15 s / +15 s and "Saltar", then "Descanso terminado". The seconds come from timestamps
 * (`restRemaining`).
 */
export function RestTimerBar({
  remaining,
  onAdjust,
  onSkip,
}: {
  remaining: number;
  onAdjust: (deltaS: number) => void;
  onSkip: () => void;
}) {
  const { t, format } = useI18n();
  const r = t.training.rest;
  const step = WORKOUT_LIMITS.restStepS;
  return (
    <View style={styles.bar} testID="rest-timer">
      <AppText
        variant="subtitle"
        weight="bold"
        style={styles.time}
        // The countdown is read on focus; the end is announced (AC9).
        accessibilityRole="timer"
        accessibilityLiveRegion={remaining > 0 ? 'none' : 'polite'}
        testID="rest-remaining"
      >
        {remaining > 0 ? format(r.remaining, { time: formatDuration(remaining) }) : r.done}
      </AppText>
      <View style={styles.buttons}>
        <Button
          variant="secondary"
          label={r.less}
          accessibilityLabel={r.lessA11y}
          onPress={() => onAdjust(-step)}
          testID="rest-less"
        />
        <Button
          variant="secondary"
          label={r.more}
          accessibilityLabel={r.moreA11y}
          onPress={() => onAdjust(step)}
          testID="rest-more"
        />
        <Button variant="ghost" label={r.skip} onPress={onSkip} testID="rest-skip" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: tokens.space.xs },
  time: { textAlign: 'center' },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: tokens.space.sm },
});
