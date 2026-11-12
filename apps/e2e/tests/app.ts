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

/** AC6: nothing continues without the explicit checkbox. */
export async function acceptConsent(page: Page): Promise<Locator> {
  const consent = await screen(page, 'consent-screen');
  await expect(consent.getByTestId('accept-consent')).toBeDisabled();
  await consent.getByTestId('consent-checkbox').click();
  await consent.getByTestId('accept-consent').click();
  return screen(page, 'onboarding-chat-screen');
}

/** Sends one chat message and waits for a reply that contains `reply`. */
export async function say(chat: Locator, message: string, reply: string | RegExp): Promise<void> {
  await chat.getByTestId('chat-input').fill(message);
  await chat.getByTestId('chat-send').click();
  await expect(chat.getByTestId('chat-user').last()).toHaveText(message);
  await expect(chat.getByTestId('chat-assistant').last()).toContainText(reply);
}

/** AC10: nothing is saved until the summary is confirmed; the root guard then opens Home. */
export async function confirmSummary(page: Page): Promise<Locator> {
  const summary = await screen(page, 'onboarding-summary-screen');
  await expect(summary.getByTestId('targets-kcal')).toBeVisible();
  await summary.getByTestId('confirm-profile').click();
  return screen(page, 'home-screen');
}
