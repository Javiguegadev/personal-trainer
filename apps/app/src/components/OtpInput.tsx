import { tokens } from '@pt/ui';
import { Platform, StyleSheet } from 'react-native';
import { TextField } from './TextField';

interface OtpInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  error?: string | null;
  length?: number;
  editable?: boolean;
}

/**
 * One field for the whole code, so paste and the platform's one-time-code autofill work everywhere
 * (iOS `oneTimeCode`, Android SMS/email retriever, web `autocomplete="one-time-code"`).
 */
export function OtpInput({
  label,
  value,
  onChange,
  error,
  length = 6,
  editable = true,
}: OtpInputProps) {
  return (
    <TextField
      label={label}
      value={value}
      error={error}
      editable={editable}
      onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
      keyboardType="number-pad"
      inputMode="numeric"
      textContentType="oneTimeCode"
      autoComplete={Platform.select({ android: 'sms-otp', default: 'one-time-code' })}
      autoFocus
      maxLength={length}
      placeholder={'•'.repeat(length)}
      inputStyle={styles.code}
      testID="otp-input"
    />
  );
}

const styles = StyleSheet.create({
  code: {
    fontSize: tokens.fontSize.title,
    letterSpacing: 10,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    minHeight: 60,
  },
});
