import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';

/**
 * One meal of a week row (spec 013 AC2): filled when logged, outlined when only planned. Shape, not
 * colour, tells them apart, and each dot says what it is.
 */
export function PlanDot({ planned }: { planned: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={planned ? t.plan.dotPlanned : t.plan.dotLogged}
      style={[
        styles.dot,
        planned
          ? { borderColor: colors.textMuted, borderWidth: 1.5 }
          : { backgroundColor: colors.textMuted },
      ]}
    />
  );
}

const styles = StyleSheet.create({ dot: { width: 8, height: 8, borderRadius: 4 } });
