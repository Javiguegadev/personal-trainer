import { describe, expect, it } from 'vitest';
import { nearestPoint, weightChartModel } from './weightChart';

const box = { width: 340, height: 180, left: 40, right: 0, top: 10, bottom: 20 };
const TODAY = '2026-11-13';

describe('weightChartModel', () => {
  it('places the first day of the range on the left and today on the right', () => {
    const model = weightChartModel({
      entries: [
        { localDate: '2026-10-15', weightKg: 80 },
        { localDate: '2026-11-13', weightKg: 79 },
      ],
      average: [],
      today: TODAY,
      days: 30,
      box,
    });
    expect(model?.from).toBe('2026-10-15');
    expect(model?.points.map((p) => p.x)).toEqual([40, 340]);
    // Heavier is higher (smaller y).
    expect(model!.points[0]!.y).toBeLessThan(model!.points[1]!.y);
    expect([model?.minKg, model?.maxKg]).toEqual([79, 80]);
  });

  it('keeps at least 2 kg on the axis, centred on the data', () => {
    const model = weightChartModel({
      entries: [{ localDate: TODAY, weightKg: 70 }],
      average: [],
      today: TODAY,
      days: 30,
      box,
    });
    const [top, middle, bottom] = model!.ticks;
    expect(middle!.kg).toBe(70);
    expect(top!.kg - bottom!.kg).toBeCloseTo(2.5, 10);
    expect(model!.points[0]!.y).toBeCloseTo(middle!.y, 10);
  });

  it('leaves out what is outside the range and returns null without entries in it', () => {
    const entries = [
      { localDate: '2026-01-01', weightKg: 90 },
      { localDate: '2026-11-10', weightKg: 80 },
    ];
    const model = weightChartModel({ entries, average: entries, today: TODAY, days: 30, box });
    expect(model?.points).toHaveLength(1);
    expect(model?.average).toHaveLength(1);
    expect(
      weightChartModel({ entries: [entries[0]!], average: [], today: TODAY, days: 30, box }),
    ).toBeNull();
  });
});

describe('nearestPoint', () => {
  it('picks the entry closest to the tap', () => {
    const points = [
      { localDate: 'a', weightKg: 1, x: 10, y: 0 },
      { localDate: 'b', weightKg: 2, x: 50, y: 0 },
    ];
    expect(nearestPoint(points, 35)?.localDate).toBe('b');
    expect(nearestPoint(points, 25)?.localDate).toBe('a');
    expect(nearestPoint([], 25)).toBeNull();
  });
});
