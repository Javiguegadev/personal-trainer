import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { MOCK_BACKEND } from '@/lib/backend';
import { AppText } from './AppText';

/** Visible on every screen in demo mode, so simulated data is never mistaken for real data. */
export function DemoBanner() {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (!MOCK_BACKEND) return null;
  return (
    <View style={[styles.banner, { backgroundColor: colors.infoSurface }]} testID="demo-banner">
      <AppText variant="caption" tone="info" weight="semibold" style={styles.text}>
        {t.common.demoMode}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.xs },
  text: { textAlign: 'center' },
});
