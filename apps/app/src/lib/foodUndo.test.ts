import type { MealItem } from '@pt/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOOD_UNDO_MS, clearFoodUndo, offerFoodUndo, readFoodUndo } from './foodUndo';

const item = { id: 'a', label: 'Huevo' } as MealItem;

describe('food undo (spec 005 AC11, AC13)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearFoodUndo();
    vi.useRealTimers();
  });

  it('is offered for 5 seconds', () => {
    offerFoodUndo({ kind: 'deleted', item });
    vi.advanceTimersByTime(FOOD_UNDO_MS - 1);
    expect(readFoodUndo()).toEqual({ kind: 'deleted', item });
    vi.advanceTimersByTime(1);
    expect(readFoodUndo()).toBeNull();
  });

  it('a newer change replaces the offer and restarts the 5 seconds', () => {
    offerFoodUndo({ kind: 'deleted', item });
    vi.advanceTimersByTime(4000);
    offerFoodUndo({ kind: 'repeated', items: [item] });
    vi.advanceTimersByTime(4000);
    expect(readFoodUndo()).toEqual({ kind: 'repeated', items: [item] });
    vi.advanceTimersByTime(1000);
    expect(readFoodUndo()).toBeNull();
  });

  it('is gone once used', () => {
    offerFoodUndo({ kind: 'deleted', item });
    clearFoodUndo();
    expect(readFoodUndo()).toBeNull();
  });
});
