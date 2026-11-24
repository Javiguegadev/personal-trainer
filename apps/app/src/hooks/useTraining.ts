import { saveWorkoutVariables } from '@pt/api-client';
import type {
  ActivityKindForLog,
  ActivityType,
  Exercise,
  ExerciseTracking,
  Program,
  ProgramSession,
  Workout,
  WorkoutDraft,
} from '@pt/contracts';
import {
  adjustSessionForReadiness,
  canRewriteWorkout,
  draftToSession,
  editWorkout,
  exerciseName,
  liveExerciseFromDraft,
  newLiveExercise,
  repeatWorkout,
  sessionFromProgram,
  sessionToRequest,
  startSession,
  workoutToRequest,
  type LiveSession,
} from '@pt/core';
import { useMemo } from 'react';
import { useDeleteWorkout, useExerciseCatalog, useExerciseStats, useSaveWorkout } from '@/lib/api';
import { newId } from '@/lib/id';
import { dispatchSession, readSession, setSession, type SessionSlot } from '@/lib/liveSession';
import { offerWorkoutUndo } from '@/lib/workoutUndo';
import { useTodayReadiness } from './useCheckin';
import { useI18n } from './useI18n';
import { useToday } from './useToday';

/** An exercise chosen for a card: from the catalog, or created a moment ago (spec 012 AC7, AC12). */
export interface PickedExercise {
  id: string;
  label: string;
  tracking: ExerciseTracking;
}

/** The catalog and the stats, as lookups by id. Both are cached offline (spec 009 AC22). */
export function useExerciseLookups() {
  const catalog = useExerciseCatalog();
  const stats = useExerciseStats();
  const exercises = catalog.data?.exercises;
  const statsList = stats.data;
  const lookups = useMemo(
    () => ({
      exercises: exercises ?? [],
      exerciseById: new Map((exercises ?? []).map((e) => [e.id, e])),
      statsById: new Map((statsList ?? []).map((s) => [s.exerciseId, s])),
      statsList: statsList ?? [],
    }),
    [exercises, statsList],
  );
  return { catalog, stats, ...lookups };
}

/**
 * Every write of the workout log (spec 009): sessions live in device storage until they are saved, then
 * one optimistic `PUT`, queued offline by `@pt/api-client` (AC22). Screens call these and move on.
 */
export function useTrainingActions() {
  const { locale } = useI18n();
  const today = useToday();
  const save = useSaveWorkout();
  const remove = useDeleteWorkout();
  const { exercises, statsById } = useExerciseLookups();
  const { readiness } = useTodayReadiness();
  // A session started live today fits the day's readiness, once, at start (spec 011 AC7, AC10).
  const fit = (session: LiveSession) => adjustSessionForReadiness(session, readiness, today);

  const now = () => new Date().toISOString();
  const placement = () => ({ recordedAt: now(), today, locale });

  const write = (
    id: string,
    request: Parameters<typeof saveWorkoutVariables>[1],
    editing: Workout | null,
  ) => save.mutate(saveWorkoutVariables(id, request, exercises, editing));

  return {
    /** "Empezar entreno" (AC6); with a low readiness it carries the reason (spec 011 decision b). */
    startLive(): LiveSession {
      const session = fit(
        startSession({ id: newId(), localDate: today, startedAt: now(), mode: 'live' }),
      );
      setSession('live', session);
      return session;
    },
    /**
     * "Empezar" on a routine session (spec 010 AC18): prefilled from last time or the routine, with
     * one set less per exercise on a reduced or low day (spec 011 AC7).
     */
    startProgram(session: ProgramSession): LiveSession {
      const live = fit(
        sessionFromProgram(session, {
          id: newId(),
          localDate: today,
          startedAt: now(),
          stats: statsById,
          newId,
        }),
      );
      setSession('live', live);
      return live;
    },
    /** "Registrar entreno pasado" (AC17): the same screen without the rest timer. */
    startManual(localDate: string, startedAt: string): LiveSession {
      const session = startSession({ id: newId(), localDate, startedAt, mode: 'manual' });
      setSession('draft', session);
      return session;
    },
    /**
     * The gym draft of a sentence (spec 012 AC10, AC13): a past session in the `draft` slot, its sets
     * completed or marked, linked to the routine session it matches.
     */
    startFromDraft(
      draft: WorkoutDraft,
      startedAt: string,
      routine: { program: Pick<Program, 'sessions'>; nextSessionId: string | null } | null,
    ): LiveSession {
      const session = draftToSession(draft, {
        id: newId(),
        startedAt,
        stats: statsById,
        newId,
        locale,
        ...(routine ? { routine } : {}),
      });
      setSession('draft', session);
      return session;
    },
    /**
     * An exercise picked or just created for a mention the catalog lacked (spec 012 AC7): the sets said
     * move to it, checked against its tracking.
     */
    resolveMention(index: number, exercise: PickedExercise) {
      const session = readSession('draft');
      const mention = session?.textDraft?.unresolved[index];
      if (!session || !mention) return;
      dispatchSession('draft', {
        type: 'resolveMention',
        index,
        exercise: liveExerciseFromDraft({
          exercise,
          sets: mention.sets,
          stats: statsById.get(exercise.id) ?? null,
          newId,
          completedAt: session.startedAt,
        }),
      });
    },
    /** "Cambiar ejercicio" (spec 012 AC12). */
    replaceExercise(slot: SessionSlot, uid: string, exercise: PickedExercise) {
      dispatchSession(slot, {
        type: 'replaceExercise',
        uid,
        exercise,
        stats: statsById.get(exercise.id) ?? null,
      });
    },
    /** The id, name and tracking of an exercise of the catalog, in the user's language. */
    picked(exercise: Exercise): PickedExercise {
      return {
        id: exercise.id,
        label: exerciseName(exercise, locale),
        tracking: exercise.tracking,
      };
    },
    /** "Repetir" (AC18): a live session with the exercises and sets of a past one. */
    repeat(workout: Workout): LiveSession {
      const session = fit(
        repeatWorkout(workout, {
          id: newId(),
          localDate: today,
          startedAt: now(),
          stats: statsById,
          newId,
        }),
      );
      setSession('live', session);
      return session;
    },
    /** "Editar ejercicios y series" of a saved gym session (AC19). */
    edit(workout: Workout): LiveSession {
      const session = editWorkout(workout, { stats: statsById, newId });
      setSession('draft', session);
      return session;
    },
    /** The picker's choice (AC7): cards prefilled from last time. */
    addExercises(slot: SessionSlot, picked: readonly Exercise[]) {
      dispatchSession(slot, {
        type: 'addExercises',
        exercises: picked.map((exercise) =>
          newLiveExercise({
            exercise: {
              id: exercise.id,
              label: exerciseName(exercise, locale),
              tracking: exercise.tracking,
            },
            stats: statsById.get(exercise.id) ?? null,
            newId,
          }),
        ),
      });
    },
    /**
     * "Guardar" of the finish sheet (AC12): only the completed sets. Returns false when nothing was
     * completed. `editing` is the saved workout an edit started from (AC19).
     */
    saveSession(
      slot: SessionSlot,
      finish: { minutes: number; sessionRpe: number | null; name: string | null },
      editing: Workout | null,
    ): boolean {
      const session = readSession(slot);
      if (!session) return false;
      const request = sessionToRequest(session, { ...finish, ...placement() });
      if (!request) return false;
      write(session.id, request, editing);
      setSession(slot, null);
      return true;
    },
    discard(slot: SessionSlot) {
      setSession(slot, null);
    },
    /** AC16: an activity with one tap; `text` when it came from a sentence (spec 012 AC14). */
    saveActivity(input: {
      inputMethod: 'activity' | 'text';
      kind: ActivityKindForLog;
      activity: ActivityType | null;
      name: string | null;
      localDate: string;
      startedAt: string;
      minutes: number;
      sessionRpe: number | null;
    }) {
      write(newId(), { ...input, ...placement() }, null);
    },
    /** AC19: the day, duration, effort or name of a saved workout. */
    update(workout: Workout, changes: Parameters<typeof workoutToRequest>[2]) {
      const request = workoutToRequest(workout, placement(), changes);
      if (request) write(workout.id, request, workout);
    },
    /** AC19: deleted at once, with 5 seconds to undo instead of a confirmation. */
    remove(workout: Workout) {
      remove.mutate({ id: workout.id, recordedAt: now() });
      // A workout that cannot be written again cannot come back: its sheet asks first instead.
      if (canRewriteWorkout(workout)) offerWorkoutUndo(workout);
    },
    /** The undo writes the workout back with a later time, which wins over the delete (AC23). */
    restore(workout: Workout) {
      const request = workoutToRequest(workout, placement());
      if (request) write(workout.id, request, workout);
    },
  };
}
