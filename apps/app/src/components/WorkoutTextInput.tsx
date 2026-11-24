import { WORKOUT_DRAFT_LIMITS } from '@pt/contracts';
import { useI18n } from '@/hooks/useI18n';
import { TextField } from './TextField';

/**
 * The sentence of "Describir entreno" (spec 012 AC2): 3–500 characters, typed or dictated with the
 * keyboard's microphone, with an example as its placeholder.
 */
export function WorkoutTextInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (text: string) => void;
  error: string | null;
}) {
  const { t } = useI18n();
  const d = t.training.describe;
  return (
    <TextField
      label={d.field}
      placeholder={d.placeholder}
      hint={d.hint}
      error={error}
      value={value}
      onChangeText={onChange}
      maxLength={WORKOUT_DRAFT_LIMITS.textMax}
      multiline
      numberOfLines={4}
      autoFocus
      inputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
      testID="workout-describe-text"
    />
  );
}
