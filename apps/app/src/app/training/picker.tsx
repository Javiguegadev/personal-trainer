import {
  ExerciseTrackingSchema,
  MUSCLE_FILTERS,
  type Exercise,
  type MuscleFilter,
} from '@pt/contracts';
import { exerciseName, programExerciseFor } from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { CustomExerciseForm } from '@/components/CustomExerciseForm';
import { ExercisePickerList } from '@/components/ExercisePickerList';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useExerciseSections } from '@/hooks/useExerciseSections';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useExerciseLookups, useTrainingActions, type PickedExercise } from '@/hooks/useTraining';
import { useSession, type SessionSlot } from '@/lib/liveSession';
import { dispatchRoutineDraft } from '@/lib/routineDraft';

const FILTERS = Object.keys(MUSCLE_FILTERS) as MuscleFilter[];

/**
 * "Añadir ejercicios" (spec 009 AC3, AC5, AC7): search on the device (works offline with the cached
 * catalog), recents and muscle chips with an empty query, several exercises in one visit, and "Crear
 * ejercicio" with the query as its name when nothing matches. Also adds to a routine (spec 010 AC16).
 */
export default function PickerRoute() {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  // `routine` is the id of a routine session being edited (spec 010 AC16); otherwise a workout slot.
  // One exercise only (spec 012): `replace` is the card of "Cambiar ejercicio" (AC12), `resolve` the
  // index of a mention the catalog lacked (AC7), with `q` its words, and `create`/`tracking` to open
  // "Crear ejercicio" at once.
  const params = useLocalSearchParams<{
    slot?: string;
    routine?: string;
    replace?: string;
    resolve?: string;
    q?: string;
    create?: string;
    tracking?: string;
  }>();
  const slot: SessionSlot = params.slot === 'draft' ? 'draft' : 'live';
  const session = useSession(slot);
  const { catalog, exerciseById } = useExerciseLookups();
  const actions = useTrainingActions();
  const [query, setQuery] = useState(params.q ?? '');
  const [filter, setFilter] = useState<MuscleFilter | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(params.create === '1');
  const sections = useExerciseSections(query, filter);
  const p = t.training.picker;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/training/session'));

  const replacing = params.replace
    ? (session?.exercises.find((e) => e.uid === params.replace) ?? null)
    : null;
  const resolveIndex = params.resolve === undefined ? null : Number(params.resolve);
  const mention =
    resolveIndex !== null && Number.isInteger(resolveIndex)
      ? (session?.textDraft?.unresolved[resolveIndex] ?? null)
      : null;
  const single = replacing !== null || mention !== null;
  const initialTracking = ExerciseTrackingSchema.safeParse(params.tracking);

  const pick = (exercise: PickedExercise) => {
    if (replacing) actions.replaceExercise(slot, replacing.uid, exercise);
    else if (mention && resolveIndex !== null) actions.resolveMention(resolveIndex, exercise);
    close();
  };

  const toggle = (exercise: Exercise) =>
    setSelected((ids) =>
      ids.includes(exercise.id) ? ids.filter((id) => id !== exercise.id) : [...ids, exercise.id],
    );

  const add = () => {
    const picked = selected
      .map((id) => exerciseById.get(id))
      .filter((e): e is Exercise => e !== undefined);
    if (params.routine) {
      dispatchRoutineDraft({
        type: 'addExercises',
        sessionId: params.routine,
        exercises: picked.map((e) =>
          programExerciseFor({ id: e.id, label: exerciseName(e, locale), tracking: e.tracking }),
        ),
      });
    } else {
      actions.addExercises(slot, picked);
    }
    close();
  };

  if (creating) {
    return (
      <Screen testID="exercise-picker">
        <CustomExerciseForm
          initialName={query}
          initialTracking={initialTracking.success ? initialTracking.data : undefined}
          onCreated={(id, exercise) => {
            if (single) {
              pick({ id, label: exercise.name, tracking: exercise.tracking });
              return;
            }
            setSelected((ids) => [...ids, id]);
            setQuery('');
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      </Screen>
    );
  }

  const noResults = query.trim() !== '' && sections.length === 0;
  const createButton = (
    <Button
      variant={noResults ? 'primary' : 'ghost'}
      label={query.trim() ? format(p.createNamed, { name: query.trim() }) : p.create}
      onPress={() => setCreating(true)}
      testID="picker-create"
    />
  );

  let body;
  if (catalog.isPending) {
    body = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel={t.common.loading}
        style={styles.loading}
      />
    );
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
        selected={selected}
        onPress={single ? (exercise) => pick(actions.picked(exercise)) : toggle}
        header={
          noResults ? (
            <AppText tone="muted" testID="picker-no-results">
              {format(p.noResults, { query: query.trim() })}
            </AppText>
          ) : undefined
        }
        footer={createButton}
        testID="picker-list"
      />
    );
  }

  return (
    <Screen
      scroll={false}
      testID="exercise-picker"
      footer={
        <>
          {single ? null : (
            <Button
              label={selected.length ? format(p.add, { count: selected.length }) : p.addNone}
              disabled={selected.length === 0}
              onPress={add}
              testID="picker-add"
            />
          )}
          <Button variant="ghost" label={p.close} onPress={close} />
        </>
      }
    >
      <AppText variant="title">
        {replacing
          ? format(p.replaceTitle, { name: replacing.label })
          : mention
            ? format(p.resolveTitle, { words: mention.mention })
            : p.title}
      </AppText>
      <OfflineBanner />
      <TextField
        label={p.search}
        value={query}
        onChangeText={setQuery}
        placeholder={p.placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        testID="picker-search"
      />
      {query.trim() ? null : (
        <ChoiceGroup
          label={p.filters}
          options={FILTERS.map((value) => ({ value, label: t.training.muscleFilters[value] }))}
          value={filter}
          onChange={(value) => setFilter(value === filter ? null : value)}
          layout="scroll"
          testID="picker-filter"
        />
      )}
      <View style={styles.list}>{body}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: tokens.space.xl },
  gap: { gap: tokens.space.sm },
  list: { flex: 1 },
});
