import {
  ApiErrorSchema,
  CalibrationResetResponseSchema,
  CONSENT_VERSION,
  ExportResponseSchema,
  MeResponseSchema,
  ReviewDecisionResponseSchema,
  ReviewResponseSchema,
  type MealItem,
} from '@pt/contracts';
import { addDays } from '@pt/core';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_ID, createTestApp, profileInput } from '../../test/fakes';

/**
 * The weekly review routes (spec 014). The profile is saved on Wednesday 11 November 2026 (the fakes'
 * clock), so the first review is on Monday 7 December (21 days later, then the next Monday): it reviews
 * the week of Monday 30 November.
 */
type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

const FIRST_REVIEW = '2026-12-07';
const WEEK = '2026-11-30';

const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json());
const consent = () =>
  t.call('POST', '/me/consent', { kind: 'health_data', version: CONSENT_VERSION });

async function withProfile() {
  await consent();
  const res = await t.call('PUT', '/me/profile', profileInput());
  expect(res.status).toBe(200);
  return MeResponseSchema.parse(await res.json());
}

/** The server clock and the app's day on `day`. */
const at = (day: string) => {
  t.clock.now = new Date(`${day}T10:00:00Z`);
  return day;
};

const meal = (localDate: string, kcal: number): MealItem & { deleted: boolean } => ({
  id: randomUUID(),
  localDate,
  mealType: 'lunch',
  foodId: null,
  servingId: null,
  servings: null,
  servingLabel: null,
  grams: null,
  unit: 'g',
  label: 'Menú',
  nutrients: { kcal, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null },
  inputMethod: 'quick_add',
  plannedItemId: null,
  recordedAt: `${localDate}T12:00:00.000Z`,
  deleted: false,
});

/** Four weeks before the first review: a flat weight while eating at the target (a slow loss). */
function seedSlowLoss(targetKcal: number) {
  const rows = t.store.rows(USER_ID);
  const days = Array.from({ length: 28 }, (_, i) => addDays('2026-11-09', i));
  rows.weights = days.map((localDate) => ({
    localDate,
    weightKg: 70,
    recordedAt: `${localDate}T07:00:00.000Z`,
  }));
  rows.mealItems = days.map((day) => meal(day, targetKcal));
}

async function getReview(today: string) {
  const res = await t.call('GET', `/me/review?today=${today}`);
  expect(res.status).toBe(200);
  return ReviewResponseSchema.parse(await res.json());
}

const decide = (weekStart: string, decision: 'accept' | 'reject', today = FIRST_REVIEW) =>
  t.call('POST', `/me/review/${weekStart}/decision`, { decision, today });

describe('auth and consent (spec 014)', () => {
  it.each([
    ['GET', `/me/review?today=${FIRST_REVIEW}`],
    ['POST', `/me/review/${WEEK}/decision`],
    ['DELETE', `/me/energy-calibration?today=${FIRST_REVIEW}`],
    ['DELETE', '/me/checkins'],
  ])('%s %s answers 401 without a token and 403 without consent', async (method, path) => {
    const body = method === 'POST' ? { decision: 'accept', today: FIRST_REVIEW } : undefined;
    expect((await t.call(method, path, body, null)).status).toBe(401);
    const res = await t.call(method, path, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('consent_required');
  });
});

describe('GET /me/review (spec 014 AC1, AC2, AC9)', () => {
  it('names the Monday of the first review before 21 days', async () => {
    await withProfile();
    const body = await getReview(at('2026-11-25'));
    expect(body.review).toBeNull();
    expect(body.firstReviewOn).toBe(FIRST_REVIEW);
  });

  it('computes the review of the last complete week once and stores it with its numbers', async () => {
    const me = await withProfile();
    seedSlowLoss(me.targets!.kcal);
    const first = await getReview(at(FIRST_REVIEW));
    expect(first.review).toMatchObject({
      weekStart: WEEK,
      status: 'proposed',
      reasons: ['slow_loss'],
      proposal: { kcalDelta: -100, fromKcal: me.targets!.kcal },
    });
    expect(first.review!.summary).toMatchObject({ foodDays: 7, averageKcal: me.targets!.kcal });
    // A second read gives the stored review, not a new one.
    const again = await getReview(at('2026-12-09'));
    expect(again.review).toEqual(first.review);
  });

  it('counts the streak of weeks with 4 logged days', async () => {
    const me = await withProfile();
    seedSlowLoss(me.targets!.kcal);
    const body = await getReview(at(FIRST_REVIEW));
    // Four full weeks of logs (9 November to 6 December), and today (Monday 7) has none yet.
    expect(body.streak).toEqual({ weeks: 4, currentWeekDays: 0, hidden: false });
  });

  it('gives no review and no streak with an eating-disorder signal', async () => {
    const me = await withProfile();
    seedSlowLoss(me.targets!.kcal);
    t.store.rows(USER_ID).profile!.safetyFlags.push('ed_soft_stop');
    const body = await getReview(at(FIRST_REVIEW));
    expect(body.review).toBeNull();
    expect(body.firstReviewOn).toBeNull();
    expect(body.streak.hidden).toBe(true);
  });

  it('refuses a local date far from the server date', async () => {
    await withProfile();
    at(FIRST_REVIEW);
    const res = await t.call('GET', '/me/review?today=2026-12-20');
    expect(res.status).toBe(400);
  });
});

describe('POST /me/review/{weekStart}/decision (spec 014 AC6, AC8)', () => {
  async function proposed() {
    const me = await withProfile();
    seedSlowLoss(me.targets!.kcal);
    const { review } = await getReview(at(FIRST_REVIEW));
    return { me, review: review! };
  }

  it('"Aplicar" changes the calibration and the targets, once', async () => {
    const { me, review } = await proposed();
    const res = await decide(WEEK, 'accept');
    expect(res.status).toBe(200);
    const body = ReviewDecisionResponseSchema.parse(await res.json());
    expect(body.review.status).toBe('accepted');
    expect(body.targets?.kcal).toBe(review.proposal!.toKcal);
    expect(body.targets?.kcal).toBeLessThan(me.targets!.kcal);
    expect(t.store.rows(USER_ID).profile?.energyCalibrationKcal).toBe(-100);
    // The old targets row is kept in the history.
    expect(t.store.rows(USER_ID).targets.filter((row) => row.validTo === null)).toHaveLength(1);

    const again = await decide(WEEK, 'accept');
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('review_decided');
  });

  it('"Ahora no" stores the rejection and changes nothing', async () => {
    const { me } = await proposed();
    const res = await decide(WEEK, 'reject');
    const body = ReviewDecisionResponseSchema.parse(await res.json());
    expect(body.review.status).toBe('rejected');
    expect(body.targets?.kcal).toBe(me.targets!.kcal);
    expect(t.store.rows(USER_ID).profile?.energyCalibrationKcal).toBe(0);
  });

  it('keeps the calibration through a profile save (AC8)', async () => {
    const { review } = await proposed();
    await decide(WEEK, 'accept');
    const res = await t.call('PUT', '/me/profile', profileInput({ today: at('2026-12-08') }));
    const me = MeResponseSchema.parse(await res.json());
    expect(me.profile?.energyCalibrationKcal).toBe(-100);
    expect(me.targets?.kcal).toBe(review.proposal!.toKcal);
  });

  it('refuses a review that a newer one replaced (409 review_stale)', async () => {
    await proposed();
    // A week later the review of the week of 7 December is the latest.
    await getReview(at('2026-12-14'));
    const res = await decide(WEEK, 'accept', '2026-12-14');
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('review_stale');
  });

  it('answers 404 for a week without a review and 400 for a day that is not a Monday', async () => {
    await proposed();
    expect((await decide('2026-11-23', 'accept')).status).toBe(404);
    expect((await decide('2026-12-01', 'accept')).status).toBe(400);
  });
});

describe('"Lo que sé de ti" writes (spec 014 AC12)', () => {
  it('"Volver al cálculo inicial" sets the calibration to 0 and recomputes the targets', async () => {
    const me = await withProfile();
    seedSlowLoss(me.targets!.kcal);
    await getReview(at(FIRST_REVIEW));
    await decide(WEEK, 'accept');
    const res = await t.call('DELETE', `/me/energy-calibration?today=${FIRST_REVIEW}`);
    expect(res.status).toBe(200);
    const body = CalibrationResetResponseSchema.parse(await res.json());
    expect(body.targets?.kcal).toBe(me.targets!.kcal);
    expect(t.store.rows(USER_ID).profile?.energyCalibrationKcal).toBe(0);
  });

  it('"Borrar mis check-ins" deletes every check-in', async () => {
    await withProfile();
    for (const localDate of ['2026-11-09', '2026-11-10']) {
      await t.call('PUT', `/me/checkins/${localDate}`, {
        sleepMinutes: 420,
        stress: 'normal',
        workShift: null,
        shiftStartMinute: null,
        shiftEndMinute: null,
        recordedAt: '2026-11-11T08:00:00.000Z',
        today: '2026-11-11',
      });
    }
    expect((await t.call('DELETE', '/me/checkins')).status).toBe(204);
    const list = await t.call('GET', '/me/checkins?from=2026-11-01&to=2026-11-11');
    expect(((await list.json()) as { checkins: unknown[] }).checkins).toEqual([]);
  });
});

describe('export (spec 014 AC16)', () => {
  it('includes the reviews with their decisions and the calibration', async () => {
    const me = await withProfile();
    seedSlowLoss(me.targets!.kcal);
    await getReview(at(FIRST_REVIEW));
    await decide(WEEK, 'accept');
    const body = ExportResponseSchema.parse(await (await t.call('GET', '/me/export')).json());
    expect(body.weeklyReviews.map((r) => [r.weekStart, r.status])).toEqual([[WEEK, 'accepted']]);
    expect(body.profile?.energyCalibrationKcal).toBe(-100);
  });
});
