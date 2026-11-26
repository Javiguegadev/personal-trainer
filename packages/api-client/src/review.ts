/**
 * The weekly review and the logging streak (spec 014): one cached response for Today, Progress and the
 * review screen, kept offline so the last review and streak still show without a connection (AC15).
 * The decision, "Volver al cálculo inicial" and "Borrar mis check-ins" need a connection: they are
 * never paused, queued or retried (the screens disable them offline), and they update `/me` like
 * "Mi semana".
 */
import type {
  CalibrationResetResponse,
  MeResponse,
  ReviewDecisionResponse,
  ReviewResponse,
  StoredTargets,
  WeeklyReview,
} from '@pt/contracts';
import { sameTargets, targetsOnly } from '@pt/core';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { isApiError, type ApiClient } from './client';
import { checkinKeys } from './checkins';
import { meKey } from './keys';
import { isRejected } from './weights';

export const reviewKeys = {
  /** The latest review, the ones before it and the streak (`GET /me/review`). */
  current: ['review'] as const,
  /** The targets change of the last "Aplicar" or "Volver al cálculo inicial", until dismissed. */
  targetsChange: ['review-targets-change'] as const,
};

/** What a decision sends: the reviewed week, the choice and the user's local date. */
export interface DecideReviewVariables {
  weekStart: string;
  decision: 'accept' | 'reject';
  today: string;
}

/** The old and new targets after a calibration change (the notice of spec 003, ADR 005). */
export interface CalibrationTargetsChange {
  previous: StoredTargets | null;
  current: StoredTargets | null;
}

export function reviewQueryOptions(api: ApiClient, today: string) {
  return queryOptions({
    // One entry whatever the day: offline, the last review received is the one shown (AC15).
    queryKey: reviewKeys.current,
    queryFn: () => api.getReview({ today }),
    retry: (failureCount: number, error: unknown) => !isRejected(error) && failureCount < 2,
  });
}

/** The response with `decided` in place of the stored review of its week (the latest or an older one). */
export function withDecidedReview(response: ReviewResponse, decided: WeeklyReview): ReviewResponse {
  const replace = (review: WeeklyReview) =>
    review.weekStart === decided.weekStart ? decided : review;
  return {
    ...response,
    review: response.review && replace(response.review),
    history: response.history.map(replace),
  };
}

/** The old and new targets, or null when the change left them as they were. */
export function calibrationTargetsChange(
  previous: StoredTargets | null,
  current: StoredTargets | null,
): CalibrationTargetsChange | null {
  return sameTargets(previous && targetsOnly(previous), current && targetsOnly(current))
    ? null
    : { previous, current };
}

/**
 * After a calibration change ("Aplicar", "Volver al cálculo inicial"): the new targets show at once,
 * the change is kept for Today's notice (AC6), and `/me` is fetched again for the profile's calibration
 * ("¿Cómo se calcula?", AC8) and the goal and flags evaluated with it.
 */
export async function afterCalibrationChange(
  queryClient: QueryClient,
  targets: StoredTargets | null,
): Promise<void> {
  const previous = queryClient.getQueryData<MeResponse>(meKey)?.targets ?? null;
  queryClient.setQueryData<MeResponse>(meKey, (me) => me && { ...me, targets });
  queryClient.setQueryData(reviewKeys.targetsChange, calibrationTargetsChange(previous, targets));
  await queryClient.invalidateQueries({ queryKey: meKey });
}

/** After a decision (AC6): the review shows as decided; "Aplicar" also changes the targets. */
export async function afterReviewDecision(
  queryClient: QueryClient,
  response: ReviewDecisionResponse,
): Promise<void> {
  queryClient.setQueryData<ReviewResponse>(
    reviewKeys.current,
    (cached) => cached && withDecidedReview(cached, response.review),
  );
  if (response.review.status === 'accepted') {
    await afterCalibrationChange(queryClient, response.targets);
  }
}

/**
 * After a 409 (`review_decided` on another device, `review_stale` after a newer week or a change that
 * no longer holds): the review and `/me` are fetched again, so the screen shows what the server holds.
 */
export async function afterReviewConflict(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: reviewKeys.current }),
    queryClient.invalidateQueries({ queryKey: meKey }),
  ]);
}

/** After "Borrar mis check-ins" (AC12): none is left on the device either. */
export async function afterCheckinsDeleted(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: checkinKeys.list });
  queryClient.setQueryData(checkinKeys.list, []);
  await queryClient.invalidateQueries({ queryKey: checkinKeys.list });
}

/**
 * The three writes need a connection (AC15): never paused and replayed later (`networkMode: 'always'`),
 * never retried; the screens disable them offline and keep the user's choice on an error.
 */
const online = { networkMode: 'always', retry: false } as const;

/** "Aplicar" or "Ahora no" (AC6). A 409 fetches the review and `/me` again. */
export function decideReviewMutationOptions(api: ApiClient, queryClient: QueryClient) {
  return {
    ...online,
    mutationFn: ({ weekStart, ...body }: DecideReviewVariables) =>
      api.decideReview(weekStart, body),
    onSuccess: (response: ReviewDecisionResponse) => afterReviewDecision(queryClient, response),
    onError: async (error: unknown) => {
      if (isApiError(error) && error.status === 409) await afterReviewConflict(queryClient);
    },
  };
}

/** "Volver al cálculo inicial" (AC12): the calibration back to 0, the targets computed again. */
export function resetCalibrationMutationOptions(api: ApiClient, queryClient: QueryClient) {
  return {
    ...online,
    mutationFn: (today: string) => api.resetCalibration({ today }),
    onSuccess: ({ targets }: CalibrationResetResponse) =>
      afterCalibrationChange(queryClient, targets),
  };
}

/** "Borrar mis check-ins" (AC12), after the screen's confirmation. */
export function deleteAllCheckinsMutationOptions(api: ApiClient, queryClient: QueryClient) {
  return {
    ...online,
    mutationFn: () => api.deleteAllCheckins(),
    onSuccess: () => afterCheckinsDeleted(queryClient),
  };
}

/** Removes the targets notice of a calibration change once the user has seen it. */
export function dismissCalibrationNotice(queryClient: QueryClient): void {
  queryClient.setQueryData(reviewKeys.targetsChange, null);
}
