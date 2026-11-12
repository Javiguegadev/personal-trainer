import { expect, test } from '@playwright/test';
import { acceptConsent, confirmSummary, say, screen, signInWithGoogle } from './app';

test.describe('privacy (spec 001)', () => {
  test('deleting the account removes the profile and ends the session (AC24)', async ({ page }) => {
    await signInWithGoogle(page);
    const chat = await acceptConsent(page);
    // "#demo" is the mock's hook that fills the profile with example values.
    await say(chat, '#demo', 'ya lo tengo todo');
    await chat.getByTestId('review-summary').click();
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
