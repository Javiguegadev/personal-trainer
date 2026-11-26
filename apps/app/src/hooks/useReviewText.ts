import type { ReviewSummary, Units, WeeklyReview } from '@pt/contracts';
import { addDays, formatNumber, formatShortDate, localToday } from '@pt/core';
import { useI18n } from './useI18n';
import { useWeightFormat } from './useWeightFormat';

/**
 * The words of the weekly review (spec 014 AC2): the week, its summary (kg or lb, kcal as stored) and
 * its outcome. Nothing in it judges the numbers: a missing part says it has no data.
 */
export function useReviewText(units: Units) {
  const { t, format, locale } = useI18n();
  const weight = useWeightFormat(units);
  const r = t.review;
  const s = r.summary;
  const n = (value: number) => formatNumber(value, locale);
  const days = (count: number) =>
    count === 1 ? s.daysOne : format(s.daysOther, { count: String(count) });
  const sessions = (count: number) =>
    count === 1 ? s.sessionsOne : format(s.sessionsOther, { count: String(count) });

  const range = (weekStart: string) =>
    format(r.range, {
      from: formatShortDate(weekStart, locale),
      to: formatShortDate(addDays(weekStart, 6), locale),
    });

  /** Every part of the summary, one line each (the review screen). */
  const lines = (summary: ReviewSummary): { key: string; text: string }[] => {
    const food =
      summary.foodDays === 0 || summary.averageKcal === null
        ? s.foodNone
        : format(summary.targetKcal === null ? s.foodNoTarget : s.food, {
            days: days(summary.foodDays),
            average: n(summary.averageKcal),
            target: summary.targetKcal === null ? '' : n(summary.targetKcal),
          });
    const body =
      summary.weightAverageKg === null
        ? s.weightNone
        : summary.weightRateKgPerWeek === null
          ? format(s.weightNoRate, { average: weight.weight(summary.weightAverageKg) })
          : format(s.weight, {
              average: weight.weight(summary.weightAverageKg),
              rate: weight.change(summary.weightRateKgPerWeek),
            });
    const training =
      summary.workouts === 0
        ? s.trainingNone
        : format(s.training, {
            sessions: sessions(summary.workouts),
            minutes: n(summary.workoutMinutes),
          });
    const checkins =
      summary.checkinDays === 0
        ? s.checkinsNone
        : format(s.checkins, {
            sleep: days(summary.poorSleepDays),
            stress: days(summary.highStressDays),
          });
    return [
      { key: 'days', text: format(s.days, { count: String(summary.daysLogged) }) },
      { key: 'food', text: food },
      { key: 'weight', text: body },
      { key: 'training', text: training },
      { key: 'checkins', text: checkins },
    ];
  };

  /** The summary in two lines (the "Tu semana" card). */
  const cardLines = (summary: ReviewSummary): [string, string] => {
    const logged = String(summary.daysLogged);
    const first =
      summary.foodDays === 0 || summary.averageKcal === null
        ? format(s.cardDays, { days: logged })
        : format(summary.targetKcal === null ? s.cardFoodNoTarget : s.cardFood, {
            days: logged,
            average: n(summary.averageKcal),
            target: summary.targetKcal === null ? '' : n(summary.targetKcal),
          });
    const parts = [
      summary.weightRateKgPerWeek === null
        ? s.cardWeightNone
        : format(s.cardWeight, { rate: weight.change(summary.weightRateKgPerWeek) }),
    ];
    if (summary.workouts > 0) {
      parts.push(
        format(s.cardTraining, {
          sessions: sessions(summary.workouts),
          minutes: n(summary.workoutMinutes),
        }),
      );
    }
    return [first, parts.join(' · ')];
  };

  /** "Aplicar (2.200 → 2.120 kcal)". */
  const applyLabel = (proposal: NonNullable<WeeklyReview['proposal']>) =>
    format(r.apply, { from: n(proposal.fromKcal), to: n(proposal.toKcal) });

  const proposalText = (proposal: NonNullable<WeeklyReview['proposal']>) =>
    format(r.proposal, { from: n(proposal.fromKcal), to: n(proposal.toKcal) });

  /** "Aplicado (2.200 → 2.120 kcal)", "No aplicado", "Sin cambios", "Pendiente". */
  const status = (review: WeeklyReview) =>
    review.status === 'accepted' && review.proposal
      ? format(r.status.accepted, {
          from: n(review.proposal.fromKcal),
          to: n(review.proposal.toKcal),
        })
      : review.status === 'accepted'
        ? r.status.no_change
        : r.status[review.status];

  /** The outcome with the day it was decided ("No aplicado · 7 dic"). */
  const outcome = (review: WeeklyReview) =>
    review.decidedAt
      ? format(r.decidedOn, {
          status: status(review),
          // The device's date of the decision (a late "Aplicar" is still that evening).
          date: formatShortDate(localToday(new Date(review.decidedAt), 0), locale),
        })
      : status(review);

  return { range, lines, cardLines, applyLabel, proposalText, status, outcome };
}
