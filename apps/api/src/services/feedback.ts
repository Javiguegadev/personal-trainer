import { AiUnavailableError, type FeedbackPromptInput } from '@pt/ai';
import {
  FOOD_LOG_LIMITS,
  type DailyFeedbackRequest,
  type DailyFeedbackResponse,
  type Food,
  type FeedbackNote,
} from '@pt/contracts';
import {
  addDays,
  dailyObservations,
  feedbackAvailable,
  feedbackCandidates,
  feedbackCitations,
  feedbackFingerprint,
  formatPortion,
  minuteOfDay,
  portionPreview,
  referenceWeightKg,
  sportCarbsMinimum,
  templateNotes,
  trainingMinutesPerWeek,
  validateFeedback,
  type FeedbackCandidates,
} from '@pt/core';
import type { Deps } from '../deps';
import { withinDailyCap } from './entitlements';
import { resolveFoods, toFood, toRecentFoods, type Catalog } from './foods';

/** How many recently logged foods the candidates come from (AC12). */
const RECENT_FOODS_MAX = 60;

/**
 * The daily feedback of one day (spec 008). Everything is read on the server: the day's items, the
 * targets, the profile behind the breakdown, the recents and favourites and the dietary preferences;
 * no number comes from the client. Core finds the observations and the candidates; Claude only words
 * them, within a daily cap; any failure falls back to the fixed wording (AC15). Nothing is stored
 * besides the `ai_usage` row of the call.
 */
export function createFeedbackService(
  deps: Pick<Deps, 'store' | 'wordFeedback' | 'now'>,
  getCatalog: () => Promise<Catalog>,
) {
  return async function dailyFeedback(
    userId: string,
    request: DailyFeedbackRequest,
  ): Promise<DailyFeedbackResponse | 'unavailable'> {
    const me = await deps.store.getMe(userId);
    const { profile, targets } = me;
    if (!profile || !targets || !feedbackAvailable(profile.safetyFlags, true)) {
      return 'unavailable';
    }

    const items = await deps.store.listMealItems(userId, request.localDate, request.localDate);
    const focus = profile.trainingFocus ?? 'general_fitness';
    const reference = referenceWeightKg(profile.heightCm, profile.weightKg);
    const carbsMin = sportCarbsMinimum(
      focus,
      trainingMinutesPerWeek(profile.plannedActivities),
      reference,
    );
    const { state, observations } = dailyObservations(
      { localDate: request.localDate, items, trainingDay: request.trainingDay },
      targets,
      {
        referenceWeightKg: reference,
        trainingFocus: focus,
        carbsMinGPerKg: carbsMin?.gPerKg ?? null,
      },
      { safetyFlags: profile.safetyFlags },
      { today: request.today, minuteOfDay: minuteOfDay(request.localTime) },
    );

    const candidates = feedbackCandidates(
      observations,
      await userFoods(userId, request),
      targets.kcal,
    );
    const reading = await word(userId, {
      locale: request.locale,
      state,
      trainingFocus: focus,
      dietType: me.dietaryPrefs?.dietType ?? null,
      allergies: me.dietaryPrefs?.allergies ?? [],
      dislikes: me.dietaryPrefs?.dislikes ?? [],
      observations: observations.map(({ kind, numbers }) => ({ kind, numbers })),
      candidates: promptCandidates(candidates, request.locale),
    });
    const notes: FeedbackNote[] = reading
      ? validateFeedback(reading, observations, candidates)
      : templateNotes(observations, candidates);
    return {
      localDate: request.localDate,
      state,
      notes,
      citations: feedbackCitations(notes),
      fingerprint: feedbackFingerprint(items),
    };
  };

  /** Recents of the last 60 days with their last portion, and favourites (AC12). */
  async function userFoods(userId: string, request: DailyFeedbackRequest) {
    const since = addDays(request.today, -FOOD_LOG_LIMITS.recentsDays);
    const [recentItems, favouriteIds, catalog] = await Promise.all([
      deps.store.listRecentFoodItems(userId, since, RECENT_FOODS_MAX),
      deps.store.listFavouriteFoodIds(userId),
      getCatalog(),
    ]);
    const ids = [
      ...recentItems.flatMap((item) => (item.foodId ? [item.foodId] : [])),
      ...favouriteIds,
    ];
    const foods = await resolveFoods(deps.store, catalog, userId, ids);
    const favourites = favouriteIds.flatMap((id): Food[] => {
      const food = foods.get(id);
      return food ? [toFood(food, request.locale)] : [];
    });
    return { recents: toRecentFoods(recentItems, foods, request.locale), favourites };
  }

  /**
   * The AI wording within the daily cap (AC13–AC15). Every call writes one `ai_usage` row, failed
   * ones too. Null past the cap or on a failure: the notes use the fixed wording.
   */
  async function word(userId: string, input: FeedbackPromptInput) {
    if (!(await withinDailyCap(deps, userId, 'daily_feedback'))) return null;
    try {
      const { reading, usage } = await deps.wordFeedback(input);
      await deps.store.recordAiUsage(userId, usage, deps.now());
      return reading;
    } catch (failure) {
      if (!(failure instanceof AiUnavailableError)) throw failure;
      await deps.store.recordAiUsage(userId, failure.usage, deps.now());
      return null;
    }
  }
}

/** The candidates as the model sees them: a ref, a name, the portion in words, the nutrient. */
export function promptCandidates(
  candidates: FeedbackCandidates,
  locale: DailyFeedbackRequest['locale'],
): FeedbackPromptInput['candidates'] {
  return Object.fromEntries(
    Object.entries(candidates).map(([kind, list]) => [
      kind,
      (list ?? []).map((c) => {
        const preview = portionPreview(c.food, c.portion);
        return {
          ref: c.ref,
          name: c.food.brand ? `${c.food.name} (${c.food.brand})` : c.food.name,
          portion: (preview && formatPortion(preview, locale)) ?? '',
          amount: c.amount,
        };
      }),
    ]),
  );
}
