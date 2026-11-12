import { expect, test } from '@playwright/test';
import { acceptConsent, confirmSummary, fillForm, screen, signInWithGoogle } from './app';

test.describe('privacy (spec 001)', () => {
  test('deleting the account removes the profile and ends the session (AC24)', async ({ page }) => {
    await signInWithGoogle(page);
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'female',
      age: 34,
      height: { cm: '165' },
      weight: '62',
      activity: 'moderate',
      goal: 'maintain',
    });
    await form.getByTestId('form-continue').click();
    const home = await confirmSummary(page);

    await home.getByTestId('open-privacy').click();
    const privacy = await screen(page, 'settings-privacy-screen');
    await expect(privacy.getByTestId('delete-account')).toBeDisabled();
    await privacy.getByTestId('delete-confirmation').fill('ELIMINAR');
    await privacy.getByTestId('delete-account').click();

    // The session is gone, and the same account starts from scratch: consent again, no profile.
    await screen(page, 'sign-in-screen');
    await signInWithGoogle(page);
    await screen(page, 'consent-screen');
  });
});
