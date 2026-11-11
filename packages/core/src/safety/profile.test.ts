import { describe, expect, it } from 'vitest';
import { evaluateProfileSafety, type SafetyInput } from './profile';

const TODAY = '2026-11-11';

const adult: SafetyInput = {
  birthDate: '1990-01-01',
  heightCm: 170,
  weightKg: 70,
  targetWeightKg: null,
  goal: 'lose',
  healthFlags: [],
  injuries: null,
};

describe('evaluateProfileSafety', () => {
  it('lets a healthy adult keep their goal', () => {
    expect(evaluateProfileSafety(adult, TODAY)).toEqual({
      status: 'ok',
      requestedGoal: 'lose',
      appliedGoal: 'lose',
      flags: [],
      maxSurplusRatio: null,
      targetsAllowed: true,
    });
  });

  it('AC17: blocks anyone under 16', () => {
    const r = evaluateProfileSafety({ ...adult, birthDate: '2010-11-12' }, TODAY); // 15 y
    expect(r.status).toBe('blocked');
  });

  it('AC17: a 16th birthday today is not blocked', () => {
    expect(evaluateProfileSafety({ ...adult, birthDate: '2010-11-11' }, TODAY).status).toBe(
      'teen_limited',
    );
  });

  it('AC18: 16–17 → lose becomes maintain, surplus capped at 10 %', () => {
    const r = evaluateProfileSafety({ ...adult, birthDate: '2009-06-01' }, TODAY);
    expect(r).toMatchObject({
      status: 'teen_limited',
      appliedGoal: 'maintain',
      maxSurplusRatio: 0.1,
      flags: ['teen_limited'],
    });
    const gain = evaluateProfileSafety({ ...adult, birthDate: '2009-06-01', goal: 'gain' }, TODAY);
    expect(gain.appliedGoal).toBe('gain');
    expect(gain.maxSurplusRatio).toBe(0.1);
  });

  it('18 is an adult', () => {
    expect(evaluateProfileSafety({ ...adult, birthDate: '2008-11-11' }, TODAY).status).toBe('ok');
  });

  it('AC19: BMI < 18.5 and goal lose → maintain', () => {
    // 50 / 1.70² = 17.3
    const r = evaluateProfileSafety({ ...adult, weightKg: 50 }, TODAY);
    expect(r.appliedGoal).toBe('maintain');
    expect(r.flags).toContain('low_bmi');
  });

  it('AC19: a target weight below BMI 18.5 → maintain', () => {
    // 52 / 1.70² = 17.99
    const r = evaluateProfileSafety({ ...adult, targetWeightKg: 52 }, TODAY);
    expect(r.appliedGoal).toBe('maintain');
    expect(r.flags).toContain('low_target_bmi');
  });

  it('AC19: pregnancy or breastfeeding → no deficit', () => {
    const r = evaluateProfileSafety({ ...adult, healthFlags: ['pregnancy'] }, TODAY);
    expect(r.appliedGoal).toBe('maintain');
    expect(r.flags).toContain('pregnancy');
  });

  it('AC20: an eating-disorder signal → never a deficit', () => {
    const r = evaluateProfileSafety({ ...adult, healthFlags: ['ed_soft_stop'] }, TODAY);
    expect(r.appliedGoal).toBe('maintain');
    expect(r.flags).toContain('ed_soft_stop');
  });

  it('AC21: injuries and medical conditions are flagged without changing the goal', () => {
    const r = evaluateProfileSafety(
      { ...adult, injuries: 'rodilla derecha', healthFlags: ['medical_condition'] },
      TODAY,
    );
    expect(r.appliedGoal).toBe('lose');
    expect(r.flags).toEqual(expect.arrayContaining(['injury', 'medical_condition']));
  });

  it('blank injury text is not an injury', () => {
    expect(evaluateProfileSafety({ ...adult, injuries: '   ' }, TODAY).flags).not.toContain(
      'injury',
    );
  });
});

describe('evaluateProfileSafety — ESPEN/GLIM low BMI by age', () => {
  it('under 70: BMI 19.5 → no deficit', () => {
    // 56.4 / 1.70² = 19.5
    expect(evaluateProfileSafety({ ...adult, weightKg: 56.4 }, TODAY).appliedGoal).toBe('maintain');
  });
  it('70+: BMI 21 → no deficit', () => {
    // 60.7 / 1.70² = 21.0
    const r = evaluateProfileSafety({ ...adult, birthDate: '1950-01-01', weightKg: 60.7 }, TODAY);
    expect(r.appliedGoal).toBe('maintain');
    expect(r.flags).toContain('low_bmi');
  });
  it('70+: BMI 23 keeps the goal', () => {
    // 66.5 / 1.70² = 23.0
    expect(evaluateProfileSafety({ ...adult, birthDate: '1950-01-01', weightKg: 66.5 }, TODAY).appliedGoal).toBe('lose');
  });
  it('pregnancy → no numeric targets', () => {
    expect(evaluateProfileSafety({ ...adult, healthFlags: ['pregnancy'] }, TODAY).targetsAllowed).toBe(false);
  });
});

describe('evaluateProfileSafety — sticky flags (AC20)', () => {
  it('a stored ed_soft_stop keeps blocking a deficit after a Settings edit', () => {
    const r = evaluateProfileSafety({ ...adult, previousFlags: ['ed_soft_stop'] }, TODAY);
    expect(r.appliedGoal).toBe('maintain');
    expect(r.flags).toContain('ed_soft_stop');
  });
});
