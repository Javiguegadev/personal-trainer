import { MUSCLE_FILTERS, type MuscleFilter } from '@pt/contracts';
import { exerciseName } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { ExercisePickerList, type ExerciseSection } from '@/components/ExercisePickerList';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useExerciseSections } from '@/hooks/useExerciseSections';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useExerciseLookups } from '@/hooks/useTraining';

const FILTERS = Object.keys(MUSCLE_FILTERS) as MuscleFilter[];

/** The exercise library (spec 009 AC15, AC20): search, muscle groups, the user's own; each opens. */
export default function LibraryRoute() {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { catalog, exercises } = useExerciseLookups();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MuscleFilter | null>(null);
  const found = useExerciseSections(query, filter);
  const l = t.training.library;
  const p = t.training.picker;

  const mine = exercises
    .filter((e) => e.origin === 'user')
    .sort((a, b) => exerciseName(a, locale).localeCompare(exerciseName(b, locale), locale));
  const sections: ExerciseSection[] =
    !query.trim() && !filter && mine.length
      ? [{ key: 'mine', title: l.mine, data: mine }, ...found]
      : found;

  let body;
  if (catalog.isPending) {
    body = <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />;
  } else if (catalog.isError && !catalog.data) {
    body = (
      <View style={styles.gap}>
        <Notice tone="danger" message={p.loadError} />
        <Button variant="secondary" label={t.common.retry} onPress={() => void catalog.refetch()} />
      </View>
    );
  } else {
    body = (
      <ExercisePickerList
        sections={sections}
        onPress={(exercise) =>
          router.push({ pathname: '/training/exercises/[id]', params: { id: exercise.id } })
        }
        header={
          query.trim() && sections.length === 0 ? (
            <AppText tone="muted">{format(p.noResults, { query: query.trim() })}</AppText>
          ) : undefined
        }
        testID="library-list"
      />
    );
  }

  return (
    <Screen scroll={false} testID="library-screen">
      <BackLink fallback="/training" />
      <View style={styles.titleRow}>
        <AppText variant="title" style={styles.title}>
          {l.title}
        </AppText>
        <Button
          variant="secondary"
          label={`+ ${l.create}`}
          onPress={() =>
            router.push({ pathname: '/training/exercises/new', params: { name: query.trim() } })
          }
          testID="library-create"
        />
      </View>
      <TextField
        label={p.search}
        value={query}
        onChangeText={setQuery}
        placeholder={p.placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        testID="library-search"
      />
      {query.trim() ? null : (
        <ChoiceGroup
          label={p.filters}
          options={FILTERS.map((value) => ({ value, label: t.training.muscleFilters[value] }))}
          value={filter}
          onChange={(value) => setFilter(value === filter ? null : value)}
          layout="scroll"
          testID="library-filter"
        />
      )}
      <View style={styles.list}>{body}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm, flexWrap: 'wrap' },
  title: { flex: 1 },
  list: { flex: 1 },
});
