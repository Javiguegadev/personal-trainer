import { describe, expect, it } from 'vitest';
import { progressChartModel } from './progressChart';

const box = { width: 300, height: 200, left: 40, right: 10, top: 10, bottom: 20 };

describe('progressChartModel', () => {
  it('needs two sessions', () => {
    expect(progressChartModel([{ localDate: '2026-11-01', value: 80 }], box)).toBeNull();
  });

  it('places sessions on a time axis, oldest at the left and highest at the top', () => {
    const model = progressChartModel(
      [
        { localDate: '2026-11-11', value: 85 },
        { localDate: '2026-11-01', value: 80 },
        { localDate: '2026-11-06', value: 82.5 },
      ],
      box,
    )!;
    expect(model.points.map((p) => p.localDate)).toEqual([
      '2026-11-01',
      '2026-11-06',
      '2026-11-11',
    ]);
    expect(model.points[0]!.x).toBe(40);
    expect(model.points[2]!.x).toBe(290);
    expect(model.points[1]!.x).toBe(165);
    expect(model.points[2]!.y).toBeLessThan(model.points[0]!.y);
    expect([model.min, model.max]).toEqual([80, 85]);
  });

  it('keeps a minimum span with round axis ends, so small changes stay small', () => {
    const model = progressChartModel(
      [
        { localDate: '2026-11-01', value: 80 },
        { localDate: '2026-11-08', value: 82.5 },
      ],
      box,
    )!;
    expect(model.ticks.map((tick) => tick.value)).toEqual([90, 82.5, 75]);
  });
});
