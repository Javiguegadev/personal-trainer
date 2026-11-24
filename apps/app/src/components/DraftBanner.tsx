import type { WorkoutDraftActivity } from '@pt/contracts';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * The top of a sentence draft (spec 012 AC6, AC10, AC15): "Borrador de tu frase: revisa y guarda", the
 * fixed pain line, the distance that is not stored, and the other activities said, each with
 * "Registrar". The model writes none of this text.
 */
export function DraftBanner({
  painMentioned,
  distanceDropped = false,
  extraActivities,
  ignored,
  onRegister,
  onChangeSentence,
}: {
  painMentioned: boolean;
  distanceDropped?: boolean;
  extraActivities: readonly WorkoutDraftActivity[];
  ignored: number;
  onRegister: (index: number, activity: WorkoutDraftActivity) => void;
  /** Back to the sentence field, when the draft was opened from it. */
  onChangeSentence?: () => void;
}) {
  const { t, format } = useI18n();
  const d = t.training.draft;
  const nameOf = (a: WorkoutDraftActivity) => {
    const name = t.training.activities[a.activity];
    return a.minutes === null
      ? name
      : format(d.activityMinutes, { activity: name, minutes: a.minutes });
  };

  return (
    <Notice tone="info" title={d.banner} testID="draft-banner">
      {painMentioned ? <AppText testID="draft-pain">{t.training.injuryNote}</AppText> : null}
      {distanceDropped ? (
        <AppText variant="caption" tone="muted" testID="draft-distance">
          {d.distance}
        </AppText>
      ) : null}
      {extraActivities.map((activity, index) => (
        <View
          key={`${activity.activity}-${index}`}
          style={styles.extra}
          testID={`draft-extra-${index}`}
        >
          <AppText style={styles.flex}>{format(d.also, { activity: nameOf(activity) })}</AppText>
          <Button
            variant="secondary"
            label={d.register}
            accessibilityLabel={format(d.registerA11y, { activity: nameOf(activity) })}
            onPress={() => onRegister(index, activity)}
            testID={`draft-extra-${index}-register`}
          />
        </View>
      ))}
      {ignored > 0 ? (
        <AppText variant="caption" tone="muted" testID="draft-ignored">
          {ignored === 1 ? d.ignoredOne : format(d.ignoredOther, { count: ignored })}
        </AppText>
      ) : null}
      {onChangeSentence ? (
        <View style={styles.start}>
          <Button
            variant="ghost"
            label={d.editText}
            onPress={onChangeSentence}
            testID="draft-edit-text"
          />
        </View>
      ) : null}
    </Notice>
  );
}

const styles = StyleSheet.create({
  extra: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  flex: { flex: 1 },
  start: { alignItems: 'flex-start' },
});
