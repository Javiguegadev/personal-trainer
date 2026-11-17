import { toLocalIsoDate } from '@pt/core';
import { useState } from 'react';

/** The user's local date (YYYY-MM-DD), sent with profile requests; the API checks it is ±1 day. */
export function useToday(): string {
  const [today] = useState(() => toLocalIsoDate(new Date()));
  return today;
}
