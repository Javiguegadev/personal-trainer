/** Query keys shared by several modules (kept apart so they do not import each other). */

/** `GET /me`: profile, prefs, current targets, consent and onboarding status. */
export const meKey = ['me'] as const;
