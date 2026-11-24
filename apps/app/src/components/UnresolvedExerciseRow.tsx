import type { WorkoutDraftUnresolved } from '@pt/contracts';
import { mentionName, trackingFromSets } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import type { SetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { dispatchSession } from '@/lib/liveSession';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * An exercise of the sentence that neither the catalog nor the user's own exercises have (spec 012
 * AC7): "No lo encuentro: press Larsen", the sets said, and "Buscar" (the picker with its words) or
 * "Crear ejercicio" (named after it). The exercise chosen receives these sets. It is never saved as is.
 */
export function UnresolvedExerciseRow({
  mention,
  index,
  fmt,
}: {
  mention: WorkoutDraftUnresolved;
  index: number;
  fmt: SetFormat;
}) {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const d = t.training.draft;
  const words = mention.mention;
  const name = mentionName(words);
  const values = mention.sets.map((s) => s.values);
  const tracking = trackingFromSets(values);
  const open = (create: boolean) =>
    router.push({
      pathname: '/training/picker',
      params: {
        slot: 'draft',
        resolve: String(index),
        q: name,
        ...(create ? { create: '1' } : {}),
        ...(tracking ? { tracking } : {}),
      },
    });

  return (
    <View
      style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.warningSurface }]}
      testID={`unresolved-${index}`}
    >
      <AppText weight="bold">{format(d.notFound, { words })}</AppText>
      <AppText variant="caption" tone="muted" testID={`unresolved-${index}-sets`}>
        {values.length && tracking ? fmt.sets(values, tracking) : d.noSets}
      </AppText>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={d.search}
          accessibilityLabel={format(d.searchA11y, { words })}
          onPress={() => open(false)}
          testID={`unresolved-${index}-search`}
        />
        <Button
          variant="secondary"
          label={d.create}
          accessibilityLabel={format(d.createA11y, { words })}
          onPress={() => open(true)}
          testID={`unresolved-${index}-create`}
        />
        <Button
          variant="ghost"
          label={d.remove}
          accessibilityLabel={format(d.removeA11y, { words })}
          onPress={() => dispatchSession('draft', { type: 'removeMention', index })}
          testID={`unresolved-${index}-remove`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    gap: tokens.space.sm,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
