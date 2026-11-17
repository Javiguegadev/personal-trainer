import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';

/** "Waiting to sync" on a write that has not reached the server yet (spec 003 AC18). Icon + text. */
export function SyncBadge() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.warningSurface, borderColor: colors.warning },
      ]}
      testID="sync-badge"
    >
      <AppText variant="caption" tone="warning" weight="semibold">
        ⟳ {t.weight.pending}
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
