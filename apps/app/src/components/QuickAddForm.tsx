import { FOOD_LOG_LIMITS } from '@pt/contracts';
import {
  parseQuickAddFields,
  quickAddEnergyMismatch,
  type QuickAddFieldErrors,
  type QuickAddFields,
  type QuickAddValues,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { Screen } from './Screen';
import { TextField } from './TextField';

interface QuickAddFormProps {
  /** The search that found nothing, as the name to start from (AC6). */
  initialName: string;
  onSubmit: (values: QuickAddValues & { label: string }) => void;
  onCancel: () => void;
}

/**
 * "Quick add" (spec 005 AC10): a name and its calories, macros optional, for something that is not in
 * the catalog. Macros that add up to much more than the calories ask "is that right?" before saving.
 */
export function QuickAddForm({ initialName, onSubmit, onCancel }: QuickAddFormProps) {
  const { t } = useI18n();
  const q = t.food.quickAdd;
  const [fields, setFields] = useState<QuickAddFields>({
    label: initialName.slice(0, FOOD_LOG_LIMITS.labelMax),
    kcal: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const [errors, setErrors] = useState<QuickAddFieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const formErrors: Record<string, string> = t.onboarding.form.errors;

  const edit = (field: keyof QuickAddFields) => (text: string) => {
    setFields({ ...fields, [field]: text });
    setErrors({ ...errors, [field]: undefined });
    setConfirming(false);
  };
  const errorOf = (field: keyof QuickAddFields) => {
    const code = errors[field];
    return code ? (formErrors[code] ?? t.errors.validation_error) : null;
  };

  const submit = (confirmed: boolean) => {
    const parsed = parseQuickAddFields(fields);
    if (!parsed.ok) return setErrors(parsed.errors);
    // Often a typing mistake in the calories or in a macro (AC10).
    if (!confirmed && quickAddEnergyMismatch(parsed.values)) return setConfirming(true);
    onSubmit(parsed.values);
  };

  const number = { keyboardType: 'decimal-pad', inputMode: 'decimal' } as const;
  return (
    <Screen
      testID="quick-add-form"
      footer={
        <>
          {confirming ? (
            <Notice
              tone="warning"
              title={q.confirmTitle}
              message={q.confirmMessage}
              testID="quick-add-confirm"
            >
              <Button
                label={q.confirmYes}
                onPress={() => submit(true)}
                testID="quick-add-confirm-yes"
              />
              <Button variant="ghost" label={q.confirmNo} onPress={() => setConfirming(false)} />
            </Notice>
          ) : (
            <Button label={q.add} onPress={() => submit(false)} testID="quick-add-submit" />
          )}
          <Button
            variant="ghost"
            label={t.food.portion.cancel}
            onPress={onCancel}
            testID="quick-add-cancel"
          />
        </>
      }
    >
      <AppText variant="title">{q.title}</AppText>
      <AppText tone="muted">{q.text}</AppText>
      <TextField
        label={q.name}
        value={fields.label}
        onChangeText={edit('label')}
        error={errorOf('label')}
        maxLength={FOOD_LOG_LIMITS.labelMax}
        autoFocus={initialName === ''}
        testID="quick-add-name"
      />
      <TextField
        label={q.kcal}
        value={fields.kcal}
        onChangeText={edit('kcal')}
        error={errorOf('kcal')}
        autoFocus={initialName !== ''}
        {...number}
        testID="quick-add-kcal"
      />
      <View style={styles.macros}>
        <TextField
          label={q.protein}
          value={fields.protein}
          onChangeText={edit('protein')}
          error={errorOf('protein')}
          {...number}
          testID="quick-add-protein"
        />
        <TextField
          label={q.carbs}
          value={fields.carbs}
          onChangeText={edit('carbs')}
          error={errorOf('carbs')}
          {...number}
          testID="quick-add-carbs"
        />
        <TextField
          label={q.fat}
          value={fields.fat}
          onChangeText={edit('fat')}
          error={errorOf('fat')}
          {...number}
          testID="quick-add-fat"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  macros: { gap: tokens.space.md },
});
