import { tokens } from '@pt/ui';
import { openURL } from 'expo-linking';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useFoodSources } from '@/lib/api';

/** "Fuentes de datos" (spec 005 AC3): the attribution each source's license asks for. */
export default function SourcesSettingsScreen() {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const sources = useFoodSources(locale);
  const s = t.sources;

  return (
    <Screen testID="settings-sources-screen">
      <BackLink fallback="/profile" />
      <AppText variant="title">{s.title}</AppText>
      <AppText tone="muted">{s.intro}</AppText>
      {sources.data ? (
        sources.data.map((source) => (
          <View
            key={source.id}
            style={[styles.source, { borderColor: colors.border, backgroundColor: colors.surface }]}
            testID={`source-${source.id}`}
          >
            <AppText variant="subtitle" weight="bold" accessibilityRole="header">
              {source.name}
            </AppText>
            <AppText>{source.attribution}</AppText>
            <AppText variant="caption" tone="muted">
              {format(s.license, { license: source.license })}
            </AppText>
            <AppText variant="caption" tone="muted">
              {format(s.version, { version: source.version })}
            </AppText>
            <Button
              variant="ghost"
              label={format(s.open, { name: source.name })}
              onPress={() => void openURL(source.url)}
            />
          </View>
        ))
      ) : sources.isError ? (
        <View style={styles.gap}>
          <Notice tone="danger" message={s.loadError} />
          <Button
            variant="secondary"
            label={t.common.retry}
            onPress={() => void sources.refetch()}
          />
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  source: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.xs,
  },
  gap: { gap: tokens.space.sm },
});
