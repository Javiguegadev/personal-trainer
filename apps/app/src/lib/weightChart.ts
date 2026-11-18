import { addDays, daysBetween, type WeightPoint } from '@pt/core';

export interface ChartBox {
  width: number;
  height: number;
  /** Space for the axis labels. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlottedPoint extends WeightPoint {
  x: number;
  y: number;
}

export interface WeightChartModel {
  from: string;
  points: PlottedPoint[];
  average: PlottedPoint[];
  /** Three gridlines: top, middle and bottom of the plot, with their weight in kg. */
  ticks: { y: number; kg: number }[];
  /** Lowest and highest entry in the range (for the text alternative). */
  minKg: number;
  maxKg: number;
}

/** At least this span of weight on the axis, so normal daily swings do not look dramatic. */
const MIN_SPAN_KG = 2;

/**
 * Positions of the entries and the 7-day average of the last `days` days (spec 003 AC14). Null when the
 * range has no entries.
 */
export function weightChartModel(input: {
  entries: readonly WeightPoint[];
  average: readonly WeightPoint[];
  today: string;
  days: number;
  box: ChartBox;
}): WeightChartModel | null {
  const { today, days, box } = input;
  const from = addDays(today, -(days - 1));
  const inRange = (p: WeightPoint) => p.localDate >= from && p.localDate <= today;
  const entries = input.entries.filter(inRange);
  if (entries.length === 0) return null;
  const average = input.average.filter(inRange);

  const values = [...entries, ...average].map((p) => p.weightKg);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const middle = (low + high) / 2;
  const half = Math.max(high - low, MIN_SPAN_KG) / 2 + 0.25;
  const [minAxis, maxAxis] = [middle - half, middle + half];

  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const x = (localDate: string) =>
    box.left + (daysBetween(from, localDate) / Math.max(days - 1, 1)) * plotWidth;
  const y = (kg: number) => box.top + ((maxAxis - kg) / (maxAxis - minAxis)) * plotHeight;
  const plot = (p: WeightPoint): PlottedPoint => ({ ...p, x: x(p.localDate), y: y(p.weightKg) });

  const entryValues = entries.map((p) => p.weightKg);
  return {
    from,
    points: entries.map(plot),
    average: average.map(plot),
    ticks: [maxAxis, middle, minAxis].map((kg) => ({ y: y(kg), kg })),
    minKg: Math.min(...entryValues),
    maxKg: Math.max(...entryValues),
  };
}

/** The point closest to a tap at `x`. */
export function nearestPoint<T extends { x: number }>(points: readonly T[], x: number): T | null {
  let best: T | null = null;
  for (const point of points) {
    if (!best || Math.abs(point.x - x) < Math.abs(best.x - x)) best = point;
  }
  return best;
}
