import {
  ExerciseTrackingSchema,
  MUSCLE_GROUPS,
  WORKOUT_LIMITS,
  type ExerciseTracking,
  type MuscleGroup,
} from '@pt/contracts';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useSaveCustomExercise } from '@/lib/api';
import { newId } from '@/lib/id';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { TextField } from './TextField';

/**
 * A custom exercise (spec 009 Assumptions, AC5, AC22): a name, how it is tracked and optionally a muscle
 * group. Saved at once on the device and queued for the API, so it can be used offline right away.
 */
export function CustomExerciseForm({
  initialName = '',
  onCreated,
  onCancel,
}: {
  initialName?: string;
  /** The id of the new exercise, already in the cached catalog. */
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const save = useSaveCustomExercise();
  const [name, setName] = useState(
    initialName.trim().slice(0, WORKOUT_LIMITS.customExerciseNameMax),
  );
  const [tracking, setTracking] = useState<ExerciseTracking>('weight_reps');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const c = t.training.custom;
  const valid =
    name.trim().length > 0 && name.trim().length <= WORKOUT_LIMITS.customExerciseNameMax;

  return (
    <View style={styles.form} testID="custom-exercise-form">
      <AppText variant="subtitle" weight="bold" accessibilityRole="header">
        {c.title}
      </AppText>
      <TextField
        label={c.name}
        value={name}
        onChangeText={setName}
        maxLength={WORKOUT_LIMITS.customExerciseNameMax}
        error={showErrors && !valid ? c.nameError : null}
        testID="custom-exercise-name"
      />
      <ChoiceGroup
        label={c.tracking}
        layout="list"
        options={ExerciseTrackingSchema.options.map((value) => ({
          value,
          label: t.training.tracking[value],
          description: t.training.trackingHint[value],
        }))}
        value={tracking}
        onChange={setTracking}
        testID="custom-exercise-tracking"
      />
      <ChoiceGroup
        label={c.muscle}
        options={MUSCLE_GROUPS.map((value) => ({ value, label: t.training.muscles[value] }))}
        value={muscle}
        onChange={(value) => setMuscle(value === muscle ? null : value)}
        testID="custom-exercise-muscle"
      />
      <Button
        label={c.save}
        onPress={() => {
          if (!valid) {
            setShowErrors(true);
            return;
          }
          const id = newId();
          save.mutate({
            id,
            request: {
              name: name.trim(),
              tracking,
              primaryMuscle: muscle,
              recordedAt: new Date().toISOString(),
            },
          });
          onCreated(id);
        }}
        testID="custom-exercise-save"
      />
      <Button variant="ghost" label={c.cancel} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: tokens.space.md },
});
