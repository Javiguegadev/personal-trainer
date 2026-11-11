import { tokens } from '@pt/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID?: string;
}

export function Checkbox({ label, checked, onChange, testID }: CheckboxProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      testID={testID}
      style={styles.row}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: checked ? colors.primary : colors.textMuted,
            backgroundColor: checked ? colors.primary : colors.surface,
          },
        ]}
      >
        {checked ? <Text style={[styles.tick, { color: colors.onPrimary }]}>✓</Text> : null}
      </View>
      <AppText style={styles.label}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.space.md,
    minHeight: tokens.layout.minTouchTarget,
    paddingVertical: tokens.space.sm,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: tokens.radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tick: { fontSize: 16, fontWeight: '800', lineHeight: 18 },
  label: { flex: 1 },
});
