import { ActivityLevelSchema, DietTypeSchema, GoalSchema, SexSchema } from '@pt/contracts';
import {
  convertFormUnits,
  type FormErrorCode,
  type ProfileFormErrors,
  type ProfileFormValues,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Checkbox } from './Checkbox';
import { ChoiceGroup } from './ChoiceGroup';
import { TextField } from './TextField';

interface ProfileFormProps {
  values: ProfileFormValues;
  onChange: (values: ProfileFormValues) => void;
  errors: ProfileFormErrors;
}

/**
 * Every profile field, editable (manual fallback AC11, summary AC10, Settings AC16). Values stay as
 * typed; @pt/core parses and validates them (decimal comma, imperial units, ranges).
 */
export function ProfileForm({ values, onChange, errors }: ProfileFormProps) {
  const { t, locale } = useI18n();
  const f = t.onboarding.form;
  const set = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const error = (code: FormErrorCode | undefined) => (code ? f.errors[code] : null);
  const imperial = values.units === 'imperial';

  return (
    <View style={styles.form} testID="profile-form">
      <ChoiceGroup
        label={f.sex}
        hint={f.sexHint}
        options={SexSchema.options.map((value) => ({ value, label: f.sexOptions[value] }))}
        value={values.sex}
        onChange={(value) => set('sex', value)}
        error={error(errors.sex)}
        testID="field-sex"
      />

      <View style={styles.group}>
        <AppText variant="label">{f.birthDate}</AppText>
        <View style={styles.row}>
          <View style={styles.small}>
            <TextField
              label={f.day}
              value={values.birthDay}
              onChangeText={(text) => set('birthDay', text)}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              autoComplete="birthdate-day"
              testID="field-birth-day"
            />
          </View>
          <View style={styles.small}>
            <TextField
              label={f.month}
              value={values.birthMonth}
              onChangeText={(text) => set('birthMonth', text)}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              autoComplete="birthdate-month"
              testID="field-birth-month"
            />
          </View>
          <View style={styles.wide}>
            <TextField
              label={f.year}
              value={values.birthYear}
              onChangeText={(text) => set('birthYear', text)}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={4}
              autoComplete="birthdate-year"
              testID="field-birth-year"
            />
          </View>
        </View>
        {errors.birthDate ? (
          <AppText variant="caption" tone="danger" role="alert">
            {error(errors.birthDate)}
          </AppText>
        ) : null}
      </View>

      <ChoiceGroup
        label={f.units}
        options={(['metric', 'imperial'] as const).map((value) => ({
          value,
          label: f.unitOptions[value],
        }))}
        value={values.units}
        onChange={(units) => onChange(convertFormUnits(values, units, locale))}
        testID="field-units"
      />

      {imperial ? (
        <View style={styles.row}>
          <View style={styles.half}>
            <TextField
              label={f.heightFt}
              value={values.heightFt}
              onChangeText={(text) => set('heightFt', text)}
              keyboardType="number-pad"
              inputMode="numeric"
              error={error(errors.height)}
              testID="field-height-ft"
            />
          </View>
          <View style={styles.half}>
            <TextField
              label={f.heightIn}
              value={values.heightIn}
              onChangeText={(text) => set('heightIn', text)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              testID="field-height-in"
            />
          </View>
        </View>
      ) : (
        <TextField
          label={f.heightCm}
          value={values.heightCm}
          onChangeText={(text) => set('heightCm', text)}
          keyboardType="decimal-pad"
          inputMode="decimal"
          error={error(errors.height)}
          testID="field-height-cm"
        />
      )}

      <TextField
        label={imperial ? f.weightLb : f.weightKg}
        value={values.weight}
        onChangeText={(text) => set('weight', text)}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={error(errors.weight)}
        testID="field-weight"
      />
      <TextField
        label={imperial ? f.targetWeightLb : f.targetWeightKg}
        value={values.targetWeight}
        onChangeText={(text) => set('targetWeight', text)}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={error(errors.targetWeight)}
        testID="field-target-weight"
      />

      <ChoiceGroup
        label={f.activity}
        layout="list"
        options={ActivityLevelSchema.options.map((value) => ({
          value,
          label: f.activityOptions[value],
          description: f.activityHints[value],
        }))}
        value={values.activityLevel}
        onChange={(value) => set('activityLevel', value)}
        error={error(errors.activityLevel)}
        testID="field-activity"
      />

      <ChoiceGroup
        label={f.goal}
        options={GoalSchema.options.map((value) => ({ value, label: f.goalOptions[value] }))}
        value={values.goal}
        onChange={(value) => set('goal', value)}
        error={error(errors.goal)}
        testID="field-goal"
      />

      <ChoiceGroup
        label={f.diet}
        options={DietTypeSchema.options.map((value) => ({ value, label: f.dietOptions[value] }))}
        value={values.dietType}
        onChange={(value) => set('dietType', value)}
        error={error(errors.dietType)}
        testID="field-diet"
      />

      <TextField
        label={f.allergies}
        hint={f.listHint}
        value={values.allergies}
        onChangeText={(text) => set('allergies', text)}
        error={error(errors.allergies)}
        testID="field-allergies"
      />
      <TextField
        label={f.dislikes}
        hint={f.listHint}
        value={values.dislikes}
        onChangeText={(text) => set('dislikes', text)}
        error={error(errors.dislikes)}
      />
      <TextField
        label={f.restrictions}
        hint={f.listHint}
        value={values.restrictions}
        onChangeText={(text) => set('restrictions', text)}
        error={error(errors.restrictions)}
      />
      <TextField
        label={f.injuries}
        hint={f.injuriesHint}
        value={values.injuries}
        onChangeText={(text) => set('injuries', text)}
        multiline
        maxLength={500}
        error={error(errors.injuries)}
        inputStyle={styles.multiline}
        testID="field-injuries"
      />
      <Checkbox
        label={f.pregnancy}
        checked={values.pregnancy}
        onChange={(checked) => set('pregnancy', checked)}
        testID="field-pregnancy"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: tokens.space.lg },
  group: { gap: tokens.space.xs },
  row: { flexDirection: 'row', gap: tokens.space.sm },
  small: { flex: 1 },
  wide: { flex: 1.6 },
  half: { flex: 1 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});
