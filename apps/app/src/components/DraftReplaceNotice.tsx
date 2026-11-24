import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * The question before a new past session replaces an unsaved one in the `draft` slot (spec 012 AC2):
 * discard it and go on, open it, or cancel.
 */
export function DraftReplaceNotice({
  onReplace,
  onOpen,
  onCancel,
}: {
  onReplace: () => void;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const d = t.training.describe;
  return (
    <Notice tone="warning" title={d.replaceTitle} message={d.replaceText} testID="draft-replace">
      <View style={styles.actions}>
        <Button
          variant="danger"
          label={d.replaceYes}
          onPress={onReplace}
          testID="draft-replace-yes"
        />
        <Button
          variant="secondary"
          label={d.openCurrent}
          onPress={onOpen}
          testID="draft-replace-open"
        />
        <Button variant="ghost" label={t.training.session.cancel} onPress={onCancel} />
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
