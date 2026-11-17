import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';

/** What just changed, with "Undo" for a few seconds (spec 005 AC11, AC13). Goes in a screen's footer. */
export function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.toast} role="status" accessibilityLiveRegion="polite" testID="undo-toast">
      <AppText style={styles.message}>{message}</AppText>
      <Button variant="secondary" label={t.food.item.undo} onPress={onUndo} testID="undo" />
    </View>
  );
}

const styles = StyleSheet.create({
  toast: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md },
  message: { flex: 1 },
});
