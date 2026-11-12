import { describe, expect, it } from 'vitest';
import { toLocalIsoDate } from './dates';

describe('toLocalIsoDate', () => {
  it('uses the local calendar date, zero-padded', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(toLocalIsoDate(new Date(2026, 10, 11, 0, 1))).toBe('2026-11-11');
  });
});
