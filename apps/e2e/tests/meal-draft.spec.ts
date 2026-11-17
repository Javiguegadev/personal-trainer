import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  emulateOnlineState,
  fillForm,
  hasSavedWrites,
  mockRecord,
  openTab,
  screen,
  setOffline,
  signInWithEmail,
  takePhoto,
} from './app';

/**
 * The plate photo and sentence shortcuts (spec 007), on the web build with the mock backend: the mock
 * reads a sentence with simple rules and any real photo as two fried eggs with chips and oil
 * (`packages/api-client/src/mock/drafts.ts`), so the journeys test the draft screen, not the AI.
 */
interface StoredRecord {
  mealItems: { label: string; inputMethod: string; deleted: boolean }[];
  aiUsage: { feature: string }[];
}

async function stored(page: Page) {
  const record = await mockRecord<StoredRecord>(page);
  return {
    items: (record?.mealItems ?? []).filter((item) => !item.deleted),
    aiUsage: record?.aiUsage ?? [],
  };
}

async function onboard(page: Page, email: string): Promise<Locator> {
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
  await form.getByTestId('form-continue').click();
  return confirmSummary(page);
}

/** The add screen, opened from the lunch of the Food tab. */
async function openAdd(page: Page): Promise<Locator> {
  const food = await openTab(page, 'food');
  await food.getByTestId('meal-lunch-add').click();
  return screen(page, 'food-add-screen');
}

async function describe(page: Page, text: string): Promise<void> {
  await (await screen(page, 'food-add-screen')).getByTestId('food-describe').click();
  const input = await screen(page, 'meal-describe');
  await input.getByTestId('meal-describe-text').fill(text);
  await input.getByTestId('meal-describe-submit').click();
}

const SENTENCE = 'dos huevos, 200 g de arroz blanco cocido y salmorejo de mi abuela';

test.describe('plate photo and sentence (spec 007)', () => {
  test('a sentence gives a draft the user fixes before adding it, with one undo (AC2, AC4, AC6–AC8)', async ({
    page,
  }) => {
    await onboard(page, 'sentence@example.com');
    await openAdd(page);
    await describe(page, SENTENCE);

    // AC4, AC6: two foods in the order said, and the words nothing matched.
    let draft = await screen(page, 'meal-draft');
    const items = draft.getByTestId('draft-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Huevo');
    await expect(items.nth(0)).toContainText('2 × 1 huevo mediano');
    await expect(items.nth(1)).toContainText('Arroz blanco cocido');
    await expect(items.nth(1)).toContainText('200 g');
    await expect(draft.getByTestId('draft-unresolved')).toContainText(
      'No lo encuentro: «salmorejo de mi abuela»',
    );
    await expect(draft.getByTestId('draft-total')).toBeVisible();
    // What was not found is not added unless the user resolves it (domain review).
    await expect(draft.getByTestId('draft-unresolved-left')).toBeVisible();
    // Nothing is logged before the user saves the draft.
    expect((await stored(page)).items).toHaveLength(0);

    // AC7: another food for the first item, and the second one goes.
    await items.nth(0).click();
    await (await screen(page, 'draft-portion')).getByTestId('draft-change-food').click();
    const search = await screen(page, 'draft-search');
    await search.getByTestId('draft-search-field').fill('huevo cocido');
    await search
      .getByTestId('draft-search-result')
      .filter({ hasText: 'Huevo cocido' })
      .first()
      .click();
    draft = await screen(page, 'meal-draft');
    await expect(draft.getByTestId('draft-item').nth(0)).toContainText('Huevo cocido');
    await draft.getByTestId('draft-item').nth(1).click();
    await (await screen(page, 'draft-portion')).getByTestId('draft-remove').click();
    draft = await screen(page, 'meal-draft');
    await expect(draft.getByTestId('draft-item')).toHaveCount(1);

    // AC6: the unknown dish becomes a quick add of the draft.
    await draft.getByTestId('draft-unresolved-quick').click();
    const quick = await screen(page, 'quick-add-form');
    await expect(quick.getByTestId('quick-add-name')).toHaveValue('salmorejo de mi abuela');
    await quick.getByTestId('quick-add-kcal').fill('180');
    await quick.getByTestId('quick-add-submit').click();
    draft = await screen(page, 'meal-draft');
    await expect(draft.getByTestId('draft-unresolved')).toHaveCount(0);

    // AC8: both are saved to lunch with one tap.
    await expect(draft.getByTestId('draft-save')).toHaveText('Añadir 2 alimentos');
    await draft.getByTestId('draft-save').click();
    const add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-added')).toContainText('Añadidos: 2 alimentos');
    await expect
      .poll(async () => (await stored(page)).items.map((i) => [i.label, i.inputMethod]))
      .toEqual([
        ['Huevo cocido', 'text'],
        ['salmorejo de mi abuela', 'quick_add'],
      ]);
    expect((await stored(page)).aiUsage.map((u) => u.feature)).toEqual(['meal_text']);

    // AC8: one undo removes everything the draft added.
    await expect(add.getByTestId('undo-toast')).toContainText('Añadidos: 2 alimentos');
    await add.getByTestId('undo').click();
    await expect.poll(async () => (await stored(page)).items).toHaveLength(0);

    // The sentence can be used again: the draft is added and stays.
    await describe(page, 'dos huevos');
    await (await screen(page, 'meal-draft')).getByTestId('draft-save').click();
    await add.getByTestId('food-add-done').click();
    const food = await screen(page, 'food-screen');
    await expect(food.getByTestId('meal-lunch')).toContainText('Huevo');
  });

  test('a plate photo gives a draft with a probable oil the user can remove (AC3, AC5)', async ({
    page,
  }) => {
    await onboard(page, 'plate@example.com');
    const add = await openAdd(page);
    await add.getByTestId('food-plate-photo').click();
    const picker = await screen(page, 'plate-photo');
    await takePhoto(page, picker.getByTestId('plate-photo-pick'), 'photo');

    const draft = await screen(page, 'meal-draft');
    await expect(draft.getByTestId('draft-note')).toContainText('una foto no ve el aceite');
    const items = draft.getByTestId('draft-item');
    await expect(items).toHaveCount(3);
    // AC5: a medium estimate has no mark; the oil nobody can see is probable and doubtful.
    await expect(items.nth(1)).toContainText('150 g');
    await expect(items.nth(1).getByTestId('draft-mark')).toHaveCount(0);
    await expect(items.nth(2)).toContainText('Aceite de oliva virgen extra');
    await expect(items.nth(2)).toContainText('Probable');
    await expect(items.nth(2)).toContainText('Revisa la cantidad');

    await items.nth(2).click();
    await (await screen(page, 'draft-portion')).getByTestId('draft-remove').click();
    const back = await screen(page, 'meal-draft');
    await back.getByTestId('draft-save').click();
    await expect((await screen(page, 'food-add-screen')).getByTestId('food-added')).toContainText(
      'Añadidos: 2 alimentos',
    );
    await expect
      .poll(async () => (await stored(page)).items.map((i) => i.inputMethod))
      .toEqual(['photo', 'photo']);
    expect((await stored(page)).aiUsage.map((u) => u.feature)).toEqual(['meal_photo']);
  });

  test('a photo or a sentence without food says so and offers a way on (AC10)', async ({
    page,
  }) => {
    await onboard(page, 'no-food@example.com');
    const add = await openAdd(page);

    await add.getByTestId('food-plate-photo').click();
    await takePhoto(
      page,
      (await screen(page, 'plate-photo')).getByTestId('plate-photo-take'),
      'tiny',
    );
    let failed = await screen(page, 'meal-draft-failed');
    await expect(failed.getByTestId('meal-draft-failed-message')).toContainText(
      'No vemos ninguna comida ni bebida',
    );
    await expect(failed.getByTestId('meal-draft-retry')).toHaveText('Repetir foto');
    await failed.getByTestId('meal-draft-to-search').click();

    await describe(page, 'hola qué tal');
    failed = await screen(page, 'meal-draft-failed');
    await expect(failed.getByTestId('meal-draft-failed-message')).toContainText(
      'No encontramos ninguna comida en la frase',
    );
    // The sentence comes back as typed, to fix it.
    await failed.getByTestId('meal-draft-retry').click();
    await expect(
      (await screen(page, 'meal-describe')).getByTestId('meal-describe-text'),
    ).toHaveValue('hola qué tal');
    expect((await stored(page)).items).toHaveLength(0);
  });

  test('offline: no shortcuts, but a draft received online is saved and syncs once (AC1, AC8)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
    await onboard(page, 'draft-offline@example.com');
    let add = await openAdd(page);

    await setOffline(page, true);
    await expect(add.getByTestId('food-shortcuts-offline')).toBeVisible();
    await expect(add.getByTestId('food-describe')).toBeDisabled();
    await expect(add.getByTestId('food-plate-photo')).toBeDisabled();
    await setOffline(page, false);
    await expect(add.getByTestId('food-describe')).toBeEnabled();

    await describe(page, 'dos huevos y 200 g de arroz blanco cocido');
    const draft = await screen(page, 'meal-draft');
    await expect(draft.getByTestId('draft-item')).toHaveCount(2);
    await setOffline(page, true);
    await draft.getByTestId('draft-save').click();
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-added')).toContainText('Añadidos: 2 alimentos');
    await expect.poll(() => hasSavedWrites(page)).toBe(true);
    expect((await stored(page)).items).toHaveLength(0);

    // Closed and opened again without a connection; the connection returns and each item is sent once.
    await add.getByTestId('food-add-done').click();
    await screen(page, 'food-screen');
    await page.reload();
    await expect((await openTab(page, 'food')).getByTestId('meal-lunch')).toContainText('Huevo');
    await setOffline(page, false);
    await expect
      .poll(async () => (await stored(page)).items.map((i) => i.label))
      .toEqual(['Huevo', 'Arroz blanco cocido']);
    await page.reload();
    await expect((await openTab(page, 'food')).getByTestId('meal-lunch')).toContainText(
      'Arroz blanco cocido',
    );
  });
});
