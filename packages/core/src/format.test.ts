import { describe, expect, it } from 'vitest';
import {
  formatDecimal,
  formatLongDate,
  formatNumber,
  formatShortDate,
  formatWeekdayDay,
  parseDecimal,
} from './format';

describe('parseDecimal', () => {
  it('accepts a decimal comma or point (AC9: Spanish formats)', () => {
    expect(parseDecimal('1,75')).toBe(1.75);
    expect(parseDecimal(' 64.5 ')).toBe(64.5);
    expect(parseDecimal('80')).toBe(80);
  });

  it('rejects anything that is not a plain positive number', () => {
    for (const text of ['', 'abc', '1,2,3', '-5', '5 kg', '1.000,5']) {
      expect(parseDecimal(text), text).toBeNull();
    }
  });
});

describe('formatDecimal', () => {
  it('uses the locale decimal separator and drops trailing zeros', () => {
    expect(formatDecimal(64.5, 'es')).toBe('64,5');
    expect(formatDecimal(64.5, 'en')).toBe('64.5');
    expect(formatDecimal(70, 'es')).toBe('70');
    expect(formatDecimal(176.37, 'en', 0)).toBe('176');
  });
});

describe('formatNumber', () => {
  it('groups thousands per locale', () => {
    expect(formatNumber(2140, 'en')).toBe('2,140');
    // es-ES groups only from five digits (CLDR minimumGroupingDigits = 2, RAE).
    expect(formatNumber(1690, 'es')).toBe('1690');
    expect(formatNumber(12140, 'es')).toBe('12.140');
    expect(formatNumber(1.65, 'es', 2)).toBe('1,65');
  });
});

describe('date labels', () => {
  // 13 November 2026 is a Friday.
  it('formats a day in the user language without moving it to another day', () => {
    expect(formatLongDate('2026-11-13', 'es')).toMatch(/viernes.*13.*noviembre/);
    expect(formatLongDate('2026-11-13', 'en')).toMatch(/Friday.*13.*November/);
    expect(formatShortDate('2026-11-01', 'es')).toMatch(/^1 nov/);
    expect(formatShortDate('2025-11-13', 'en', true)).toMatch(/13 Nov.*2025/);
    expect(formatWeekdayDay('2026-11-13', 'es')).toMatch(/vie.*13/);
  });
});
