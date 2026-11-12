import { expect, test } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  fillForm,
  screen,
  signInWithEmail,
  signInWithGoogle,
} from './app';

test.describe('onboarding (spec 001)', () => {
  test('email code → consent → form → summary → Home (AC1, AC4, AC6, AC10, AC11)', async ({
    page,
  }) => {
    await signInWithEmail(page, 'form@example.com');
    const form = await acceptConsent(page);

    // Nothing continues with an empty form.
    await form.getByTestId('form-continue').click();
    await expect(form.getByRole('alert').first()).toBeVisible();

    await fillForm(form, {
      sex: 'male',
      age: 30,
      height: { cm: '175' },
      weight: '80',
      activity: 'moderate',
      goal: 'maintain',
    });
    await form.getByTestId('form-continue').click();

    // Mifflin-St Jeor: 10·80 + 6.25·175 − 5·30 + 5 = 1748.75; × 1.55 = 2710.6 → 2710 kcal.
    const summary = await screen(page, 'onboarding-summary-screen');
    await expect(summary.getByTestId('targets-kcal')).toContainText('2710');

    // The summary goes back to the form with the answers intact.
    await summary.getByTestId('back-link').click();
    const back = await screen(page, 'onboarding-form-screen');
    await expect(back.getByTestId('field-height-cm')).toHaveValue('175');
    await back.getByTestId('form-continue').click();

    const home = await confirmSummary(page);
    await expect(home.getByTestId('targets-kcal')).toContainText('2710');

    // AC4: the session and the profile survive a reload.
    await page.reload();
    await expect((await screen(page, 'home-screen')).getByTestId('targets-kcal')).toContainText(
      '2710',
    );
  });

  test('imperial units give the same targets as their metric values (AC3, AC9)', async ({
    page,
  }) => {
    await signInWithGoogle(page);
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'female',
      age: 34,
      height: { ft: '5', in: '5' },
      weight: '137',
      activity: 'light',
      goal: 'lose',
    });
    await form.getByTestId('form-continue').click();

    // 5 ft 5 = 165.1 cm, 137 lb = 62.1 kg: BMR 1321.9; × 1.375 = 1817.6; − 20 % = 1454 → 1450 kcal.
    const home = await confirmSummary(page);
    await expect(home.getByTestId('targets-kcal')).toContainText('1450');
  });
});
