import { expect, test } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  fillForm,
  openTab,
  screen,
  signInWithEmail,
  signInWithGoogle,
} from './app';

// Mifflin-St Jeor for a man of 30, 175 cm and 80 kg: 10·80 + 6.25·175 − 5·30 + 5 = 1748.75 kcal.

test.describe('onboarding (spec 001, spec 002)', () => {
  test('email code → consent → form with a job and two activities → summary → Today', async ({
    page,
  }) => {
    await signInWithEmail(page, 'form@example.com');
    const form = await acceptConsent(page);

    // Nothing continues with an empty form.
    await form.getByTestId('form-continue').click();
    await expect(form.getByRole('alert').first()).toBeVisible();

    // Spec 002 AC3: "I don't train" is the starting point.
    await expect(form.getByTestId('training-empty')).toBeVisible();

    await fillForm(form, {
      sex: 'male',
      age: 30,
      height: { cm: '175' },
      weight: '80',
      job: 'sedentary',
      training: [
        {}, // strength, 3 × 60 min, moderate
        { kind: 'sport', name: 'fútbol', timesPerWeek: 2, minutes: 90 },
      ],
      goal: 'maintain',
    });
    await expect(form.getByTestId('training-summary')).toContainText('5');
    await expect(form.getByTestId('training-summary')).toContainText('360');
    await form.getByTestId('form-continue').click();

    // Spec 002 AC6: factor 1.4 (seated) + (3 h × 2.5 + 3 h × 5) / 168 = 1.5339 → 2682.5 → 2680 kcal.
    const summary = await screen(page, 'onboarding-summary-screen');
    await expect(summary.getByTestId('targets-kcal')).toContainText('2680');

    // Spec 002 AC8: the breakdown shows the job and the training factors.
    await summary.getByTestId('how-calculated').click();
    await expect(summary.getByTestId('targets-breakdown')).toContainText('1,4');
    await expect(summary.getByTestId('targets-breakdown')).toContainText('0,13');

    // Spec 002 AC7: removing the football updates the preview before anything is saved.
    // Factor 1.4 + 7.5 / 168 = 1.4446 → 2526.3 → 2530 kcal.
    await summary.getByTestId('activity-1-remove').click();
    await expect(summary.getByTestId('targets-kcal')).toContainText('2530');

    // The summary goes back to the form with the answers intact.
    await summary.getByTestId('back-link').click();
    const back = await screen(page, 'onboarding-form-screen');
    await expect(back.getByTestId('field-height-cm')).toHaveValue('175');
    await expect(back.getByTestId('activity-0-sessions-value')).toHaveText('3');
    await back.getByTestId('form-continue').click();

    const today = await confirmSummary(page);
    await expect(today.getByTestId('targets-kcal')).toContainText('2530');
    // Spec 003 AC3: the planned training of the week, under the targets.
    await expect(today.getByTestId('training-line')).toContainText('3 sesiones');
    await expect(today.getByTestId('training-line')).toContainText('180');

    // AC4: the session and the profile survive a reload.
    await page.reload();
    await expect((await screen(page, 'today-screen')).getByTestId('targets-kcal')).toContainText(
      '2530',
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
      job: 'standing',
      goal: 'lose',
    });
    await form.getByTestId('form-continue').click();

    // 5 ft 5 = 165.1 cm, 137 lb = 62.1 kg: BMR 1321.9; × 1.6 (on her feet) = 2115; − 20 % = 1692 → 1690.
    const today = await confirmSummary(page);
    await expect(today.getByTestId('targets-kcal')).toContainText('1690');
  });

  test('changing the job in the profile changes the targets on Today (spec 002 AC5, AC7)', async ({
    page,
  }) => {
    await signInWithEmail(page, 'settings@example.com');
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'male',
      age: 30,
      height: { cm: '175' },
      weight: '80',
      job: 'sedentary',
      goal: 'maintain',
    });
    await form.getByTestId('form-continue').click();

    // Seated, no training: 1748.75 × 1.4 = 2448.3 → 2450 kcal.
    const today = await confirmSummary(page);
    await expect(today.getByTestId('targets-kcal')).toContainText('2450');

    // Spec 003 AC2: "My details" lives in the Profile tab.
    await (await openTab(page, 'profile')).getByTestId('open-profile').click();
    const profile = await screen(page, 'settings-profile-screen');
    await expect(profile.getByTestId('field-job-sedentary')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Physical work: 1748.75 × 1.8 = 3147.8 → 3150 kcal, previewed before saving.
    await profile.getByTestId('field-job-physical').click();
    await expect(profile.getByTestId('targets-kcal')).toContainText('3150');
    await profile.getByTestId('save-profile').click();
    await expect(profile.getByTestId('profile-saved')).toBeVisible();

    await profile.getByTestId('back-link').click();
    await expect((await openTab(page, 'today')).getByTestId('targets-kcal')).toContainText('3150');
  });

  test('an onboarded account with an older consent is asked again, then goes back to Today (spec 002 AC14)', async ({
    page,
  }) => {
    await signInWithGoogle(page);
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'male',
      age: 30,
      height: { cm: '175' },
      weight: '80',
      job: 'sedentary',
      goal: 'maintain',
    });
    await form.getByTestId('form-continue').click();
    await confirmSummary(page);

    // A new CONSENT_VERSION ships: the stored consent is now for an older text.
    await page.evaluate(() => {
      // Must match `MOCK_DB_KEY` in packages/api-client/src/mock/backend.ts.
      const key = 'pt.mock-db.v8';
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
        string,
        { consents: { version: string }[] }
      >;
      for (const record of Object.values(db)) {
        for (const consent of record.consents) consent.version = '2000-01-v0';
      }
      localStorage.setItem(key, JSON.stringify(db));
    });
    await page.reload();

    const consent = await screen(page, 'consent-screen');
    await consent.getByTestId('consent-checkbox').click();
    await consent.getByTestId('accept-consent').click();

    // Straight home, not to the onboarding form, and nothing stored was lost.
    const today = await screen(page, 'today-screen');
    await expect(today.getByTestId('targets-kcal')).toContainText('2450');
  });
});
