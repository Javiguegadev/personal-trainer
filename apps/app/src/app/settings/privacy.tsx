import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useDeleteAccount, useExportData } from '@/lib/api';
import { isDeleteConfirmation } from '@/lib/deleteConfirmation';
import { saveJsonFile } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { signOut } from '@/lib/session';

/** GDPR: download every row linked to the account (AC23) and delete the account (AC24). */
export default function PrivacySettingsScreen() {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const exportData = useExportData();
  const remove = useDeleteAccount();
  const [exported, setExported] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const p = t.privacy;

  async function download() {
    setExported(null);
    setSaveError(null);
    try {
      const data = await exportData.mutateAsync();
      const fileName = `personal-trainer-export-${data.exportedAt.slice(0, 10)}.json`;
      await saveJsonFile(fileName, data, p.export.title);
      setExported(fileName);
    } catch (e) {
      setSaveError(errorMessage(e, t));
    }
  }

  return (
    <Screen testID="settings-privacy-screen">
      <BackLink fallback="/profile" />
      <AppText variant="title">{p.title}</AppText>

      <View
        style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}
      >
        <AppText variant="subtitle" weight="bold" accessibilityRole="header">
          {p.export.title}
        </AppText>
        <AppText tone="muted">{p.export.text}</AppText>
        {exported ? (
          <Notice
            tone="success"
            message={format(p.export.done, { file: exported })}
            testID="export-done"
          />
        ) : null}
        {saveError ? <Notice tone="danger" message={saveError} /> : null}
        <Button
          variant="secondary"
          label={p.export.button}
          onPress={() => void download()}
          loading={exportData.isPending}
          testID="export-data"
        />
      </View>

      <View
        style={[styles.section, { borderColor: colors.danger, backgroundColor: colors.surface }]}
      >
        <AppText variant="subtitle" weight="bold" tone="danger" accessibilityRole="header">
          {p.delete.title}
        </AppText>
        <AppText>{p.delete.text}</AppText>
        <TextField
          label={format(p.delete.confirmLabel, { word: p.delete.word })}
          value={confirmation}
          onChangeText={setConfirmation}
          autoCapitalize="characters"
          autoCorrect={false}
          testID="delete-confirmation"
        />
        {remove.isError ? <Notice tone="danger" message={errorMessage(remove.error, t)} /> : null}
        <Button
          variant="danger"
          label={p.delete.button}
          onPress={() => remove.mutate(undefined, { onSuccess: () => void signOut() })}
          loading={remove.isPending}
          disabled={!isDeleteConfirmation(confirmation)}
          testID="delete-account"
        />
      </View>

      <AppText variant="caption" tone="muted">
        {t.consent.privacyPending}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
});
