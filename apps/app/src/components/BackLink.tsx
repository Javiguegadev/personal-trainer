import { tokens } from '@pt/ui';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { Button } from './Button';

/**
 * Visible "Back" for screens without a header (the system back gesture still works). `canGoBack()` is
 * not reactive, so it is checked on press; without history (a reload on web) it goes to `fallback`.
 */
export function BackLink({ fallback }: { fallback: Href }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <Button
        variant="ghost"
        label={`← ${t.common.back}`}
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        testID="back-link"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', marginLeft: -tokens.space.lg },
});
