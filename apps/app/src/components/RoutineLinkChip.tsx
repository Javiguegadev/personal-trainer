import type { LiveSession } from '@pt/core';
import { View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useProgram } from '@/lib/api';
import { dispatchSession, type SessionSlot } from '@/lib/liveSession';
import { AppText } from './AppText';
import { Checkbox } from './Checkbox';

/**
 * "Cuenta como Rutina A" (spec 012 AC13): a draft that holds at least half of the exercises of a
 * routine session counts as that session, on by default, so saving moves the rotation (spec 010 AC19).
 * Off, the workout is saved free.
 */
export function RoutineLinkChip({ slot, session }: { slot: SessionSlot; session: LiveSession }) {
  const { t, format } = useI18n();
  const program = useProgram();
  const linked = session.textDraft?.routineSessionId ?? null;
  const routineSession = linked ? program.data?.sessions.find((s) => s.id === linked) : undefined;
  if (!linked || !routineSession) return null;
  const d = t.training.draft;
  return (
    <View testID="routine-link">
      <Checkbox
        label={format(d.routineLink, { session: routineSession.name })}
        checked={session.programSessionId === linked}
        onChange={(on) => dispatchSession(slot, { type: 'setRoutineLink', on })}
        testID="routine-link-toggle"
      />
      <AppText variant="caption" tone="muted">
        {d.routineHint}
      </AppText>
    </View>
  );
}
