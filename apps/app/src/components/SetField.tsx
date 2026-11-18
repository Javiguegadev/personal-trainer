import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, TextInput, type KeyboardTypeOptions } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

interface SetFieldProps {
  value: number | null;
  /** Last time's value, shown in the placeholder style until the set is completed (spec 009 AC7). */
  placeholder: number | null;
  /** Shown when there is no last time's value: the unit or the format ("kg", "0:00"). */
  emptyPlaceholder?: string;
  toText: (value: number) => string;
  /** The typed text as a value; null for an empty field; undefined when it is not valid. */
  parse: (text: string) => number | null | undefined;
  onChange: (value: number | null) => void;
  accessibilityLabel: string;
  keyboardType?: KeyboardTypeOptions;
  /** Shown instead of the value while a stopwatch runs. */
  override?: string | null;
  width?: number;
  /** Inside a stepper group: no border of its own. */
  inGroup?: boolean;
  testID?: string;
}

/**
 * A typed value of a set (weight, reps, time, distance). The text the user types stays as typed while
 * the field has focus; a step from the steppers or a completed set shows the stored value again.
 */
export function SetField({
  value,
  placeholder,
  emptyPlaceholder = '–',
  toText,
  parse,
  onChange,
  accessibilityLabel,
  keyboardType = 'decimal-pad',
  override,
  width,
  inGroup = false,
  testID,
}: SetFieldProps) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const shown = override ?? editing ?? (value === null ? '' : toText(value));
  const invalid = editing !== null && parse(editing) === undefined;

  return (
    <TextInput
      value={shown}
      placeholder={placeholder === null ? emptyPlaceholder : toText(placeholder)}
      placeholderTextColor={colors.textMuted}
      onFocus={() => setEditing(value === null ? '' : toText(value))}
      onBlur={() => setEditing(null)}
      onChangeText={(text) => {
        setEditing(text);
        const parsed = parse(text);
        if (parsed !== undefined) onChange(parsed);
      }}
      editable={override == null}
      keyboardType={keyboardType}
      selectTextOnFocus
      accessibilityLabel={accessibilityLabel}
      aria-invalid={invalid || undefined}
      testID={testID}
      style={[
        styles.field,
        width ? { width } : styles.flex,
        {
          color: colors.text,
          backgroundColor: colors.surface,
          borderColor: invalid ? colors.danger : inGroup ? 'transparent' : colors.border,
          borderWidth: invalid ? 2 : inGroup ? 0 : 1,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    height: tokens.layout.minTouchTarget,
    minWidth: 30,
    paddingHorizontal: 2,
    borderRadius: tokens.radius.sm,
    textAlign: 'center',
    // 16 px or more: iOS Safari does not zoom into the field on focus.
    fontSize: tokens.fontSize.body,
    fontWeight: '700',
  },
  flex: { flex: 1 },
});
