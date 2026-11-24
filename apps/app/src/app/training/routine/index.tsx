import { saveProgramVariables } from '@pt/api-client';
import { PROGRAM_LIMITS, type Profile, type Program } from '@pt/contracts';
import {
  canSaveProgram,
  programToDraft,
  programToRequest,
  routineSafety,
  type ProgramDraft,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ProgramExerciseRow } from '@/components/ProgramExerciseRow';
import { Screen } from '@/components/Screen';
import { SyncBadge } from '@/components/SyncBadge';
import { TextField } from '@/components/TextField';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useExerciseLookups } from '@/hooks/useTraining';
import {
  useDeleteProgram,
  useMe,
  usePendingTrainingIds,
  useProgram,
  useSaveProgram,
} from '@/lib/api';
import { newId } from '@/lib/id';
import { dispatchRoutineDraft, setRoutineDraft, useRoutineDraft } from '@/lib/routineDraft';

/**
 * "Mi rutina" (spec 010 AC16, AC20): the draft the wizard or "Mi rutina" put in `routineDraft` (the
 * proposal, or a copy of the saved routine), with its name, its sessions and their exercises, sets and
 * reps. "Guardar rutina" is one queued write, so it works offline (AC21); a new routine replaces the
 * old one after a confirmation.
 */
export default function RoutineRoute() {
  const me = useMe();
  const program = useProgram();
  const draft = useRoutineDraft();

  // Opened by a link or a reload: no draft in memory yet, so start from the saved routine.
  useEffect(() => {
    if (!draft && program.data) setRoutineDraft(programToDraft(program.data));
  }, [draft, program.data]);

  if (!me.data?.profile) return <BlockingState />;
  return (
    <RoutineScreen
      profile={me.data.profile}
      saved={program.data ?? null}
      loading={!draft && (program.isPending || Boolean(program.data))}
      failed={!draft && program.isError && !program.data}
      onRetry={() => void program.refetch()}
    />
  );
}

function RoutineScreen({
  profile,
  saved,
  loading,
  failed,
  onRetry,
}: {
  profile: Profile;
  saved: Program | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const draft = useRoutineDraft();
  const { exercises } = useExerciseLookups();
  const save = useSaveProgram();
  const remove = useDeleteProgram();
  const pendingIds = usePendingTrainingIds();
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'replace' | 'delete' | null>(null);
  const r = t.routine;
  const e = r.editor;
  const safety = routineSafety(profile.safetyFlags);

  const close = () => {
    setRoutineDraft(null);
    if (router.canGoBack()) router.back();
    else router.replace('/training');
  };

  if (loading) {
    return (
      <Screen testID="routine-screen">
        <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
      </Screen>
    );
  }
  if (!draft) {
    return (
      <Screen testID="routine-screen">
        <AppText variant="title">{e.title}</AppText>
        {failed ? (
          <>
            <Notice tone="danger" message={e.loadError} />
            <Button variant="secondary" label={t.common.retry} onPress={onRetry} />
          </>
        ) : (
          <>
            <AppText tone="muted" testID="routine-none">
              {e.none}
            </AppText>
            <Button
              label={r.create}
              onPress={() => router.replace('/training/routine/new')}
              testID="routine-none-create"
            />
          </>
        )}
        <Button variant="ghost" label={e.cancel} onPress={close} />
      </Screen>
    );
  }

  const isNew = saved?.id !== draft.id;
  const replacing = isNew && saved !== null;
  const canSave = canSaveProgram(draft);

  const write = (current: ProgramDraft) => {
    const recordedAt = new Date().toISOString();
    // "Cambiar de rutina" (AC20): the delete goes first in the same queue, so the API never sees two.
    if (saved && saved.id !== current.id) remove.mutate({ id: saved.id, recordedAt });
    const request = programToRequest(current, { recordedAt, locale });
    save.mutate(saveProgramVariables(current.id, request, exercises, saved));
    close();
  };

  const onSave = () => {
    if (!canSave) return;
    if (replacing && confirm !== 'replace') {
      setConfirm('replace');
      return;
    }
    write(draft);
  };

  const onDelete = () => {
    if (!saved) return;
    remove.mutate({ id: saved.id, recordedAt: new Date().toISOString() });
    close();
  };

  return (
    <Screen
      testID="routine-screen"
      footer={
        <>
          {confirm === 'replace' ? (
            <Notice tone="warning" message={e.replaceConfirm} testID="routine-replace-confirm" />
          ) : null}
          {!canSave ? (
            <AppText variant="caption" tone="muted" testID="routine-cant-save">
              {e.cantSave}
            </AppText>
          ) : null}
          <Button
            label={confirm === 'replace' ? e.replaceYes : e.save}
            disabled={!canSave}
            onPress={onSave}
            testID="routine-save"
          />
          <Button
            variant="ghost"
            label={e.cancel}
            onPress={confirm === 'replace' ? () => setConfirm(null) : close}
            testID="routine-cancel"
          />
        </>
      }
    >
      <View style={styles.title}>
        <AppText variant="title" style={styles.flex}>
          {isNew ? e.newTitle : e.title}
        </AppText>
        {saved && pendingIds.includes(saved.id) ? <SyncBadge /> : null}
      </View>
      <OfflineBanner />
      {draft.origin === 'template' ? (
        <AppText variant="caption" tone="muted" testID="routine-provisional">
          {e.provisional}
        </AppText>
      ) : null}
      {safety.showsPainLine ? (
        <AppText variant="caption" tone="muted" testID="routine-pain-line">
          {r.painLine}
        </AppText>
      ) : null}
      <TextField
        label={e.name}
        value={draft.name}
        onChangeText={(name) => dispatchRoutineDraft({ type: 'rename', name })}
        maxLength={PROGRAM_LIMITS.nameMax}
        testID="routine-name"
      />
      {draft.sessions.map((session, s) => (
        <Card key={session.id} title={session.name || format(e.newSession, { n: s + 1 })}>
          <TextField
            label={e.sessionName}
            value={session.name}
            onChangeText={(name) =>
              dispatchRoutineDraft({ type: 'renameSession', sessionId: session.id, name })
            }
            maxLength={PROGRAM_LIMITS.sessionNameMax}
            testID={`routine-session-name-${s}`}
          />
          {session.exercises.length === 0 ? (
            <AppText tone="muted">{e.emptySession}</AppText>
          ) : (
            session.exercises.map((exercise, i) => {
              const rowKey = `${session.id}:${i}`;
              return (
                <ProgramExerciseRow
                  key={`${rowKey}:${exercise.exerciseId ?? exercise.label}`}
                  exercise={exercise}
                  index={i}
                  count={session.exercises.length}
                  open={openRow === rowKey}
                  onToggle={() => setOpenRow(openRow === rowKey ? null : rowKey)}
                  onChange={(patch) =>
                    dispatchRoutineDraft({
                      type: 'updateExercise',
                      sessionId: session.id,
                      index: i,
                      patch,
                    })
                  }
                  onMove={(offset) => {
                    setOpenRow(null);
                    dispatchRoutineDraft({
                      type: 'moveExercise',
                      sessionId: session.id,
                      index: i,
                      offset,
                    });
                  }}
                  onRemove={() => {
                    setOpenRow(null);
                    dispatchRoutineDraft({
                      type: 'removeExercise',
                      sessionId: session.id,
                      index: i,
                    });
                  }}
                  testID={`routine-exercise-${s}-${i}`}
                />
              );
            })
          )}
          {session.exercises.length < PROGRAM_LIMITS.exercisesPerSessionMax ? (
            <Button
              variant="secondary"
              label={e.addExercise}
              onPress={() =>
                router.push({ pathname: '/training/picker', params: { routine: session.id } })
              }
              testID={`routine-add-exercise-${s}`}
            />
          ) : null}
          {draft.sessions.length > PROGRAM_LIMITS.sessionsMin ? (
            <Button
              variant="ghost"
              label={e.removeSession}
              onPress={() => dispatchRoutineDraft({ type: 'removeSession', sessionId: session.id })}
              testID={`routine-remove-session-${s}`}
            />
          ) : null}
        </Card>
      ))}
      {draft.sessions.length < PROGRAM_LIMITS.sessionsMax ? (
        <Button
          variant="secondary"
          label={e.addSession}
          onPress={() =>
            dispatchRoutineDraft({
              type: 'addSession',
              id: newId(),
              name: format(e.newSession, { n: draft.sessions.length + 1 }),
            })
          }
          testID="routine-add-session"
        />
      ) : null}
      {isNew ? null : (
        <View style={styles.danger}>
          <Button
            variant="ghost"
            label={e.change}
            onPress={() => router.replace('/training/routine/new')}
            testID="routine-change"
          />
          {confirm === 'delete' ? (
            <Notice tone="warning" message={e.deleteConfirm} testID="routine-delete-confirm">
              <View style={styles.confirm}>
                <Button
                  variant="danger"
                  label={e.deleteYes}
                  onPress={onDelete}
                  testID="routine-delete-yes"
                />
                <Button variant="ghost" label={e.cancel} onPress={() => setConfirm(null)} />
              </View>
            </Notice>
          ) : (
            <Button
              variant="ghost"
              label={e.delete}
              onPress={() => setConfirm('delete')}
              testID="routine-delete"
            />
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  flex: { flex: 1 },
  danger: { gap: tokens.space.xs, marginTop: tokens.space.md },
  confirm: { flexDirection: 'row', gap: tokens.space.sm, marginTop: tokens.space.sm },
});
