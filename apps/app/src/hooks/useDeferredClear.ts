import { profileInputWithout, type ClearableItem } from '@pt/core';
import { useEffect, useRef, useState } from 'react';
import { useMe, useUpdateProfile } from '@/lib/api';
import { useToday } from './useToday';

/** How long "Borrar" in "Lo que sé de ti" can be undone before it is sent (spec 014 AC12). */
export const ABOUT_ME_UNDO_MS = 5000;

/**
 * Clearing an optional item of the profile with a 5-second undo (spec 014 AC12, decided with the
 * human: nothing is sent until the undo runs out). It is sent when the seconds end or the screen
 * closes, built from the profile as it is then, so an edit made meanwhile is kept.
 */
export function useDeferredClear() {
  const me = useMe({ enabled: false });
  const today = useToday();
  const update = useUpdateProfile();
  const [pending, setPending] = useState<ClearableItem | null>(null);
  // Read by the timer and by the unmount, which must see the latest values without re-running.
  const waiting = useRef<ClearableItem | null>(null);
  const latest = useRef({ data: me.data, today, mutate: update.mutate });
  useEffect(() => {
    latest.current = { data: me.data, today, mutate: update.mutate };
  });

  const flush = () => {
    const item = waiting.current;
    waiting.current = null;
    const { data, today: day, mutate } = latest.current;
    if (!item || !data?.profile) return;
    const input = profileInputWithout(data.profile, data.dietaryPrefs, item, day);
    if (input) mutate(input);
  };

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      flush();
      setPending(null);
    }, ABOUT_ME_UNDO_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  // The screen closed before the undo ran out: the clear still happens.
  useEffect(() => flush, []);

  return {
    /** The item whose clear can still be undone: show it as cleared meanwhile. */
    pending,
    /** The save of the last clear failed: the item shows again, with the reason. */
    error: update.error,
    saving: update.isPending,
    request(item: ClearableItem) {
      // A second clear sends the first at once.
      flush();
      update.reset();
      waiting.current = item;
      setPending(item);
    },
    undo() {
      waiting.current = null;
      setPending(null);
    },
  };
}
