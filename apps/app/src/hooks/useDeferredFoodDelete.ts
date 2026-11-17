import type { Food } from '@pt/contracts';
import { useEffect, useRef, useState } from 'react';
import { useDeleteCustomFood } from '@/lib/api';
import { FOOD_UNDO_MS } from '@/lib/foodUndo';

/**
 * Deleting one of the user's own foods with an undo (spec 006 AC12). Unlike a logged item, a deleted
 * food cannot be written back as it was: the API unlinks it from the items that used it. So the delete
 * is held for the seconds of the undo and sent when they end, or when the screen closes.
 */
export function useDeferredFoodDelete() {
  const remove = useDeleteCustomFood();
  const [pending, setPending] = useState<Food | null>(null);
  // Read by the timer and by the unmount, which must see the latest food without re-running.
  const waiting = useRef<Food | null>(null);
  const send = useRef(remove.mutate);
  useEffect(() => {
    send.current = remove.mutate;
  });

  const flush = () => {
    const food = waiting.current;
    waiting.current = null;
    if (food) send.current({ food });
  };

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      flush();
      setPending(null);
    }, FOOD_UNDO_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  // The screen closed before the undo ran out: the delete still happens.
  useEffect(() => flush, []);

  return {
    /** The food whose delete can still be undone: hide it from the lists meanwhile. */
    pending,
    request(food: Food) {
      // A second delete sends the first at once.
      flush();
      waiting.current = food;
      setPending(food);
    },
    undo() {
      waiting.current = null;
      setPending(null);
    },
  };
}
