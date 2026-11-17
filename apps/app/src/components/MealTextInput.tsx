import { MEAL_DRAFT_LIMITS } from '@pt/contracts';
import { useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { Screen } from './Screen';
import { TextField } from './TextField';

interface MealTextInputProps {
  /** The sentence typed before, kept when the user comes back to change it (AC2). */
  initialText: string;
  online: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/**
 * "Describir" (spec 007 AC2): a sentence, typed or dictated with the keyboard's microphone, that the
 * API turns into an editable draft.
 */
export function MealTextInput({ initialText, online, onSubmit, onCancel }: MealTextInputProps) {
  const { t } = useI18n();
  const d = t.food.describe;
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length < MEAL_DRAFT_LIMITS.textMin) return setError(d.tooShort);
    onSubmit(trimmed);
  };

  return (
    <Screen
      testID="meal-describe"
      footer={
        <>
          <Button
            label={d.submit}
            onPress={submit}
            disabled={!online}
            testID="meal-describe-submit"
          />
          <Button variant="ghost" label={t.food.portion.cancel} onPress={onCancel} />
        </>
      }
    >
      <AppText variant="title" accessibilityRole="header">
        {d.title}
      </AppText>
      <TextField
        label={d.field}
        placeholder={d.placeholder}
        hint={d.hint}
        error={error}
        value={text}
        onChangeText={(value) => {
          setText(value);
          setError(null);
        }}
        maxLength={MEAL_DRAFT_LIMITS.textMax}
        multiline
        numberOfLines={4}
        autoFocus
        inputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
        testID="meal-describe-text"
      />
      {online ? null : (
        <Notice tone="info" message={t.food.shortcuts.offline} testID="meal-describe-offline" />
      )}
    </Screen>
  );
}
