import type { ReviewResponse, WeeklyReview } from '@pt/contracts';

/**
 * The review the "Tu semana" card shows on Today (spec 014 AC1): a proposal until the user decides on
 * it, and a review without one until "Entendido" (`dismissedWeek`, kept on the device). A decided
 * review, or none, shows nothing. The next week's review replaces it, so an older dismissal does not
 * hide a newer week.
 */
export function reviewToShow(
  response: Pick<ReviewResponse, 'review'> | null | undefined,
  dismissedWeek: string | null,
): WeeklyReview | null {
  const review = response?.review ?? null;
  if (!review) return null;
  if (review.status === 'proposed') return review.proposal ? review : null;
  if (review.status === 'no_change') return review.weekStart === dismissedWeek ? null : review;
  return null;
}
