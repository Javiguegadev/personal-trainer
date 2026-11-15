import {
  ActivityKindSchema,
  IntensitySchema,
  TRAINING_LIMITS,
  type ActivityKind,
} from '@pt/contracts';
import {
  SESSION_MINUTES_OPTIONS,
  canAddPlannedActivity,
  newPlannedActivity,
  trainingMinutesPerWeek,
  trainingSessionsPerWeek,
  type PlannedActivityFormValue,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceGroup } from './ChoiceGroup';
import { Stepper } from './Stepper';
import { TextField } from './TextField';

interface PlannedActivitiesFieldProps {
  values: PlannedActivityFormValue[];
  onChange: (values: PlannedActivityFormValue[]) => void;
  error?: string | null;
  /** The "Name your sport" error of each card, by index (spec 004 AC3). */
  nameErrors?: readonly (string | null)[];
  /** Shown with the error when sport performance has no sport yet: adds a sport card (spec 004 AC3). */
  onAddSport?: (() => void) | undefined;
  /** Sport performance: a sport needs its name, so its field is not labelled optional (spec 004 AC3). */
  sportNameRequired?: boolean;
}

/** Kinds that have many variants: the user can name the activity (e.g. "fútbol"). */
const NAMED_KINDS: readonly ActivityKind[] = ['sport', 'other'];

/**
 * The weekly training outside work (spec 002 AC2–AC4): a short list of activity cards, each edited with
 * taps. An empty list means "I don't train" and is valid.
 */
export function PlannedActivitiesField({
  values,
  onChange,
  error,
  nameErrors = [],
  onAddSport,
  sportNameRequired = false,
}: PlannedActivitiesFieldProps) {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const f = t.onboarding.form;
  const update = (index: number, patch: Partial<PlannedActivityFormValue>) =>
    onChange(values.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const canAdd = canAddPlannedActivity({ plannedActivities: values });

  return (
    <View style={styles.group} testID="field-training">
      <AppText variant="label">{f.training}</AppText>
      <AppText variant="caption" tone="muted">
        {f.trainingHint}
      </AppText>

      {values.length === 0 ? (
        <AppText tone="muted" testID="training-empty">
          {f.trainingEmpty}
        </AppText>
      ) : (
        <AppText variant="caption" tone="muted" testID="training-summary">
          {format(f.trainingSummary, {
            sessions: trainingSessionsPerWeek(values),
            minutes: trainingMinutesPerWeek(values),
          })}
        </AppText>
      )}

      {values.map((activity, index) => {
        const id = `activity-${index}`;
        const minutes = String(activity.minutesPerSession);
        // A stored duration that is not one of the chips (e.g. 75) is shown as one more chip.
        const durations = [...new Set([...SESSION_MINUTES_OPTIONS.map(String), minutes])].sort(
          (a, b) => Number(a) - Number(b),
        );
        return (
          <View
            key={index}
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: error ? colors.danger : colors.border,
              },
            ]}
            testID={id}
          >
            <AppText weight="bold" accessibilityRole="header">
              {format(f.activityTitle, { number: index + 1 })}
            </AppText>
            <ChoiceGroup
              label={f.kind}
              options={ActivityKindSchema.options.map((value) => ({
                value,
                label: f.kindOptions[value],
              }))}
              value={activity.kind}
              onChange={(kind) =>
                update(index, {
                  kind,
                  label: NAMED_KINDS.includes(kind) ? activity.label : '',
                })
              }
              testID={`${id}-kind`}
            />
            {NAMED_KINDS.includes(activity.kind) ? (
              <TextField
                label={
                  sportNameRequired && activity.kind === 'sport'
                    ? f.activityNameRequired
                    : f.activityName
                }
                placeholder={f.activityNamePlaceholder}
                value={activity.label}
                onChangeText={(label) => update(index, { label })}
                maxLength={TRAINING_LIMITS.labelMax}
                error={nameErrors[index] ?? null}
                testID={`${id}-name`}
              />
            ) : null}
            <Stepper
              label={f.sessions}
              value={activity.sessionsPerWeek}
              min={TRAINING_LIMITS.sessionsPerWeek.min}
              max={TRAINING_LIMITS.sessionsPerWeek.max}
              onChange={(sessionsPerWeek) => update(index, { sessionsPerWeek })}
              decreaseLabel={f.sessionsDecrease}
              increaseLabel={f.sessionsIncrease}
              testID={`${id}-sessions`}
            />
            <ChoiceGroup
              label={f.duration}
              options={durations.map((value) => ({
                value,
                label: format(f.durationValue, { minutes: value }),
              }))}
              value={minutes}
              onChange={(value) => update(index, { minutesPerSession: Number(value) })}
              testID={`${id}-duration`}
            />
            <ChoiceGroup
              label={f.intensity}
              hint={activity.kind === 'strength' ? f.intensityHintStrength : f.intensityHint}
              options={IntensitySchema.options.map((value) => ({
                value,
                label: f.intensityOptions[value],
              }))}
              value={activity.intensity}
              onChange={(intensity) => update(index, { intensity })}
              testID={`${id}-intensity`}
            />
            <Button
              variant="ghost"
              label={f.removeActivity}
              onPress={() => onChange(values.filter((_, i) => i !== index))}
              testID={`${id}-remove`}
            />
          </View>
        );
      })}

      {error ? (
        <AppText variant="caption" tone="danger" role="alert" testID="training-error">
          {error}
        </AppText>
      ) : null}
      {onAddSport && canAdd ? (
        <Button variant="primary" label={f.addSport} onPress={onAddSport} testID="add-sport" />
      ) : null}
      {canAdd ? (
        <Button
          variant="secondary"
          label={f.addActivity}
          onPress={() => onChange([...values, newPlannedActivity()])}
          testID="add-activity"
        />
      ) : (
        <AppText variant="caption" tone="muted">
          {f.trainingMax}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  card: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
});
