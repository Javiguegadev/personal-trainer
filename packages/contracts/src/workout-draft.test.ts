import { describe, expect, it } from 'vitest';
import {
  WORKOUT_DRAFT_LIMITS,
  WorkoutDraftResponseSchema,
  WorkoutReadingSchema,
  WorkoutTextDraftRequestSchema,
  type WorkoutDraft,
} from './workout-draft';

const request = { text: 'press banca 4x8 con 60', today: '2026-11-24', localDate: '2026-11-24' };

describe('WorkoutTextDraftRequestSchema (spec 012 AC2)', () => {
  it('accepts a sentence and defaults the locale to es', () => {
    expect(WorkoutTextDraftRequestSchema.parse(request)).toEqual({ ...request, locale: 'es' });
  });

  it('trims the text and keeps it within 3–500 characters', () => {
    expect(WorkoutTextDraftRequestSchema.parse({ ...request, text: '  remo 3x10  ' }).text).toBe(
      'remo 3x10',
    );
    expect(WorkoutTextDraftRequestSchema.safeParse({ ...request, text: ' ab ' }).success).toBe(
      false,
    );
    const long = 'x'.repeat(WORKOUT_DRAFT_LIMITS.textMax + 1);
    expect(WorkoutTextDraftRequestSchema.safeParse({ ...request, text: long }).success).toBe(false);
  });

  it('needs the dates', () => {
    expect(WorkoutTextDraftRequestSchema.safeParse({ text: request.text }).success).toBe(false);
  });
});

describe('WorkoutReadingSchema (the model output)', () => {
  it('accepts out-of-range numbers: core clamps them (AC8)', () => {
    const reading = {
      status: 'ok',
      gym: {
        exercises: [
          {
            mention: 'sentadilla 3x10 con 600',
            exerciseRef: 'e12',
            setGroups: [
              {
                count: 3,
                reps: 10,
                weight: 600,
                weightUnit: 'kg',
                durationS: null,
                distanceM: null,
              },
            ],
          },
        ],
        minutes: null,
        sessionRpe: 14,
      },
      activities: [],
      daysAgo: 1,
      startTime: null,
      painMentioned: false,
    };
    expect(WorkoutReadingSchema.parse(reading)).toEqual(reading);
  });
});

describe('WorkoutDraftResponseSchema', () => {
  const draft: WorkoutDraft = {
    localDate: '2026-11-23',
    startTime: '19:00',
    dayDropped: false,
    minutes: 60,
    sessionRpe: 8,
    exercises: [],
    unresolved: [{ mention: 'press Larsen 3x8', sets: [], position: 0 }],
    activity: null,
    extraActivities: [],
    painMentioned: false,
    ignored: 0,
  };

  it('accepts a draft and an unreadable answer', () => {
    expect(WorkoutDraftResponseSchema.parse({ status: 'ok', draft })).toEqual({
      status: 'ok',
      draft,
    });
    expect(
      WorkoutDraftResponseSchema.parse({ status: 'unreadable', reason: 'not_workout' }),
    ).toEqual({ status: 'unreadable', reason: 'not_workout' });
  });

  it('rejects a start time that is not HH:MM', () => {
    const bad = { status: 'ok', draft: { ...draft, startTime: '7pm' } };
    expect(WorkoutDraftResponseSchema.safeParse(bad).success).toBe(false);
    const late = { status: 'ok', draft: { ...draft, startTime: '24:00' } };
    expect(WorkoutDraftResponseSchema.safeParse(late).success).toBe(false);
  });
});
