import type { Profile } from '@pt/contracts';
import { describe, expect, it } from 'vitest';
import {
  SESSION_MINUTES_OPTIONS,
  canAddPlannedActivity,
  convertFormUnits,
  emptyProfileForm,
  formErrorFromApi,
  newPlannedActivity,
  parseProfileForm,
  profileFormFromProfile,
  splitList,
  type ProfileFormValues,
} from './form';

const TODAY = '2026-11-11';

const filled = (overrides: Partial<ProfileFormValues> = {}): ProfileFormValues => ({
  ...emptyProfileForm('metric'),
  sex: 'female',
  birthDay: '1',
  birthMonth: '5',
  birthYear: '1990',
  heightCm: '168',
  weight: '64,5',
  jobActivity: 'sedentary',
  goal: 'lose',
  dietType: 'omnivore',
  ...overrides,
});

describe('parseProfileForm', () => {
  it('builds a metric ProfileInput, accepting a decimal comma (AC9, AC11)', () => {
    const result = parseProfileForm(
      filled({ allergies: 'cacahuetes, gluten;  ', injuries: '  rodilla  ' }),
      TODAY,
      'es',
    );
    expect(result).toEqual({
      ok: true,
      input: {
        sex: 'female',
        birthDate: '1990-05-01',
        heightCm: 168,
        weightKg: 64.5,
        targetWeightKg: null,
        jobActivity: 'sedentary',
        plannedActivities: [],
        goal: 'lose',
        injuries: 'rodilla',
        healthFlags: [],
        units: 'metric',
        locale: 'es',
        dietaryPrefs: {
          dietType: 'omnivore',
          allergies: ['cacahuetes', 'gluten'],
          dislikes: [],
          restrictions: [],
        },
        today: TODAY,
      },
    });
  });

  it('converts imperial values with @pt/core units (AC9)', () => {
    const result = parseProfileForm(
      filled({
        units: 'imperial',
        heightCm: '',
        heightFt: '5',
        heightIn: '10',
        weight: '180',
        targetWeight: '165',
      }),
      TODAY,
      'en',
    );
    expect(result.ok && result.input).toMatchObject({
      heightCm: 177.8,
      weightKg: 81.6,
      targetWeightKg: 74.8,
    });
  });

  it('reports every missing required field', () => {
    const result = parseProfileForm(emptyProfileForm('metric'), TODAY, 'es');
    expect(result).toEqual({
      ok: false,
      errors: {
        sex: 'required',
        birthDate: 'required',
        height: 'required',
        weight: 'required',
        jobActivity: 'required',
        goal: 'required',
        dietType: 'required',
      },
    });
  });

  it('rejects implausible values (AC22)', () => {
    const result = parseProfileForm(
      filled({
        heightCm: '250',
        weight: '25',
        targetWeight: 'abc',
        birthDay: '31',
        birthMonth: '2',
      }),
      TODAY,
      'es',
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        height: 'too_big',
        weight: 'too_small',
        targetWeight: 'invalid_number',
        birthDate: 'invalid_date',
      },
    });
  });

  it('rejects a birth date in the future (AC22)', () => {
    const result = parseProfileForm(
      filled({ birthDay: '12', birthMonth: '11', birthYear: '2026' }),
      TODAY,
      'es',
    );
    expect(result).toEqual({ ok: false, errors: { birthDate: 'in_future' } });
  });

  it('rejects inches of 12 or more', () => {
    const result = parseProfileForm(
      filled({ units: 'imperial', heightCm: '', heightFt: '5', heightIn: '12', weight: '150' }),
      TODAY,
      'en',
    );
    expect(result).toEqual({ ok: false, errors: { height: 'invalid_number' } });
  });

  it('keeps chat-only flags and adds pregnancy from the checkbox (AC19, AC20)', () => {
    const result = parseProfileForm(
      filled({ pregnancy: true, otherHealthFlags: ['ed_soft_stop', 'pregnancy'] }),
      TODAY,
      'es',
    );
    expect(result.ok && result.input.healthFlags).toEqual(['pregnancy', 'ed_soft_stop']);
  });
});

describe('profileFormFromProfile', () => {
  it('prefills Settings with the requested goal and reported flags only (AC16)', () => {
    const profile: Profile = {
      sex: 'female',
      birthDate: '1990-05-01',
      heightCm: 165,
      weightKg: 62,
      targetWeightKg: null,
      jobActivity: 'standing',
      plannedActivities: [
        {
          kind: 'sport',
          label: 'fútbol',
          sessionsPerWeek: 2,
          minutesPerSession: 90,
          intensity: 'hard',
        },
        {
          kind: 'strength',
          label: null,
          sessionsPerWeek: 3,
          minutesPerSession: 60,
          intensity: 'moderate',
        },
      ],
      requestedGoal: 'lose',
      goal: 'maintain',
      safetyFlags: ['ed_soft_stop', 'calorie_floor', 'injury'],
      injuries: 'espalda',
      units: 'metric',
      locale: 'es',
      onboardingCompletedAt: '2026-11-11T10:00:00.000Z',
    };
    expect(profileFormFromProfile(profile, null, 'es')).toMatchObject({
      goal: 'lose',
      injuries: 'espalda',
      otherHealthFlags: ['ed_soft_stop'],
      dietType: null,
    });
  });
});

describe('job and weekly training (spec 002 AC1–AC4)', () => {
  const gym = newPlannedActivity();

  it('adds a strength activity of 3 × 60 min at moderate intensity by default (AC2)', () => {
    expect(gym).toEqual({
      kind: 'strength',
      label: '',
      sessionsPerWeek: 3,
      minutesPerSession: 60,
      intensity: 'moderate',
    });
    expect(SESSION_MINUTES_OPTIONS).toContain(gym.minutesPerSession);
  });

  it('requires a job option (AC1)', () => {
    const result = parseProfileForm(filled({ jobActivity: null }), TODAY, 'es');
    expect(result).toEqual({ ok: false, errors: { jobActivity: 'required' } });
  });

  it('is valid without training (AC3)', () => {
    const result = parseProfileForm(filled(), TODAY, 'es');
    expect(result.ok && result.input.plannedActivities).toEqual([]);
  });

  it('builds the training list, with an optional trimmed name (AC2)', () => {
    const result = parseProfileForm(
      filled({
        plannedActivities: [
          gym,
          { ...gym, kind: 'sport', label: '  fútbol ', sessionsPerWeek: 2, minutesPerSession: 90 },
        ],
      }),
      TODAY,
      'es',
    );
    expect(result.ok && result.input.plannedActivities).toEqual([
      {
        kind: 'strength',
        label: null,
        sessionsPerWeek: 3,
        minutesPerSession: 60,
        intensity: 'moderate',
      },
      {
        kind: 'sport',
        label: 'fútbol',
        sessionsPerWeek: 2,
        minutesPerSession: 90,
        intensity: 'moderate',
      },
    ]);
  });

  it.each([
    ['0 sessions', { sessionsPerWeek: 0 }, 'too_small'],
    ['15 sessions', { sessionsPerWeek: 15 }, 'too_big'],
    ['5 minutes', { minutesPerSession: 5 }, 'too_small'],
    ['241 minutes', { minutesPerSession: 241 }, 'too_big'],
    ['a name of 41 characters', { label: 'x'.repeat(41) }, 'too_long'],
  ] as const)('rejects %s (AC4)', (_name, override, code) => {
    const result = parseProfileForm(
      filled({ plannedActivities: [{ ...gym, ...override }] }),
      TODAY,
      'es',
    );
    expect(result).toEqual({ ok: false, errors: { plannedActivities: code } });
  });

  it('rejects more than 1200 minutes per week in total (AC4)', () => {
    const long = { ...gym, sessionsPerWeek: 5, minutesPerSession: 240 };
    expect(parseProfileForm(filled({ plannedActivities: [long] }), TODAY, 'es').ok).toBe(true);
    expect(parseProfileForm(filled({ plannedActivities: [long, gym] }), TODAY, 'es')).toEqual({
      ok: false,
      errors: { plannedActivities: 'too_big' },
    });
  });

  it('allows up to 6 activities (AC2)', () => {
    const one = { ...gym, sessionsPerWeek: 1 };
    const five = filled({ plannedActivities: Array.from({ length: 5 }, () => one) });
    const six = filled({ plannedActivities: Array.from({ length: 6 }, () => one) });
    expect(canAddPlannedActivity(five)).toBe(true);
    expect(canAddPlannedActivity(six)).toBe(false);
    expect(parseProfileForm(six, TODAY, 'es').ok).toBe(true);
    expect(
      parseProfileForm(
        filled({ plannedActivities: Array.from({ length: 7 }, () => one) }),
        TODAY,
        'es',
      ),
    ).toEqual({ ok: false, errors: { plannedActivities: 'too_big' } });
  });

  it('maps API errors on the job and the training list to their form fields (AC4)', () => {
    expect(formErrorFromApi('jobActivity', 'invalid_value')).toEqual({
      field: 'jobActivity',
      code: 'invalid',
    });
    expect(formErrorFromApi('plannedActivities', 'too_big')).toEqual({
      field: 'plannedActivities',
      code: 'too_big',
    });
    expect(formErrorFromApi('plannedActivities.0.sessionsPerWeek', 'too_big')).toEqual({
      field: 'plannedActivities',
      code: 'too_big',
    });
  });
});

describe('convertFormUnits', () => {
  it('converts typed height and weights both ways (AC9)', () => {
    const metric = filled({ heightCm: '177,8', weight: '81,6', targetWeight: '75' });
    const imperial = convertFormUnits(metric, 'imperial', 'es');
    expect(imperial).toMatchObject({
      units: 'imperial',
      heightFt: '5',
      heightIn: '10',
      weight: '180',
      targetWeight: '165',
    });

    const back = convertFormUnits(imperial, 'metric', 'es');
    expect(back).toMatchObject({
      units: 'metric',
      heightCm: '177,8',
      weight: '81,6',
      targetWeight: '74,8',
    });
  });

  it('clears values that cannot be converted, and is a no-op for the same unit', () => {
    const values = filled({ weight: 'mucho' });
    expect(convertFormUnits(values, 'imperial', 'es').weight).toBe('');
    expect(convertFormUnits(values, 'metric', 'es')).toBe(values);
  });
});

describe('helpers', () => {
  it('splits lists on commas, semicolons and new lines', () => {
    expect(splitList('a, b;c\n d ,, ')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('maps API field errors to form fields (AC22)', () => {
    expect(formErrorFromApi('heightCm', 'too_big')).toEqual({ field: 'height', code: 'too_big' });
    expect(formErrorFromApi('dietaryPrefs.allergies.3', 'too_big')).toEqual({
      field: 'allergies',
      code: 'too_big',
    });
    expect(formErrorFromApi('birthDate', 'in_future')).toEqual({
      field: 'birthDate',
      code: 'in_future',
    });
    expect(formErrorFromApi('sex', 'invalid_value')).toEqual({ field: 'sex', code: 'invalid' });
    expect(formErrorFromApi('today', 'implausible')).toBeNull();
  });
});
