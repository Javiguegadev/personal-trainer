import { useCallback, useEffect, useState } from 'react';

/**
 * Seconds left until a deadline that starts `seconds` from now. Based on the clock rather than on
 * counting ticks, so it stays right after the app was in the background.
 */
export function useCountdown(seconds: number): { remaining: number; restart: () => void } {
  const [deadline, setDeadline] = useState(() => Date.now() + seconds * 1000);
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      return left;
    };
    if (tick() === 0) return;
    const id = setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [deadline]);

  const restart = useCallback(() => setDeadline(Date.now() + seconds * 1000), [seconds]);
  return { remaining, restart };
}
