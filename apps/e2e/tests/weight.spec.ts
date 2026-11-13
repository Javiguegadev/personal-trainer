import { expect, test, type Page } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  fillForm,
  openTab,
  screen,
  signInWithEmail,
  signInWithGoogle,
} from './app';

/** The user's day in the test time zone (Europe/Madrid, see playwright.config.ts). */
async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

/** The weight log stored by the mock backend (what the server has), for the only user. */
async function storedWeights(page: Page) {
  return page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('pt.mock-db.v3') ?? '{}') as Record<
      string,
      { weights: { localDate: string; weightKg: number }[] }
    >;
    return Object.values(db)[0]?.weights ?? [];
  });
}

/**
 * Offline without blocking the dev server: the app reads `navigator.onLine` and the online/offline
 * events (lib/online.web.ts). A flag in sessionStorage keeps the state across a reload.
 */
async function emulateOnlineState(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => sessionStorage.getItem('e2e-offline') !== '1',
    });
  });
}

async function setOffline(page: Page, offline: boolean) {
  await page.evaluate((off) => {
    if (off) sessionStorage.setItem('e2e-offline', '1');
    else sessionStorage.removeItem('e2e-offline');
    // In the page `globalThis` is `window`.
    (globalThis as unknown as EventTarget).dispatchEvent(new Event(off ? 'offline' : 'online'));
  }, offline);
}

test.describe('weight log (spec 003)', () => {
  test('log from Today, see it in Progress, replace it, delete it', async ({ page }) => {
    await signInWithEmail(page, 'weight@example.com');
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'female',
      age: 34,
      height: { cm: '165' },
      weight: '70',
      job: 'sedentary',
      goal: 'lose',
    });
    await form.getByTestId('form-continue').click();
    const today = await confirmSummary(page);
    const day = await localToday(page);

    // BMR 10·70 + 6.25·165 − 5·34 − 161 = 1400.25; × 1.4 = 1960.35; − 20 % = 1568.3 → 1570 kcal.
    await expect(today.getByTestId('targets-kcal')).toContainText('1570');
    // AC13: the profile weight is today's entry, so the card offers "Edit".
    const card = today.getByTestId('weight-card');
    await expect(card.getByTestId('weight-card-value')).toHaveText('70 kg');
    await card.getByTestId('edit-weight').click();

    // AC6: the field opens with the last weight; − takes 0.1 kg off per tap.
    let sheet = await screen(page, 'weight-sheet');
    await expect(sheet.getByTestId('weight-input')).toHaveValue('70');
    for (let i = 0; i < 5; i++) await sheet.getByTestId('weight-decrease').click();
    await expect(sheet.getByTestId('weight-input')).toHaveValue('69,5');
    await expect(sheet.getByTestId(`weight-day-${day}`)).toHaveAttribute('aria-checked', 'true');
    await sheet.getByTestId('save-weight').click();

    // AC10, AC11: 69.5 kg → BMR 1395.25; × 1.4 × 0.8 = 1562.7 → 1560 kcal, with a notice.
    await screen(page, 'today-screen');
    await expect(card.getByTestId('weight-card-value')).toHaveText('69,5 kg');
    await expect(today.getByTestId('targets-change-notice')).toContainText('1570');
    await expect(today.getByTestId('targets-change-notice')).toContainText('1560');
    await expect(today.getByTestId('targets-kcal')).toContainText('1560');
    await today.getByTestId('dismiss-targets-change').click();
    await expect(today.getByTestId('targets-change-notice')).toHaveCount(0);

    // AC14: the entry is in Progress.
    const progress = await openTab(page, 'progress');
    const row = progress.getByTestId(`weight-row-${day}`);
    await expect(row.getByTestId(`weight-row-${day}-value`)).toHaveText('69,5 kg');
    await expect(progress.getByTestId('weight-chart')).toBeVisible();

    // AC8: saving the same day again replaces the entry.
    await row.getByTestId(`weight-row-${day}-edit`).click();
    sheet = await screen(page, 'weight-sheet');
    await sheet.getByTestId('weight-input').fill('69,2');
    await sheet.getByTestId('save-weight').click();
    await screen(page, 'progress-screen');
    await expect(row.getByTestId(`weight-row-${day}-value`)).toHaveText('69,2 kg');
    await expect(
      progress.locator('[data-testid^="weight-row-"][data-testid$="-value"]'),
    ).toHaveCount(1);

    // AC7: a value out of range is refused (the 3 % confirmation is covered in @pt/core).
    await progress.getByTestId('add-weight').click();
    sheet = await screen(page, 'weight-sheet');
    await sheet.getByTestId(`weight-day-${day}`).click();
    await sheet.getByTestId('weight-input').fill('20');
    await sheet.getByTestId('save-weight').click();
    await expect(sheet.getByTestId('weight-error')).toBeVisible();
    await sheet.getByTestId('cancel-weight').click();

    // AC9, AC17: deleting the only entry leaves the empty state; the profile weight stays.
    await screen(page, 'progress-screen');
    await row.getByTestId(`weight-row-${day}-delete`).click();
    await row.getByTestId(`weight-row-${day}-delete-yes`).click();
    await expect(progress.getByTestId('progress-empty')).toBeVisible();
    await expect.poll(() => storedWeights(page)).toEqual([]);

    // AC4: with no entry today, "Today" invites to log the weight.
    const back = await openTab(page, 'today');
    await expect(back.getByTestId('log-weight')).toBeVisible();
    await expect(back.getByTestId('weight-card-value')).toHaveText('69,2 kg');
  });

  test('a weight logged offline survives a reload and syncs once (AC18, AC19, AC22)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
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
    let today = await confirmSummary(page);
    const day = await localToday(page);
    await expect(today.getByTestId('weight-card-value')).toHaveText('80 kg');

    // AC5: offline, "Today" keeps the data and says so.
    await setOffline(page, true);
    await expect(today.getByTestId('offline-banner')).toBeVisible();

    // AC18: the change shows at once, marked "waiting to sync"; the server does not have it.
    await today.getByTestId('edit-weight').click();
    const sheet = await screen(page, 'weight-sheet');
    await expect(sheet.getByTestId('weight-offline')).toBeVisible();
    await sheet.getByTestId('weight-input').fill('79,4');
    await sheet.getByTestId('save-weight').click();
    today = await screen(page, 'today-screen');
    await expect(today.getByTestId('weight-card-value')).toHaveText('79,4 kg');
    await expect(today.getByTestId('sync-badge')).toBeVisible();
    expect(await storedWeights(page)).toEqual([expect.objectContaining({ weightKg: 80 })]);

    // AC22: signing out now would lose the write, so the app asks first.
    const profile = await openTab(page, 'profile');
    await profile.getByTestId('sign-out').click();
    await expect(profile.getByTestId('sign-out-pending')).toContainText('1 cambio');
    await profile.getByRole('button', { name: 'Cancelar' }).click();

    // The queue is saved on the device (the cache is written about a second after a change).
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some(
            (key) =>
              key.startsWith('pt.query-cache.') &&
              (localStorage.getItem(key) ?? '').includes('"mutations":[{'),
          ),
        ),
      )
      .toBe(true);

    // The app is closed and opened again, still offline: the entry and its mark are still there.
    await page.reload();
    today = await openTab(page, 'today');
    await expect(today.getByTestId('offline-banner')).toBeVisible();
    await expect(today.getByTestId('weight-card-value')).toHaveText('79,4 kg');
    await expect(today.getByTestId('sync-badge')).toBeVisible();
    expect(await storedWeights(page)).toEqual([expect.objectContaining({ weightKg: 80 })]);

    // Back online: the write is sent once and the mark goes away (AC19: one row for the day).
    await setOffline(page, false);
    await expect(today.getByTestId('sync-badge')).toHaveCount(0);
    await expect(today.getByTestId('offline-banner')).toHaveCount(0);
    await expect
      .poll(() => storedWeights(page))
      .toEqual([expect.objectContaining({ localDate: day, weightKg: 79.4 })]);

    await page.reload();
    const progress = await openTab(page, 'progress');
    await expect(progress.getByTestId(`weight-row-${day}-value`)).toHaveText('79,4 kg');
    await expect(progress.getByTestId('sync-badge')).toHaveCount(0);
  });
});
