import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import {
  invitesWeighIn,
  isWeightTrendHidden,
  targetWeightProgress,
  weightAverageSeries,
  weightTrend,
  type WeightPoint,
} from './trend';

const TODAY = '2026-11-13';

/** An entry `age` days before today. */
const entry = (age: number, weightKg: number): WeightPoint => ({
  localDate: addDays(TODAY, -age),
  weightKg,
});

/** Three entries on days 12, 10 and 8 before today (mean day 10): the earlier window. */
const before = (a: number, b: number, c: number) => [entry(12, a), entry(10, b), entry(8, c)];
/** Three entries on days 5, 3 and 1 before today (mean day 3): the recent window. */
const recent = (a: number, b: number, c: number) => [entry(5, a), entry(3, b), entry(1, c)];

describe('weightTrend (spec 003 AC23)', () => {
  it('returns nothing without entries', () => {
    expect(weightTrend([], TODAY)).toEqual({
      last: null,
      averageKg: null,
      changePerWeekKg: null,
      fastLoss: false,
    });
  });

  it('shows only the last weight with 2 entries in the week', () => {
    expect(weightTrend([entry(1, 80.4), entry(0, 80)], TODAY)).toEqual({
      last: { localDate: TODAY, weightKg: 80 },
      averageKg: null,
      changePerWeekKg: null,
      fastLoss: false,
    });
  });

  it('gives the 7-day average from 3 entries, and no change without the week before (gaps)', () => {
    // Recent window 80.0, 79.8, 79.6 → mean 79.8. Earlier window has only 2 entries.
    const trend = weightTrend([entry(12, 81), entry(9, 80.8), ...recent(80, 79.8, 79.6)], TODAY);
    expect(trend.averageKg).toBeCloseTo(79.8, 10);
    expect(trend.changePerWeekKg).toBeNull();
    expect(trend.fastLoss).toBe(false);
  });

  it('computes a steady loss per week, normalised by the days between the windows', () => {
    // Earlier: days 13, 11, 9 → mean day 11, mean 80.4. Recent: days 5, 3, 1 → mean day 3, mean 79.8.
    // (79.8 − 80.4) / 8 days × 7 = −0.525 kg per week = 0.65 % of 80.4 → not fast.
    const trend = weightTrend(
      [entry(13, 80.6), entry(11, 80.4), entry(9, 80.2), ...recent(80, 79.8, 79.6)],
      TODAY,
    );
    expect(trend.changePerWeekKg).toBeCloseTo(-0.525, 10);
    expect(trend.fastLoss).toBe(false);
    expect(trend.last).toEqual({ localDate: addDays(TODAY, -1), weightKg: 79.6 });
  });

  it('computes a gain', () => {
    // Earlier (days 13, 11, 9) mean 70.2; recent mean 71.0; 0.8 / 8 × 7 = +0.7 kg per week.
    const trend = weightTrend(
      [entry(13, 70), entry(11, 70.2), entry(9, 70.4), ...recent(70.8, 71, 71.2)],
      TODAY,
    );
    expect(trend.changePerWeekKg).toBeCloseTo(0.7, 10);
    expect(trend.fastLoss).toBe(false);
  });

  it('uses the weight that replaced an earlier one on the same day', () => {
    const first = [...before(80, 80, 80), ...recent(79.8, 79.6, 79.4)];
    const replaced = first.map((e) => (e.localDate === addDays(TODAY, -1) ? entry(1, 79.7) : e));
    // Recent mean (79.8 + 79.6 + 79.7) / 3 = 79.7
    expect(weightTrend(replaced, TODAY).averageKg).toBeCloseTo(79.7, 10);
    expect(weightTrend(replaced, TODAY).last?.weightKg).toBe(79.7);
  });

  it('ignores the order of the entries and anything dated after today', () => {
    const entries = [...recent(80, 79.8, 79.6), ...before(80.4, 80.4, 80.4)];
    const shuffled = [...entries].reverse();
    expect(weightTrend([...shuffled, entry(-1, 60)], TODAY)).toEqual(weightTrend(entries, TODAY));
  });

  describe('fast loss (AC24): more than 1 % per week', () => {
    // Windows 7 days apart (mean days 10 and 3), so the change per week is the difference of the means.
    it('does not flag exactly 1.00 %', () => {
      // 80 → 79.2: −0.8 kg per week = 1.00 % of 80
      const trend = weightTrend([...before(80, 80, 80), ...recent(79.2, 79.2, 79.2)], TODAY);
      expect(trend.changePerWeekKg).toBeCloseTo(-0.8, 10);
      expect(trend.fastLoss).toBe(false);
    });

    it('flags 1.01 %', () => {
      // 80 → 79.192: −0.808 kg per week = 1.01 % of 80
      const trend = weightTrend([...before(80, 80, 80), ...recent(79.192, 79.192, 79.192)], TODAY);
      expect(trend.changePerWeekKg).toBeCloseTo(-0.808, 10);
      expect(trend.fastLoss).toBe(true);
    });

    it('flags a sustained fast loss', () => {
      // Recent mean 78.4: −1.6 kg per week = 2 %. Without the lowest (78.2): mean 78.5 on mean day 4,
      // (78.5 − 80) / 6 × 7 = −1.75 → still fast.
      const trend = weightTrend([...before(80, 80, 80), ...recent(78.6, 78.4, 78.2)], TODAY);
      expect(trend.changePerWeekKg).toBeCloseTo(-1.6, 10);
      expect(trend.fastLoss).toBe(true);
    });

    it('is not raised by one mistyped low reading', () => {
      // 70.6 typed instead of 79.6. Recent mean 76.67 → −3.37 kg per week (4.2 %), but without the
      // lowest entry: mean 79.7 on mean day 4, (79.7 − 80.033) / 6 × 7 = −0.39 (0.49 %) → no flag.
      const trend = weightTrend([...before(80, 80.2, 79.9), ...recent(79.8, 79.6, 70.6)], TODAY);
      expect(trend.averageKg).toBeCloseTo(76.667, 2);
      expect(trend.fastLoss).toBe(false);
    });

    it('is not raised by entries bunched 11 days apart at a real 0.7 % per week', () => {
      // 0.08 kg per day. Days 13–11: 80.00, 79.92, 79.84 (mean 79.92, mean day 12).
      // Days 2–0: 79.12, 79.04, 78.96 (mean 79.04, mean day 1). −0.88 / 11 × 7 = −0.56 → 0.70 %.
      const trend = weightTrend(
        [
          entry(13, 80),
          entry(12, 79.92),
          entry(11, 79.84),
          entry(2, 79.12),
          entry(1, 79.04),
          entry(0, 78.96),
        ],
        TODAY,
      );
      expect(trend.changePerWeekKg).toBeCloseTo(-0.56, 10);
      expect(trend.fastLoss).toBe(false);
    });

    it('gives no weekly change when the windows are only 3 days apart', () => {
      // Days 9–7 and 6–4: the mean days are 8 and 5, too close to extrapolate a week.
      const trend = weightTrend(
        [
          entry(9, 80),
          entry(8, 79.8),
          entry(7, 79.5),
          entry(6, 79.3),
          entry(5, 79.1),
          entry(4, 78.8),
        ],
        TODAY,
      );
      expect(trend.averageKg).toBeCloseTo(79.067, 2);
      expect(trend.changePerWeekKg).toBeNull();
      expect(trend.fastLoss).toBe(false);
    });
  });
});

describe('weightAverageSeries (AC14)', () => {
  it('has a point on each day whose 7-day window holds at least 3 entries', () => {
    const entries = [entry(9, 81), entry(8, 80.7), entry(6, 80.4), entry(0, 80)];
    // Day 9: 1 entry. Day 8: 2. Day 6: 81, 80.7, 80.4 → 80.7. Day 0: only 80.4 and 80 → no point.
    const series = weightAverageSeries(entries);
    expect(series).toHaveLength(1);
    expect(series[0]?.localDate).toBe(addDays(TODAY, -6));
    expect(series[0]?.weightKg).toBeCloseTo(80.7, 10);
  });
});

describe('protected profiles (AC4, AC15)', () => {
  it('hides the trend with an eating-disorder signal or pregnancy only', () => {
    expect(isWeightTrendHidden(['ed_soft_stop'])).toBe(true);
    expect(isWeightTrendHidden(['pregnancy', 'injury'])).toBe(true);
    expect(isWeightTrendHidden(['teen_limited', 'low_bmi', 'calorie_floor'])).toBe(false);
    expect(isWeightTrendHidden([])).toBe(false);
  });

  it('does not invite those profiles, or 16–17-year-olds, to weigh in', () => {
    expect(invitesWeighIn([])).toBe(true);
    expect(invitesWeighIn(['injury', 'high_training_load'])).toBe(true);
    expect(invitesWeighIn(['ed_soft_stop'])).toBe(false);
    expect(invitesWeighIn(['pregnancy'])).toBe(false);
    expect(invitesWeighIn(['teen_limited'])).toBe(false);
  });
});

describe('targetWeightProgress (AC16)', () => {
  const trend = { last: { localDate: TODAY, weightKg: 81 }, averageKg: 80.4 };

  it('measures from the 7-day average, or from the last weight without one', () => {
    expect(targetWeightProgress(trend, 76, 'lose', [])).toEqual({
      kind: 'distance',
      kg: expect.closeTo(4.4, 10) as number,
      direction: 'down',
    });
    expect(targetWeightProgress({ ...trend, averageKg: null }, 76, 'lose', [])).toEqual({
      kind: 'distance',
      kg: 5,
      direction: 'down',
    });
    expect(targetWeightProgress(trend, 84, 'gain', [])).toMatchObject({ direction: 'up' });
  });

  it('says "reached" when the target was reached or passed in the direction of the goal', () => {
    expect(targetWeightProgress(trend, 80.4, 'lose', [])).toEqual({ kind: 'reached' });
    expect(targetWeightProgress(trend, 81, 'lose', [])).toEqual({ kind: 'reached' });
    expect(targetWeightProgress(trend, 79, 'gain', [])).toEqual({ kind: 'reached' });
    // Maintaining: there is no direction, so being above or below is a distance.
    expect(targetWeightProgress(trend, 79, 'maintain', [])).toMatchObject({ kind: 'distance' });
  });

  it.each(['ed_soft_stop', 'pregnancy', 'teen_limited', 'low_bmi', 'low_target_bmi'] as const)(
    'is hidden with %s',
    (flag) => {
      expect(targetWeightProgress(trend, 76, 'lose', [flag])).toEqual({ kind: 'hidden' });
    },
  );

  it('is hidden without a target or without entries', () => {
    expect(targetWeightProgress(trend, null, 'lose', [])).toEqual({ kind: 'hidden' });
    expect(targetWeightProgress({ last: null, averageKg: null }, 76, 'lose', [])).toEqual({
      kind: 'hidden',
    });
  });
});
