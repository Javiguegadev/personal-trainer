import { expect, test } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  say,
  screen,
  signInWithEmail,
  signInWithGoogle,
} from './app';

test.describe('onboarding (spec 001)', () => {
  test('email code → consent → chat → summary → Home (AC1, AC4, AC6, AC8, AC10)', async ({
    page,
  }) => {
    await signInWithEmail(page, 'chat@example.com');
    const chat = await acceptConsent(page);

    // The answers of the human test of 2026-11-12: no units, as the chat intro suggests.
    await say(chat, 'hombre, 30', '¿Cuánto mides y cuánto pesas?');
    await say(chat, '1,75 y 80', 'activo');
    const chips = chat.getByTestId('draft-chips');
    await expect(chips).toContainText('30 años');
    await expect(chips).toContainText('175 cm');
    await expect(chips).toContainText('80 kg');

    await say(chat, 'moderado', '¿Qué quieres conseguir');
    await say(chat, 'mantenerme', 'dieta');
    await say(chat, 'como de todo', 'ya lo tengo todo');
    await chat.getByTestId('review-summary').click();

    // Mifflin-St Jeor: 10·80 + 6.25·175 − 5·30 + 5 = 1748.75; × 1.55 = 2710.6 → 2710 kcal.
    const summary = await screen(page, 'onboarding-summary-screen');
    await expect(summary.getByTestId('targets-kcal')).toContainText('2710');
    const home = await confirmSummary(page);
    await expect(home.getByTestId('targets-kcal')).toContainText('2710');

    // AC4: the session and the profile survive a reload.
    await page.reload();
    await expect((await screen(page, 'home-screen')).getByTestId('targets-kcal')).toContainText(
      '2710',
    );
  });

  test('manual form in imperial units reaches the same result (AC3, AC9, AC11)', async ({
    page,
  }) => {
    await signInWithGoogle(page);
    const chat = await acceptConsent(page);
    await chat.getByTestId('use-form').click();

    const form = await screen(page, 'onboarding-form-screen');
    // Born on 1 January, so the age is the same on any day of the year.
    const birthYear = new Date().getFullYear() - 34;
    await form.getByTestId('field-sex-female').click();
    await form.getByTestId('field-birth-day').fill('1');
    await form.getByTestId('field-birth-month').fill('1');
    await form.getByTestId('field-birth-year').fill(String(birthYear));
    await form.getByTestId('field-units-imperial').click();
    await form.getByTestId('field-height-ft').fill('5');
    await form.getByTestId('field-height-in').fill('5');
    await form.getByTestId('field-weight').fill('137');
    await form.getByTestId('field-activity-light').click();
    await form.getByTestId('field-goal-lose').click();
    await form.getByTestId('field-diet-omnivore').click();
    await form.getByTestId('form-continue').click();

    // 5 ft 5 = 165.1 cm, 137 lb = 62.1 kg: BMR 1321.9; × 1.375 = 1817.6; − 20 % = 1454 → 1450 kcal.
    const home = await confirmSummary(page);
    await expect(home.getByTestId('targets-kcal')).toContainText('1450');
  });

  test('the form goes back to the chat with the conversation intact', async ({ page }) => {
    await signInWithEmail(page, 'back@example.com');
    const chat = await acceptConsent(page);
    await say(chat, 'mujer, 28', '¿Cuánto mides y cuánto pesas?');
    await chat.getByTestId('use-form').click();

    const form = await screen(page, 'onboarding-form-screen');
    await form.getByTestId('back-link').click();

    const back = await screen(page, 'onboarding-chat-screen');
    await expect(back.getByTestId('chat-user')).toHaveText('mujer, 28');
    await expect(back.getByTestId('draft-chips')).toContainText('28 años');
  });

  test('the daily chat limit offers the form (AC12)', async ({ page }) => {
    await signInWithEmail(page, 'limit@example.com');
    const chat = await acceptConsent(page);

    // "#429" is the mock's hook for the rate limit.
    await chat.getByTestId('chat-input').fill('#429');
    await chat.getByTestId('chat-send').click();
    const notice = chat.getByTestId('chat-rate-limited');
    await expect(notice).toBeVisible();
    // React Native Web renders a non-editable field as read-only.
    await expect(chat.getByTestId('chat-input')).not.toBeEditable();

    await notice.getByRole('button').click();
    await screen(page, 'onboarding-form-screen');
  });
});
