import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  emulateOnlineState,
  fillForm,
  hasSavedWrites,
  localToday,
  mockRecord,
  openTab,
  screen,
  setOffline,
  signInWithEmail,
} from './app';

type Meal = 'breakfast' | 'mid_morning' | 'lunch' | 'afternoon_snack' | 'dinner' | 'other';

interface StoredItem {
  id: string;
  localDate: string;
  mealType: Meal;
  label: string;
  grams: number | null;
  servings: number | null;
  nutrients: { kcal: number };
  inputMethod: string;
  deleted: boolean;
}

/** The food log stored by the mock backend (what the server has), without the deleted items. */
async function storedItems(page: Page): Promise<StoredItem[]> {
  const record = await mockRecord<{ mealItems: StoredItem[] }>(page);
  return (record?.mealItems ?? []).filter((item) => !item.deleted);
}

/** A new account with numeric targets: 1748.75 kcal BMR × 1.4 = 2448.25 → 2450 kcal. */
async function onboard(page: Page, email: string): Promise<Locator> {
  await signInWithEmail(page, email);
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
  return confirmSummary(page);
}

/** Opens the add screen from a meal of the Food tab (AC12: the item goes to that meal). */
async function openAdd(page: Page, meal: Meal): Promise<Locator> {
  const food = await screen(page, 'food-screen');
  await food.getByTestId(`meal-${meal}-add`).click();
  return screen(page, 'food-add-screen');
}

/** "Listo": back to the Food tab. */
async function done(page: Page): Promise<Locator> {
  await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
  return screen(page, 'food-screen');
}

/** Searches and opens the portion sheet of the food with that catalog key. */
async function searchFood(page: Page, query: string, key: string): Promise<Locator> {
  const add = await screen(page, 'food-add-screen');
  await add.getByTestId('food-search').fill(query);
  await add.getByTestId('food-results').getByTestId(`food-${key}-open`).click();
  return screen(page, 'portion-sheet');
}

/** Saves the portion sheet and waits for the confirmation on the add screen (AC8). */
async function submitPortion(page: Page): Promise<Locator> {
  await (await screen(page, 'portion-sheet')).getByTestId('portion-submit').click();
  const add = await screen(page, 'food-add-screen');
  await expect(add.getByTestId('food-added')).toBeVisible();
  return add;
}

test.describe('food log (spec 005)', () => {
  test('log breakfast by serving and lunch by grams, see the totals on Food and on Today', async ({
    page,
  }) => {
    let today = await onboard(page, 'food@example.com');
    const day = await localToday(page);
    // AC17: the targets card of Today is the summary, with nothing eaten yet.
    await expect(today.getByTestId('targets-kcal')).toContainText('2450');
    await expect(today.getByTestId('summary-kcal')).toHaveText('0 kcal');

    let food = await openTab(page, 'food');
    await expect(food.getByTestId('food-first-hint')).toBeVisible();

    // AC7: the search field is focused; a new user sees a hint instead of recents and favourites.
    let add = await openAdd(page, 'breakfast');
    await expect(add.getByTestId('food-search')).toBeFocused();
    await expect(add.getByTestId('food-add-hint')).toBeVisible();

    // AC4, AC8: a word prefix finds the food; the first serving is preselected, steps of half a serving.
    let sheet = await searchFood(page, 'huev', 'd-huevo');
    await expect(sheet.getByTestId('portion-quantity-value')).toHaveText('1');
    await expect(sheet.getByTestId('portion-kcal')).toHaveText('77 kcal');
    await sheet.getByTestId('portion-quantity-increase').click();
    await expect(sheet.getByTestId('portion-quantity-value')).toHaveText('1,5');
    await sheet.getByTestId('portion-quantity-increase').click();
    // 140 kcal per 100 g × 110 g.
    await expect(sheet.getByTestId('portion-kcal')).toHaveText('154 kcal');
    add = await submitPortion(page);
    // AC8: the add screen stays open, says what was added and keeps the focus on the search.
    await expect(add.getByTestId('food-added')).toContainText(
      'Añadido: Huevo · 2 × 1 huevo mediano (110 g)',
    );
    await expect(add.getByTestId('food-search')).toBeFocused();
    food = await done(page);
    await expect(food.getByTestId('meal-breakfast')).toContainText('Huevo');
    await expect(food.getByTestId('meal-breakfast-kcal')).toHaveText('154 kcal');

    // AC8: grams. The field starts from the grams of the serving chosen so far.
    await openAdd(page, 'lunch');
    sheet = await searchFood(page, 'arroz', 'c-arroz-blanco-cocido');
    await sheet.getByTestId('portion-serving-grams').click();
    await expect(sheet.getByTestId('portion-grams')).toHaveValue('200');
    await sheet.getByTestId('portion-grams').fill('0');
    await sheet.getByTestId('portion-submit').click();
    await expect(sheet.getByRole('alert')).toBeVisible();
    await sheet.getByTestId('portion-grams').fill('180');
    // 155 kcal per 100 g × 180 g.
    await expect(sheet.getByTestId('portion-kcal')).toHaveText('279 kcal');
    await submitPortion(page);
    food = await done(page);

    // AC15, AC16: each meal with its items and its total; the summary says what is left.
    await expect(food.getByTestId('meal-lunch')).toContainText('Arroz blanco cocido');
    await expect(food.getByTestId('meal-lunch')).toContainText('180 g');
    await expect(food.getByTestId('summary-kcal')).toHaveText('433 kcal');
    await expect(food.getByTestId('summary-remaining')).toHaveText('Te quedan 2017 kcal');
    await expect(food.getByTestId('food-first-hint')).toHaveCount(0);

    // AC9: the server stores the snapshot it computed from the catalog.
    await expect
      .poll(async () =>
        (await storedItems(page)).map((i) => [i.localDate, i.mealType, i.label, i.nutrients.kcal]),
      )
      .toEqual([
        [day, 'breakfast', 'Huevo', 154],
        [day, 'lunch', 'Arroz blanco cocido', 279],
      ]);

    // AC17: Today shows the same totals.
    today = await openTab(page, 'today');
    await expect(today.getByTestId('summary-kcal')).toHaveText('433 kcal');
    await expect(today.getByTestId('summary-remaining')).toHaveText('Te quedan 2017 kcal');

    // AC12: from Today the meal is preselected and can be changed with chips. AC7, AC8: the recents come
    // with the portion used the last time.
    await today.getByTestId('log-food').click();
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-add-meal').locator('[aria-checked="true"]')).toHaveCount(1);
    await add.getByTestId('food-add-meal-afternoon_snack').click();
    await add.getByTestId('food-recents').getByTestId('food-d-huevo-open').click();
    sheet = await screen(page, 'portion-sheet');
    await expect(sheet.getByTestId('portion-quantity-value')).toHaveText('2');
    await submitPortion(page);
    await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
    today = await screen(page, 'today-screen');
    await expect(today.getByTestId('summary-kcal')).toHaveText('587 kcal');
    food = await openTab(page, 'food');
    await expect(food.getByTestId('meal-afternoon_snack')).toContainText('Huevo');
  });

  test('favourites, quick add, move, and delete with undo', async ({ page }) => {
    await onboard(page, 'food-edit@example.com');
    await openTab(page, 'food');

    // AC14: the star of a search result; the food is then one tap away in the favourites.
    let add = await openAdd(page, 'dinner');
    await add.getByTestId('food-search').fill('leche semi');
    const star = add.getByTestId('food-results').getByTestId('food-c-leche-semidesnatada-star');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await add.getByTestId('food-search').fill('');
    await add.getByTestId('food-favourites').getByTestId('food-c-leche-semidesnatada-open').click();
    await submitPortion(page);

    // AC6: nothing found → quick add with the search as its name.
    add = await screen(page, 'food-add-screen');
    await add.getByTestId('food-search').fill('menu del bar');
    await add.getByTestId('quick-add-query').click();
    const quick = await screen(page, 'quick-add-form');
    await expect(quick.getByTestId('quick-add-name')).toHaveValue('menu del bar');
    // AC10: the kcal are required, and macros worth far more than the kcal ask for confirmation.
    await quick.getByTestId('quick-add-submit').click();
    await expect(quick.getByRole('alert')).toBeVisible();
    await quick.getByTestId('quick-add-kcal').fill('100');
    await quick.getByTestId('quick-add-fat').fill('50');
    await quick.getByTestId('quick-add-submit').click();
    await expect(quick.getByTestId('quick-add-confirm')).toBeVisible();
    await quick.getByTestId('quick-add-fat').fill('5');
    await quick.getByTestId('quick-add-submit').click();
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-added')).toContainText('Añadido: menu del bar');
    let food = await done(page);

    // 47.7 kcal per 100 g × 250 g = 119.25, plus 100.
    const dinner = food.getByTestId('meal-dinner');
    await expect(dinner.getByTestId('meal-item')).toHaveCount(2);
    await expect(food.getByTestId('meal-dinner-kcal')).toHaveText('219 kcal');
    await expect.poll(async () => (await storedItems(page)).length).toBe(2);

    // AC11: delete with an undo instead of a confirmation.
    await dinner.getByTestId('meal-item').filter({ hasText: 'menu del bar' }).click();
    await (await screen(page, 'food-item-sheet')).getByTestId('delete-item').click();
    food = await screen(page, 'food-screen');
    await expect(dinner.getByTestId('meal-item')).toHaveCount(1);
    await expect(food.getByTestId('summary-kcal')).toHaveText('119 kcal');
    await expect(food.getByTestId('undo-toast')).toContainText('Borrado: menu del bar');
    await food.getByTestId('undo').click();
    await expect(dinner.getByTestId('meal-item')).toHaveCount(2);
    await expect(food.getByTestId('undo-toast')).toHaveCount(0);
    await expect.poll(async () => (await storedItems(page)).length).toBe(2);

    // Without the undo, the offer goes away after 5 seconds and the item stays deleted.
    await dinner.getByTestId('meal-item').filter({ hasText: 'menu del bar' }).click();
    await (await screen(page, 'food-item-sheet')).getByTestId('delete-item').click();
    food = await screen(page, 'food-screen');
    await expect(food.getByTestId('undo-toast')).toBeVisible();
    await expect(food.getByTestId('undo-toast')).toHaveCount(0, { timeout: 8000 });
    await expect(dinner.getByTestId('meal-item')).toHaveCount(1);
    await expect
      .poll(async () => (await storedItems(page)).map((i) => i.label))
      .toEqual(['Leche semidesnatada']);

    // AC11: another portion and another meal.
    await dinner.getByTestId('meal-item').click();
    const sheet = await screen(page, 'food-item-sheet');
    await sheet.getByTestId('portion-quantity-increase').click();
    await sheet.getByTestId('item-meal-breakfast').click();
    await sheet.getByTestId('portion-submit').click();
    food = await screen(page, 'food-screen');
    await expect(dinner.getByTestId('meal-item')).toHaveCount(0);
    await expect(food.getByTestId('meal-breakfast')).toContainText('1,5 × 1 vaso (375 g)');
    await expect
      .poll(async () => (await storedItems(page)).map((i) => [i.mealType, i.servings, i.grams]))
      .toEqual([['breakfast', 1.5, 375]]);
  });

  test('repeat yesterday copies the meal as new items, with undo (AC13)', async ({ page }) => {
    await onboard(page, 'food-repeat@example.com');
    const food = await openTab(page, 'food');
    const day = await localToday(page);
    const breakfast = food.getByTestId('meal-breakfast');

    // AC15: yesterday is one of the day chips.
    await food.getByTestId('food-day').getByRole('radio').nth(1).click();
    await openAdd(page, 'breakfast');
    await searchFood(page, 'platano', 'b-platano');
    await submitPortion(page);
    await searchFood(page, 'huevo', 'd-huevo');
    await submitPortion(page);
    await done(page);
    await expect(breakfast.getByTestId('meal-item')).toHaveCount(2);
    await expect(food.getByTestId('meal-breakfast-repeat')).toHaveCount(0);

    // Today the meal is empty: one tap copies yesterday's.
    await food.getByTestId('food-day').getByRole('radio').nth(0).click();
    await expect(breakfast.getByTestId('meal-item')).toHaveCount(0);
    await expect(food.getByTestId('meal-breakfast-repeat')).toContainText('2 alimentos');
    await food.getByTestId('meal-breakfast-repeat').click();
    await expect(breakfast.getByTestId('meal-item')).toHaveCount(2);
    await expect(food.getByTestId('undo-toast')).toContainText('Copiado de ayer: 2 alimentos');

    // Undo removes the copies and the offer comes back.
    await food.getByTestId('undo').click();
    await expect(breakfast.getByTestId('meal-item')).toHaveCount(0);
    await food.getByTestId('meal-breakfast-repeat').click();
    await expect(breakfast.getByTestId('meal-item')).toHaveCount(2);

    await expect
      .poll(async () => {
        const items = await storedItems(page);
        return {
          today: items.filter((i) => i.localDate === day).map((i) => [i.label, i.inputMethod]),
          ids: new Set(items.map((i) => i.id)).size,
        };
      })
      .toEqual({
        today: [
          ['Plátano', 'repeat'],
          ['Huevo', 'repeat'],
        ],
        ids: 4,
      });
  });

  test('an item added offline survives a reload and syncs once (AC6, AC19, AC20)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
    await onboard(page, 'food-offline@example.com');
    await openTab(page, 'food');
    await openAdd(page, 'breakfast');
    await searchFood(page, 'huevo', 'd-huevo');
    const online = await submitPortion(page);
    // The recents are refreshed once the write is stored; the offline cache keeps them (AC19).
    await expect(online.getByTestId('food-recents')).toContainText('Huevo');
    await done(page);
    await expect.poll(async () => (await storedItems(page)).length).toBe(1);

    // AC6: without a connection the search says so; recents and favourites still work.
    await setOffline(page, true);
    const add = await openAdd(page, 'lunch');
    await expect(add.getByTestId('food-search-offline')).toBeVisible();
    await add.getByTestId('food-search').fill('arroz');
    await expect(add.getByTestId('food-results')).toHaveCount(0);
    await add.getByTestId('food-recents').getByTestId('food-d-huevo-open').click();
    await submitPortion(page);
    let food = await done(page);

    // AC19: the item shows at once, marked "waiting to sync"; the server does not have it.
    const lunch = food.getByTestId('meal-lunch');
    await expect(lunch.getByTestId('meal-item')).toHaveCount(1);
    await expect(lunch.getByTestId('sync-badge')).toBeVisible();
    expect(await storedItems(page)).toHaveLength(1);

    // The app is closed and opened again, still offline: the item and its mark are still there.
    await expect.poll(() => hasSavedWrites(page)).toBe(true);
    await page.reload();
    food = await openTab(page, 'food');
    await expect(food.getByTestId('meal-lunch').getByTestId('meal-item')).toHaveCount(1);
    await expect(food.getByTestId('meal-lunch').getByTestId('sync-badge')).toBeVisible();
    expect(await storedItems(page)).toHaveLength(1);

    // Back online: the write is sent once (one item with that id) and the mark goes away.
    await setOffline(page, false);
    await expect(food.getByTestId('sync-badge')).toHaveCount(0);
    await expect
      .poll(async () => (await storedItems(page)).map((i) => i.mealType))
      .toEqual(['breakfast', 'lunch']);
    await page.reload();
    food = await openTab(page, 'food');
    await expect(food.getByTestId('meal-lunch').getByTestId('meal-item')).toHaveCount(1);
  });

  test('a 5-meal day is logged from recents in under a minute', async ({ page }) => {
    await onboard(page, 'food-fast@example.com');
    await openTab(page, 'food');
    // Not timed: what the user ate before, so the recents exist.
    await openAdd(page, 'other');
    for (const [query, key] of [
      ['huevo', 'd-huevo'],
      ['leche semi', 'c-leche-semidesnatada'],
      ['platano', 'b-platano'],
    ] as const) {
      await searchFood(page, query, key);
      await submitPortion(page);
    }
    await done(page);

    // The proxy of "a full day in under 1 minute" (BLUEPRINT §7): two foods in each of the five meals.
    const meals: Meal[] = ['breakfast', 'mid_morning', 'lunch', 'afternoon_snack', 'dinner'];
    const start = Date.now();
    for (const meal of meals) {
      const add = await openAdd(page, meal);
      for (const key of ['d-huevo', 'b-platano']) {
        await add.getByTestId('food-recents').getByTestId(`food-${key}-open`).click();
        await submitPortion(page);
      }
      await done(page);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(60_000);

    const food = await screen(page, 'food-screen');
    for (const meal of meals) {
      await expect(food.getByTestId(`meal-${meal}`).getByTestId('meal-item')).toHaveCount(2);
    }
    await expect.poll(async () => (await storedItems(page)).length).toBe(13);
  });
});
