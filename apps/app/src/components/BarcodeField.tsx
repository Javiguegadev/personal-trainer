import { normalizeBarcode } from '@pt/core';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { Button } from './Button';
import { TextField } from './TextField';

interface BarcodeFieldProps {
  /** A lookup is running: the button shows it and cannot be pressed again. */
  busy: boolean;
  /** Called with the canonical barcode once the typed digits are a valid code (spec 006 AC2). */
  onCode: (barcode: string) => void;
  autoFocus?: boolean;
}

/** The barcode typed by hand: always available, and the only way where the camera cannot read it. */
export function BarcodeField({ busy, onCode, autoFocus = false }: BarcodeFieldProps) {
  const { t } = useI18n();
  const s = t.food.scan;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const barcode = normalizeBarcode(text);
    if (barcode === null) return setError(s.codeInvalid);
    onCode(barcode);
  };

  return (
    <View style={styles.field}>
      <TextField
        label={s.codeLabel}
        hint={s.codeHint}
        value={text}
        onChangeText={(next) => {
          setText(next);
          setError(null);
        }}
        error={error}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={20}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={submit}
        testID="barcode-input"
      />
      <Button label={s.lookUp} onPress={submit} loading={busy} testID="barcode-submit" />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: tokens.space.sm },
});
