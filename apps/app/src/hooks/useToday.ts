import { localToday } from '@pt/core';
import { useMemo, useState } from 'react';
import { useMe } from '@/lib/api';
import { profileWeek } from '@/lib/week';

/** "Mi día empieza a las" of the cached profile (spec 010 AC6); 0 (midnight) until it is known. */
export function useDayStartMinute(): number {
  return profileWeek(useMe({ enabled: false }).data?.profile).dayStartMinute;
}

/**
 * The user's local date (YYYY-MM-DD) when the screen opened, sent with every write; the API checks it
 * is ±1 day. Before "Mi día empieza a las" it is still the day before (spec 010 AC6): Today, the Food
 * tab, the weight sheet and the Training tab all read it from here.
 */
export function useToday(): string {
  const dayStart = useDayStartMinute();
  const [openedAt] = useState(() => new Date());
  return useMemo(() => localToday(openedAt, dayStart), [openedAt, dayStart]);
}
