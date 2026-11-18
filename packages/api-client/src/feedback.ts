/**
 * The daily feedback (spec 008): asked for with a tap, kept per day in the query cache (never queued
 * offline, never stored on the server). It goes stale when the day's items change (AC17): the
 * fingerprint of the items the API read no longer matches the one of the items the app shows.
 */
import type { DailyFeedbackResponse, MealItem } from '@pt/contracts';
import { feedbackFingerprint } from '@pt/core';
import type { Mutation } from '@tanstack/react-query';
import { foodKeys, type DeleteMealItemVariables, type SaveMealItemVariables } from './foods';

export const feedbackKeys = {
  /** The last feedback of one day. */
  day: (localDate: string) => ['food-feedback', localDate] as const,
};

/** The day's items changed since the feedback was asked for (AC17). */
export function feedbackIsStale(
  feedback: Pick<DailyFeedbackResponse, 'localDate' | 'fingerprint'>,
  items: readonly Pick<MealItem, 'id' | 'recordedAt' | 'localDate'>[],
): boolean {
  const day = items.filter((item) => item.localDate === feedback.localDate);
  return feedbackFingerprint(day) !== feedback.fingerprint;
}

/**
 * Whether a pending food-log write may touch `localDate` (AC3): a save of an item of that day, or a
 * delete, whose day the queue does not keep (an item already gone from the list), so it counts for
 * every day. The feedback waits until they are acknowledged.
 */
export function writeTouchesDay(
  mutation: Pick<Mutation, 'options' | 'state'>,
  localDate: string,
): boolean {
  const key = mutation.options.mutationKey;
  const variables = mutation.state.variables;
  if (!variables || !Array.isArray(key)) return false;
  if (key.join('/') === foodKeys.saveItem.join('/')) {
    return (variables as SaveMealItemVariables).request.localDate === localDate;
  }
  if (key.join('/') === foodKeys.deleteItem.join('/')) {
    return typeof (variables as DeleteMealItemVariables).id === 'string';
  }
  return false;
}
