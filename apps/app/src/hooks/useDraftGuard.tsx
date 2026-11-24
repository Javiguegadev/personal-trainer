import { sessionHasContent } from '@pt/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { DraftReplaceNotice } from '@/components/DraftReplaceNotice';
import { readSession, setSession } from '@/lib/liveSession';

/**
 * Asks before something replaces an unsaved past session in the `draft` slot (spec 012 AC2): "Registrar
 * entreno pasado", "Sesión de gimnasio" of a day and "Describir entreno". `guard(action)` runs the
 * action at once when there is nothing to lose; otherwise `notice` asks first.
 */
export function useDraftGuard() {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = (action: () => void) => {
    const draft = readSession('draft');
    if (draft && sessionHasContent(draft)) setPending(() => action);
    else action();
  };

  const notice = pending ? (
    <DraftReplaceNotice
      onReplace={() => {
        setPending(null);
        setSession('draft', null);
        pending();
      }}
      onOpen={() => {
        setPending(null);
        router.push({ pathname: '/training/session', params: { slot: 'draft' } });
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { guard, notice, asking: pending !== null };
}
