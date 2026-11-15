import { expect, test } from '@playwright/test';
import { acceptConsent, confirmSummary, fillForm, openTab, signInWithGoogle } from './app';

const LIGHT_BACKGROUND = 'rgb(246, 248, 246)'; // tokens.palette.light.background
const DARK_BACKGROUND = 'rgb(11, 15, 13)'; // tokens.palette.dark.background

test.describe('appearance (Profile tab)', () => {
  test('follows the device by default, and a picked scheme wins and survives a reload', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await signInWithGoogle(page);
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'female',
      age: 34,
      height: { cm: '165' },
      weight: '62',
      job: 'sedentary',
      goal: 'maintain',
    });
    await form.getByTestId('form-continue').click();
    await confirmSummary(page);

    let profile = await openTab(page, 'profile');
    await expect(profile.getByTestId('theme-preference-system')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(profile).toHaveCSS('background-color', DARK_BACKGROUND);

    await profile.getByTestId('theme-preference-light').click();
    await expect(profile).toHaveCSS('background-color', LIGHT_BACKGROUND);

    await page.reload();
    profile = await openTab(page, 'profile');
    await expect(profile.getByTestId('theme-preference-light')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(profile).toHaveCSS('background-color', LIGHT_BACKGROUND);

    await profile.getByTestId('theme-preference-system').click();
    await expect(profile).toHaveCSS('background-color', DARK_BACKGROUND);
  });
});
