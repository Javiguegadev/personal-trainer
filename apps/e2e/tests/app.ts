import { expect, type Locator, type Page } from '@playwright/test';

/** Mock auth (apps/app/src/lib/auth/mock.ts): any email signs in with this code. */
const MOCK_CODE = '123456';

/**
 * The navigator keeps earlier screens mounted but hidden, so the same test id can exist twice in the
 * page. Every lookup goes through the screen it belongs to, and waits for that screen to be on top.
 */
export async function screen(page: Page, testId: string): Promise<Locator> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  return locator;
}

async function openSignIn(page: Page): Promise<Locator> {
  await page.goto('/');
  const signIn = await screen(page, 'sign-in-screen');
  await expect(
    signIn.getByTestId('demo-banner'),
    'The app must run with the mock backend: pnpm --filter @pt/app web:mock',
  ).toBeVisible();
  return signIn;
}

/** AC1: email + 6-digit code. The code is submitted as soon as it is complete. */
export async function signInWithEmail(page: Page, email: string): Promise<void> {
  const signIn = await openSignIn(page);
  await signIn.getByTestId('email-input').fill(email);
  await signIn.getByTestId('send-code').click();
  const verify = await screen(page, 'verify-screen');
  await verify.getByTestId('otp-input').fill(MOCK_CODE);
}

/** AC3 on the mock: a fixed demo account. */
export async function signInWithGoogle(page: Page): Promise<void> {
  const signIn = await openSignIn(page);
  await signIn.getByTestId('google-sign-in').click();
}

/** AC6: nothing continues without the explicit checkbox. The form is the onboarding entry (ADR 004). */
export async function acceptConsent(page: Page): Promise<Locator> {
  const consent = await screen(page, 'consent-screen');
  await expect(consent.getByTestId('accept-consent')).toBeDisabled();
  await consent.getByTestId('consent-checkbox').click();
  await consent.getByTestId('accept-consent').click();
  return screen(page, 'onboarding-form-screen');
}

/** One activity card. Unset fields keep what "Add activity" inserts: strength, 3 × 60 min, moderate. */
export interface Activity {
  kind?: 'strength' | 'cardio' | 'sport' | 'other';
  name?: string;
  timesPerWeek?: number;
  minutes?: 30 | 45 | 60 | 90 | 120;
  intensity?: 'light' | 'moderate' | 'hard';
}

/** Adds an activity card with taps only (spec 002 AC2); the name is the one optional typed field. */
export async function addActivity(form: Locator, activity: Activity): Promise<void> {
  const index = await form.locator('[data-testid^="activity-"][data-testid$="-kind"]').count();
  await form.getByTestId('add-activity').click();
  const card = form.getByTestId(`activity-${index}`);
  await expect(card).toBeVisible();
  if (activity.kind) await card.getByTestId(`activity-${index}-kind-${activity.kind}`).click();
  if (activity.name) await card.getByTestId(`activity-${index}-name`).fill(activity.name);
  const DEFAULT_TIMES = 3;
  const times = activity.timesPerWeek ?? DEFAULT_TIMES;
  const step = times > DEFAULT_TIMES ? 'increase' : 'decrease';
  for (let i = 0; i < Math.abs(times - DEFAULT_TIMES); i++) {
    await card.getByTestId(`activity-${index}-sessions-${step}`).click();
  }
  await expect(card.getByTestId(`activity-${index}-sessions-value`)).toHaveText(String(times));
  if (activity.minutes) {
    await card.getByTestId(`activity-${index}-duration-${activity.minutes}`).click();
  }
  if (activity.intensity) {
    await card.getByTestId(`activity-${index}-intensity-${activity.intensity}`).click();
  }
}

export interface FormAnswers {
  sex: 'female' | 'male';
  /** The birth date is 1 January, so the age is the same on any day of the year. */
  age: number;
  height: { cm: string } | { ft: string; in: string };
  /** In kg, or in lb when the height is in feet. */
  weight: string;
  job: 'sedentary' | 'standing' | 'physical';
  /** Weekly training outside work. Omitted means "I don't train". */
  training?: Activity[];
  goal: 'lose' | 'maintain' | 'gain';
}

/** Fills the profile form with taps and fields; imperial units when the height is in feet. */
export async function fillForm(form: Locator, answers: FormAnswers): Promise<void> {
  await form.getByTestId(`field-sex-${answers.sex}`).click();
  await form.getByTestId('field-birth-day').fill('1');
  await form.getByTestId('field-birth-month').fill('1');
  await form.getByTestId('field-birth-year').fill(String(new Date().getFullYear() - answers.age));
  if ('cm' in answers.height) {
    await form.getByTestId('field-height-cm').fill(answers.height.cm);
  } else {
    await form.getByTestId('field-units-imperial').click();
    await form.getByTestId('field-height-ft').fill(answers.height.ft);
    await form.getByTestId('field-height-in').fill(answers.height.in);
  }
  await form.getByTestId('field-weight').fill(answers.weight);
  await form.getByTestId(`field-job-${answers.job}`).click();
  for (const activity of answers.training ?? []) await addActivity(form, activity);
  await form.getByTestId(`field-goal-${answers.goal}`).click();
  await form.getByTestId('field-diet-omnivore').click();
}

/** AC10: nothing is saved until the summary is confirmed; the root guard then opens Home. */
export async function confirmSummary(page: Page): Promise<Locator> {
  const summary = await screen(page, 'onboarding-summary-screen');
  await expect(summary.getByTestId('targets-kcal')).toBeVisible();
  await summary.getByTestId('confirm-profile').click();
  return screen(page, 'home-screen');
}
