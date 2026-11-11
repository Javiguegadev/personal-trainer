import { tokens } from '@pt/ui';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';

interface BlockingStateProps {
  /** Shows an error with retry (and sign out) instead of the spinner. */
  error?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void;
}

/**
 * Full-screen cover used while the session and account load. It sits above the navigator, so the guard
 * can redirect underneath without flashing the wrong screen.
 */
export function BlockingState({ error, onRetry, onSignOut }: BlockingStateProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.background }]}
      testID={error ? 'blocking-error' : 'blocking-loading'}
    >
      {error ? (
        <View style={styles.error}>
          <AppText variant="subtitle" weight="bold" style={styles.text}>
            {t.errors.loadAccount}
          </AppText>
          <AppText tone="muted" style={styles.text}>
            {error}
          </AppText>
          {onRetry ? <Button label={t.common.retry} onPress={onRetry} /> : null}
          {onSignOut ? (
            <Button variant="ghost" label={t.common.signOut} onPress={onSignOut} />
          ) : null}
        </View>
      ) : (
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel={t.common.loading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: tokens.space.lg },
  error: { gap: tokens.space.md, width: '100%', maxWidth: tokens.layout.maxContentWidth },
  text: { textAlign: 'center' },
});
