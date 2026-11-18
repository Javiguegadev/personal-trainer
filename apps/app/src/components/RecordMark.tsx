import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** "🏆 Récord": an icon and a word, so colour is not the only signal (spec 009 AC10, AC20). */
export function RecordMark({ label, testID }: { label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.warningSurface, borderColor: colors.warning },
      ]}
      testID={testID}
    >
      <AppText variant="caption" weight="bold" tone="warning">
        🏆 {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
  },
});
