import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  emulateOnlineState,
  fillForm,
  openTab,
  screen,
  setOffline,
  signInWithEmail,
} from './app';

/**
 * The daily feedback (spec 008), on the web build with the mock backend: the mock words the notes
 * that food can fix with a scripted "AI" text and leaves the rest to the fixed wording
 * (`packages/api-client/src/mock/feedback.ts`), so the journeys test the card, not the AI. The clock
 * is fixed, because a day is "in progress" only before 22:00.
 */
const MORNING = new Date('2026-11-18T10:00:00+01:00');
const NIGHT = new Date('2026-11-18T22:30:00+01:00');

async function onboard(page: Page, email: string, pregnancy = false): Promise<void> {
  await signInWithEmail(page, email);
  const form = await acceptConsent(page);
  await fillForm(form, {
    sex: 'female',
    age: 34,
    height: { cm: '165' },
    weight: '62',
    job: 'sedentary',
    goal: 'maintain',
  });
  if (pregnancy) {
    await form.getByTestId('field-pregnancy').click();
    await form.getByTestId('form-continue').click();
    await (await screen(page, 'onboarding-summary-screen')).getByTestId('confirm-profile').click();
    await screen(page, 'today-screen');
    return;
  }
  await form.getByTestId('form-continue').click();
  await confirmSummary(page);
}

/** One egg (its first serving) to a meal of the Food tab. */
async function logEgg(page: Page, meal: 'breakfast' | 'lunch'): Promise<Locator> {
  const food = await openTab(page, 'food');
  await food.getByTestId(`meal-${meal}-add`).click();
  const add = await screen(page, 'food-add-screen');
  await add.getByTestId('food-search').fill('huev');
  await add.getByTestId('food-results').getByTestId('food-d-huevo-open').click();
  await (await screen(page, 'portion-sheet')).getByTestId('portion-submit').click();
  await expect((await screen(page, 'food-add-screen')).getByTestId('food-added')).toBeVisible();
  await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
  return screen(page, 'food-screen');
}

/** A quick add of `kcal` without macros to a meal (no fiber value, no protein). */
async function quickAdd(page: Page, meal: 'lunch', kcal: string): Promise<Locator> {
  const food = await openTab(page, 'food');
  await food.getByTestId(`meal-${meal}-add`).click();
  const add = await screen(page, 'food-add-screen');
  await add.getByTestId('food-search').fill('menu del bar');
  await add.getByTestId('quick-add-query').click();
  const quick = await screen(page, 'quick-add-form');
  await quick.getByTestId('quick-add-kcal').fill(kcal);
  await quick.getByTestId('quick-add-submit').click();
  await expect((await screen(page, 'food-add-screen')).getByTestId('food-added')).toBeVisible();
  await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
  return screen(page, 'food-screen');
}

const notes = (card: Locator) => card.locator('[data-testid^="feedback-note-"]');

test.describe('daily feedback (spec 008)', () => {
  test('a day in progress: notes, a suggestion added from its sheet, stale and update', async ({
    page,
  }) => {
    await page.clock.setFixedTime(MORNING);
    await onboard(page, 'feedback@example.com');

    // AC1: nothing logged yet → disabled with the reason.
    let food = await openTab(page, 'food');
    await expect(food.getByTestId('feedback-button')).toBeDisabled();
    await expect(food.getByTestId('feedback-blocked')).toHaveText('Registra algo primero');

    // AC4, AC6, AC8: one egg at breakfast leaves protein and fiber for lunch and dinner.
    food = await logEgg(page, 'breakfast');
    await expect(food.getByTestId('feedback-button')).toHaveText('¿Cómo va el día?');
    await food.getByTestId('feedback-button').click();
    let card = food.getByTestId('feedback-card');
    await expect(card).toBeVisible();
    await expect(notes(card)).toHaveCount(2);
    const protein = card.getByTestId('feedback-note-protein_gap');
    await expect(protein).toContainText('Aún puedes sumar proteína');
    // AC13: the numbers come from core, in a chip.
    await expect(protein.getByTestId('feedback-chip')).toContainText(/Proteína 7 \/ \d+ g/);
    // AC18: the sources and the disclaimer.
    await expect(card.getByTestId('feedback-sources')).toContainText('Jäger');
    await expect(card.getByTestId('feedback-disclaimer')).toHaveText(
      'Orientativo, no es consejo médico.',
    );

    // AC16: the suggestion opens the portion sheet on the next meal; nothing is logged before "Añadir".
    await protein.getByTestId('feedback-suggestion').first().click();
    const sheet = await screen(page, 'portion-sheet');
    await expect(sheet).toContainText('Huevo');
    await sheet.getByTestId('portion-submit').click();
    await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
    food = await screen(page, 'food-screen');
    await expect(food.getByTestId('meal-lunch')).toContainText('Huevo');

    // AC17: the items changed → stale banner → update.
    card = food.getByTestId('feedback-card');
    await expect(card.getByTestId('feedback-stale')).toContainText(
      'Has registrado algo desde entonces',
    );
    await card.getByTestId('feedback-update').click();
    await expect(card.getByTestId('feedback-stale')).toHaveCount(0);
    await expect(card.getByTestId('feedback-note-protein_gap')).toContainText(
      /Proteína 14 \/ \d+ g/,
    );
  });

  test('the training chip adds the carbohydrate note (AC10)', async ({ page }) => {
    await page.clock.setFixedTime(MORNING);
    await onboard(page, 'feedback-training@example.com');
    const food = await logEgg(page, 'breakfast');
    await food.getByTestId('feedback-training').click();
    await expect(food.getByTestId('feedback-training')).toHaveText('✓ Hoy entreno');
    await food.getByTestId('feedback-button').click();
    const card = food.getByTestId('feedback-card');
    await expect(card.locator('[data-testid^="feedback-note-"]')).toHaveCount(3);
    await expect(card.getByTestId('feedback-note-carbs_gap_training')).toBeVisible();
    await expect(card.getByTestId('feedback-sources')).toContainText('Thomas');
  });

  test('a closed day: a recap with "La próxima vez" (AC4, AC6, AC16)', async ({ page }) => {
    await page.clock.setFixedTime(NIGHT);
    await onboard(page, 'feedback-night@example.com');
    await logEgg(page, 'breakfast');
    const food = await quickAdd(page, 'lunch', '1200');
    await food.getByTestId('feedback-button').click();
    const card = food.getByTestId('feedback-card');
    const protein = card.getByTestId('feedback-note-protein_low');
    await expect(protein).toContainText('La próxima vez');
    await expect(protein.getByTestId('feedback-next-time')).toHaveText('La próxima vez: Huevo');
    await expect(protein.getByTestId('feedback-suggestion')).toHaveCount(0);
  });

  test('offline disables the button (AC1)', async ({ page }) => {
    await page.clock.setFixedTime(MORNING);
    await emulateOnlineState(page);
    await onboard(page, 'feedback-offline@example.com');
    const food = await logEgg(page, 'breakfast');
    await setOffline(page, true);
    await expect(food.getByTestId('feedback-button')).toBeDisabled();
    await expect(food.getByTestId('feedback-blocked')).toHaveText('Necesitas conexión para esto');
    await setOffline(page, false);
    await expect(food.getByTestId('feedback-button')).toBeEnabled();
  });

  test('no numeric targets (pregnancy) hides the feedback (AC2)', async ({ page }) => {
    await page.clock.setFixedTime(MORNING);
    await onboard(page, 'feedback-pregnancy@example.com', true);
    const food = await logEgg(page, 'breakfast');
    await expect(food.getByTestId('meal-breakfast')).toContainText('Huevo');
    await expect(food.getByTestId('feedback')).toHaveCount(0);
  });
});
