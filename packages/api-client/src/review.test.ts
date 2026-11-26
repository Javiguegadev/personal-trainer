import type { DailyCheckin, MeResponse, ReviewResponse, WeeklyReview } from '@pt/contracts';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ApiError, isApiError } from './client';
import { checkinKeys } from './checkins';
import { meKey } from './keys';
import {
  afterCheckinsDeleted,
  calibrationTargetsChange,
  decideReviewMutationOptions,
  deleteAllCheckinsMutationOptions,
  dismissCalibrationNotice,
  resetCalibrationMutationOptions,
  reviewKeys,
  reviewQueryOptions,
  withDecidedReview,
  type CalibrationTargetsChange,
  type DecideReviewVariables,
} from './review';
import { FIRST_REVIEW, REVIEWED_WEEK, reviewHistory } from './test/review-history';

const review = (weekStart: string, status: WeeklyReview['status'] = 'proposed'): WeeklyReview => ({
  weekStart,
  status,
  summary: {
    daysLogged: 7,
    foodDays: 7,
    averageKcal: 2200,
    targetKcal: 2200,
    weightAverageKg: 60,
    weightRateKgPerWeek: 0,
    weightRatePerWeek: 0,
    workouts: 0,
    workoutMinutes: 0,
    checkinDays: 0,
    poorSleepDays: 0,
    highStressDays: 0,
  },
  proposal: status === 'no_change' ? null : { kcalDelta: -100, fromKcal: 2200, toKcal: 2120 },
  reasons: ['slow_loss'],
  rulesVersion: 'review-v1',
  createdAt: `${weekStart}T08:00:00.000Z`,
  decidedAt: null,
});

/** A mock backend with a proposed review, its `/me` and review cached as the screens leave them. */
async function proposed() {
  const h = reviewHistory();
  const me = await h.onboard();
  h.seedSlowLoss(me.targets!.kcal);
  const queryClient = new QueryClient();
  await queryClient.fetchQuery(reviewQueryOptions(h.api(), h.at(FIRST_REVIEW)));
  queryClient.setQueryData(meKey, await h.api().me());
  const cached = () => queryClient.getQueryData<ReviewResponse>(reviewKeys.current)!;
  const cachedMe = () => queryClient.getQueryData<MeResponse>(meKey)!;
  const notice = () =>
    queryClient.getQueryData<CalibrationTargetsChange | null>(reviewKeys.targetsChange) ?? null;
  return { h, me, queryClient, cached, cachedMe, notice };
}

const decideWith = (
  setup: Awaited<ReturnType<typeof proposed>>,
  decision: DecideReviewVariables['decision'],
) =>
  new MutationObserver(
    setup.queryClient,
    decideReviewMutationOptions(setup.h.api(), setup.queryClient),
  ).mutate({ weekStart: REVIEWED_WEEK, decision, today: FIRST_REVIEW });

describe('review query (spec 014 AC1, AC9, AC15)', () => {
  it('keeps one cached response whatever the day, the last one received', async () => {
    const { h, queryClient, cached } = await proposed();
    expect(reviewQueryOptions(h.api(), '2026-12-14').queryKey).toEqual(reviewKeys.current);
    expect(cached()).toMatchObject({
      review: { weekStart: REVIEWED_WEEK, status: 'proposed' },
      streak: { weeks: 4 },
    });
    expect(queryClient.getQueryState(reviewKeys.current)?.status).toBe('success');
  });

  it('does not retry a refusal', async () => {
    const { h } = await proposed();
    const { retry } = reviewQueryOptions(h.api(), FIRST_REVIEW);
    const refusal = new ApiError(400, 'validation_error', 'x');
    expect(typeof retry === 'function' && retry(0, refusal)).toBe(false);
    expect(typeof retry === 'function' && retry(0, new TypeError('offline'))).toBe(true);
  });
});

describe('pure helpers', () => {
  it('puts a decided review in place of its week, latest or older', () => {
    const response: ReviewResponse = {
      review: review('2026-11-30'),
      history: [review('2026-11-23', 'rejected'), review('2026-11-16', 'no_change')],
      firstReviewOn: null,
      streak: { weeks: 2, currentWeekDays: 1, hidden: false },
    };
    const accepted = { ...review('2026-11-30'), status: 'accepted' as const };
    expect(withDecidedReview(response, accepted).review).toEqual(accepted);
    expect(withDecidedReview(response, accepted).history).toEqual(response.history);
    const older = { ...review('2026-11-23'), status: 'accepted' as const };
    expect(withDecidedReview(response, older).history[0]).toEqual(older);
    expect(withDecidedReview({ ...response, review: null }, accepted).review).toBeNull();
  });

  it('gives a targets change only when the targets moved', async () => {
    const { me } = await proposed();
    const targets = me.targets!;
    expect(calibrationTargetsChange(targets, { ...targets, validFrom: FIRST_REVIEW })).toBeNull();
    const lower = { ...targets, kcal: targets.kcal - 80 };
    expect(calibrationTargetsChange(targets, lower)).toEqual({ previous: targets, current: lower });
    expect(calibrationTargetsChange(null, null)).toBeNull();
  });
});

describe('decision (spec 014 AC6, AC8, AC15)', () => {
  it('"Aplicar": the review shows as decided, Today gets the new targets and the notice', async () => {
    const setup = await proposed();
    const { queryClient, cached, cachedMe, notice, me } = setup;
    const toKcal = cached().review!.proposal!.toKcal;
    await decideWith(setup, 'accept');
    expect(cached().review).toMatchObject({ status: 'accepted' });
    expect(cachedMe().targets?.kcal).toBe(toKcal);
    expect(notice()).toMatchObject({
      previous: { kcal: me.targets!.kcal },
      current: { kcal: toKcal },
    });
    // `/me` is fetched again for the calibration in the profile ("¿Cómo se calcula?").
    expect(queryClient.getQueryState(meKey)?.isInvalidated).toBe(true);

    dismissCalibrationNotice(queryClient);
    expect(notice()).toBeNull();
  });

  it('"Ahora no": the review shows as rejected and the targets stay', async () => {
    const setup = await proposed();
    const { cached, cachedMe, notice, me } = setup;
    await decideWith(setup, 'reject');
    expect(cached().review).toMatchObject({ status: 'rejected' });
    expect(cachedMe().targets).toEqual(me.targets);
    expect(notice()).toBeNull();
  });

  it('a 409 fetches the review and /me again, and is not retried', async () => {
    const setup = await proposed();
    await setup.h.api().decideReview(REVIEWED_WEEK, { decision: 'reject', today: FIRST_REVIEW });
    const error = await decideWith(setup, 'accept').catch((e: unknown) => e);
    expect(isApiError(error, 'review_decided')).toBe(true);
    expect(setup.queryClient.getQueryState(reviewKeys.current)?.isInvalidated).toBe(true);
    expect(setup.queryClient.getQueryState(meKey)?.isInvalidated).toBe(true);
  });

  it('needs a connection: never paused, never retried', async () => {
    const { h, queryClient } = await proposed();
    for (const options of [
      decideReviewMutationOptions(h.api(), queryClient),
      resetCalibrationMutationOptions(h.api(), queryClient),
      deleteAllCheckinsMutationOptions(h.api(), queryClient),
    ]) {
      expect(options).toMatchObject({ networkMode: 'always', retry: false });
    }
  });
});

describe('"Volver al cálculo inicial" and "Borrar mis check-ins" (spec 014 AC12)', () => {
  it('the reset brings the first targets back and shows the change', async () => {
    const setup = await proposed();
    await decideWith(setup, 'accept');
    const { h, queryClient, cachedMe, notice, me } = setup;
    const lowered = cachedMe().targets!;
    await new MutationObserver(
      queryClient,
      resetCalibrationMutationOptions(h.api(), queryClient),
    ).mutate(FIRST_REVIEW);
    expect(cachedMe().targets?.kcal).toBe(me.targets!.kcal);
    expect(notice()).toMatchObject({
      previous: { kcal: lowered.kcal },
      current: { kcal: me.targets!.kcal },
    });
  });

  it('deleting every check-in empties the cached list at once', async () => {
    const queryClient = new QueryClient();
    const checkin: DailyCheckin = {
      localDate: '2026-12-06',
      sleepMinutes: 420,
      stress: 'normal',
      workShift: null,
      shiftStartMinute: null,
      shiftEndMinute: null,
      source: 'manual',
      recordedAt: '2026-12-06T08:00:00.000Z',
    };
    queryClient.setQueryData(checkinKeys.list, [checkin]);
    await afterCheckinsDeleted(queryClient);
    expect(queryClient.getQueryData(checkinKeys.list)).toEqual([]);
  });

  it('deletes them on the server too', async () => {
    const { h, queryClient } = await proposed();
    await h.api().saveCheckin('2026-12-06', {
      sleepMinutes: 420,
      stress: 'normal',
      workShift: null,
      shiftStartMinute: null,
      shiftEndMinute: null,
      recordedAt: `${FIRST_REVIEW}T08:00:00.000Z`,
      today: FIRST_REVIEW,
    });
    await new MutationObserver(
      queryClient,
      deleteAllCheckinsMutationOptions(h.api(), queryClient),
    ).mutate();
    const { checkins } = await h.api().listCheckins({ from: '2026-12-01', to: FIRST_REVIEW });
    expect(checkins).toEqual([]);
  });
});
