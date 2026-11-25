import {
  FEEDBACK_LIMITS,
  LABEL_SCAN_LIMITS,
  MEAL_DRAFT_LIMITS,
  WORKOUT_DRAFT_LIMITS,
} from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import { canUse, PLANS } from './entitlements';

describe('canUse and the beta plan (spec 014 AC14)', () => {
  it('keeps the daily caps the AI routes have today', () => {
    expect(PLANS.beta).toEqual({
      label_scan: LABEL_SCAN_LIMITS.perDay,
      meal_photo: MEAL_DRAFT_LIMITS.photosPerDay,
      meal_text: MEAL_DRAFT_LIMITS.textsPerDay,
      daily_feedback: FEEDBACK_LIMITS.aiPerDay,
      workout_text: WORKOUT_DRAFT_LIMITS.textsPerDay,
    });
  });

  it('allows a feature until its daily cap', () => {
    expect(canUse('beta', 'meal_text', 0)).toEqual({ allowed: true, remaining: 40, cap: 40 });
    expect(canUse('beta', 'meal_text', 39)).toEqual({ allowed: true, remaining: 1, cap: 40 });
    expect(canUse('beta', 'meal_text', 40)).toEqual({ allowed: false, remaining: 0, cap: 40 });
    expect(canUse('beta', 'label_scan', 25)).toEqual({ allowed: false, remaining: 0, cap: 20 });
  });
});
