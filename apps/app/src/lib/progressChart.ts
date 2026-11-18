import { daysBetween } from '@pt/core';
import type { ChartBox } from './weightChart';

export interface ProgressPoint {
  localDate: string;
  value: number;
}

export interface PlottedProgress extends ProgressPoint {
  x: number;
  y: number;
}

export interface ProgressChartModel {
  points: PlottedProgress[];
  /** Three gridlines (top, middle, bottom) with their value. */
  ticks: { y: number; value: number }[];
  min: number;
  max: number;
}

/** At least this span on the axis, so a 2.5 kg change does not look like a cliff. */
const MIN_SPAN = 10;
const AXIS_STEP = 5;

/**
 * Positions of the best estimated 1RM per session (spec 009 AC15), on a time axis from the first
 * session to the last. Null with fewer than two points.
 */
export function progressChartModel(
  points: readonly ProgressPoint[],
  box: ChartBox,
): ProgressChartModel | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const values = sorted.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const middle = (low + high) / 2;
  const half = Math.max(high - low, MIN_SPAN) / 2;
  // Round axis ends (multiples of 5 kg), so the gridlines read 75 / 82,5 / 90, not 128,75.
  const minAxis = Math.max(0, Math.floor((middle - half) / AXIS_STEP) * AXIS_STEP);
  const maxAxis = Math.ceil((middle + half) / AXIS_STEP) * AXIS_STEP;
  const first = sorted[0]!.localDate;
  const span = Math.max(daysBetween(first, sorted.at(-1)!.localDate), 1);
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const y = (value: number) => box.top + ((maxAxis - value) / (maxAxis - minAxis)) * plotHeight;
  return {
    points: sorted.map((p) => ({
      ...p,
      x: box.left + (daysBetween(first, p.localDate) / span) * plotWidth,
      y: y(p.value),
    })),
    ticks: [maxAxis, (maxAxis + minAxis) / 2, minAxis].map((value) => ({ y: y(value), value })),
    min: low,
    max: high,
  };
}
