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
} from './app';

/**
 * Barcodes, the user's own foods and the label photo (spec 006), on the web build with the mock
 * backend. In a browser the code is typed (the camera scanner is for the phone), and the "photo" is a
 * file given to the picker. Codes of `packages/api-client/src/mock/products.ts`.
 */
const NUTELLA = '3017620422003';
const COLA = '5449000214911';
const WINE = '8410261211015';
const UNKNOWN = '8410000000009';
const INCOMPLETE = '3033710065967';

interface StoredItem {
  id: string;
  foodId: string | null;
  label: string;
  grams: number | null;
  unit: 'g' | 'ml';
  nutrients: { kcal: number };
  inputMethod: string;
  deleted: boolean;
}
interface StoredFood {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  origin: string;
}
interface StoredRecord {
  mealItems: StoredItem[];
  customFoods: StoredFood[];
  aiUsage: { feature: string }[];
}

async function stored(page: Page) {
  const record = await mockRecord<StoredRecord>(page);
  return {
    items: (record?.mealItems ?? []).filter((item) => !item.deleted),
    foods: record?.customFoods ?? [],
    aiUsage: record?.aiUsage ?? [],
  };
}

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

/** The add screen, opened from the breakfast of the Food tab. */
async function openAdd(page: Page): Promise<Locator> {
  const food = await openTab(page, 'food');
  await food.getByTestId('meal-breakfast-add').click();
  return screen(page, 'food-add-screen');
}

/** "Escanear" → the code typed by hand → whatever screen the lookup opens. */
async function scan(page: Page, code: string, opens: string): Promise<Locator> {
  await (await screen(page, 'food-add-screen')).getByTestId('food-scan').click();
  const scanner = await screen(page, 'barcode-scanner');
  await scanner.getByTestId('barcode-input').fill(code);
  await scanner.getByTestId('barcode-submit').click();
  return screen(page, opens);
}

async function submitPortion(page: Page): Promise<Locator> {
  await (await screen(page, 'portion-sheet')).getByTestId('portion-submit').click();
  const add = await screen(page, 'food-add-screen');
  await expect(add.getByTestId('food-added')).toBeVisible();
  return add;
}

/** Fills the custom-food form: a yogurt of 61 kcal per 100 g, with a serving of 125 g. */
async function fillYogurt(form: Locator): Promise<void> {
  await form.getByTestId('custom-food-name').fill('Yogur de casa');
  await form.getByTestId('custom-food-brand').fill('La Granja');
  await form.getByTestId('custom-food-kcal').fill('61');
  await form.getByTestId('custom-food-protein').fill('3,5');
  await form.getByTestId('custom-food-carbs').fill('4,7');
  await form.getByTestId('custom-food-fat').fill('3,1');
  await form.getByTestId('custom-food-serving-size').fill('125');
}

/** A JPEG drawn in the page: big enough to be "a label" for the mock, or a few pixels. */
async function jpeg(page: Page, kind: 'label' | 'tiny'): Promise<Buffer> {
  const base64 = await page.evaluate(
    (size) => {
      // The tests are compiled without the DOM library: only what the drawing needs is typed.
      interface Canvas {
        width: number;
        height: number;
        getContext(kind: '2d'): {
          fillStyle: string;
          fillRect(x: number, y: number, w: number, h: number): void;
        };
        toDataURL(type: string, quality: number): string;
      }
      const { document } = globalThis as unknown as {
        document: { createElement(tag: 'canvas'): Canvas };
      };
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      // Noise does not compress, so the file is as large as a real photo of that size.
      for (let y = 0; y < size; y += 4) {
        for (let x = 0; x < size; x += 4) {
          context.fillStyle = `rgb(${(x * 7 + y * 3) % 256}, ${(x * 13) % 256}, ${(y * 11) % 256})`;
          context.fillRect(x, y, 4, 4);
        }
      }
      return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!;
    },
    kind === 'label' ? 600 : 2,
  );
  return Buffer.from(base64, 'base64');
}

/** Presses a button that opens the system picker and gives it the photo. */
async function takePhoto(page: Page, button: Locator, kind: 'label' | 'tiny'): Promise<void> {
  const buffer = await jpeg(page, kind);
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name: 'etiqueta.jpg', mimeType: 'image/jpeg', buffer });
}

test.describe('barcode, own foods and label photo (spec 006)', () => {
  test('log products by their barcode: a spread in grams, a drink in millilitres (AC1–AC5)', async ({
    page,
  }) => {
    await onboard(page, 'barcode@example.com');
    let add = await openAdd(page);

    // AC2: a code with a wrong check digit is refused under the field, without a lookup.
    await add.getByTestId('food-scan').click();
    const scanner = await screen(page, 'barcode-scanner');
    await scanner.getByTestId('barcode-input').fill('3017620422004');
    await scanner.getByTestId('barcode-submit').click();
    await expect(scanner.getByRole('alert')).toBeVisible();
    await scanner.getByTestId('barcode-back').click();
    await screen(page, 'food-add-screen');

    // AC3–AC5: the product opens in the portion sheet with its brand, its serving and its notes.
    let sheet = await scan(page, NUTELLA, 'portion-sheet');
    await expect(sheet).toContainText('Nutella');
    await expect(sheet.getByTestId('portion-brand')).toHaveText('Ferrero');
    // 539 kcal per 100 g × 15 g.
    await expect(sheet.getByTestId('portion-kcal')).toHaveText('81 kcal');
    await expect(sheet.getByTestId('portion-total')).toHaveText('15 g en total');
    await expect(sheet.getByTestId('product-allergens')).toContainText(
      'Alérgenos declarados: leche, frutos de cáscara y soja',
    );
    await expect(sheet.getByTestId('product-allergens')).toContainText(
      'Comprueba siempre el envase',
    );
    await expect(sheet.getByTestId('product-source')).toHaveText('Datos de Open Food Facts');
    await expect(sheet.getByTestId('product-check-values')).toHaveCount(0);
    add = await submitPortion(page);
    await expect(add.getByTestId('food-added')).toContainText('Nutella');

    // A drink is measured in millilitres, and has no allergen note when the source declares none.
    sheet = await scan(page, COLA, 'portion-sheet');
    await expect(sheet.getByTestId('portion-total')).toHaveText('330 ml en total');
    await expect(sheet.getByTestId('product-allergens')).toHaveCount(0);
    add = await submitPortion(page);
    await expect(add.getByTestId('food-added')).toContainText('330 ml');

    // AC5: energy that the macros do not explain asks to check the package.
    sheet = await scan(page, WINE, 'portion-sheet');
    await expect(sheet.getByTestId('product-check-values')).toBeVisible();
    await sheet.getByTestId('portion-cancel').click();

    // The products are now recents of this user, and their search finds them by brand.
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-recents')).toContainText('Nutella');
    await add.getByTestId('food-search').fill('ferrero');
    await expect(add.getByTestId('food-results')).toContainText('Nutella');

    await expect
      .poll(async () =>
        (await stored(page)).items.map((i) => [i.label, i.grams, i.unit, i.inputMethod]),
      )
      .toEqual([
        ['Nutella', 15, 'g', 'barcode'],
        ['Coca-Cola', 330, 'ml', 'barcode'],
      ]);
  });

  test('an unknown code: fill the form by hand, log it, and find it again by code and by search (AC6, AC9–AC11)', async ({
    page,
  }) => {
    await onboard(page, 'custom@example.com');
    await openAdd(page);

    const miss = await scan(page, UNKNOWN, 'product-not-found');
    await expect(miss.getByTestId('product-miss-title')).toHaveText('No tenemos este producto');
    await expect(miss.getByTestId('product-miss-not_found')).toContainText(UNKNOWN);
    await miss.getByTestId('product-by-hand').click();

    const form = await screen(page, 'custom-food-form');
    await expect(form.getByTestId('custom-food-barcode')).toContainText(UNKNOWN);
    // AC9: the four values are required.
    await form.getByTestId('custom-food-name').fill('Yogur de casa');
    await form.getByTestId('custom-food-submit').click();
    await expect(form.getByRole('alert')).toHaveCount(4);
    await fillYogurt(form);
    // AC10: calories far from the macros ask for a confirmation before saving.
    await form.getByTestId('custom-food-kcal').fill('610');
    await form.getByTestId('custom-food-submit').click();
    await expect(form.getByTestId('custom-food-confirm')).toBeVisible();
    await form.getByTestId('custom-food-kcal').fill('61');
    await form.getByTestId('custom-food-submit').click();

    // AC11: a new food is for logging now, by its serving.
    const sheet = await screen(page, 'portion-sheet');
    await expect(sheet).toContainText('Yogur de casa');
    await expect(sheet.getByTestId('portion-brand')).toHaveText('La Granja');
    await expect(sheet.getByTestId('portion-total')).toHaveText('125 g en total');
    // 61 kcal per 100 g × 125 g.
    await expect(sheet.getByTestId('portion-kcal')).toHaveText('76 kcal');
    await submitPortion(page);

    // The same code now opens the user's own food, and the search finds it by name and by brand.
    await expect(
      (await scan(page, UNKNOWN, 'portion-sheet')).getByTestId('portion-brand'),
    ).toHaveText('La Granja');
    await (await screen(page, 'portion-sheet')).getByTestId('portion-cancel').click();
    const add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-mine')).toContainText('Yogur de casa');
    await add.getByTestId('food-search').fill('granja');
    await expect(add.getByTestId('food-results')).toContainText('Yogur de casa');

    await expect
      .poll(async () => {
        const { items, foods } = await stored(page);
        return {
          foods: foods.map((f) => [f.name, f.brand, f.barcode, f.origin]),
          items: items.map((i) => [i.label, i.grams, i.inputMethod, i.foodId === foods[0]?.id]),
        };
      })
      .toEqual({
        foods: [['Yogur de casa', 'La Granja', UNKNOWN, 'manual']],
        items: [['Yogur de casa', 125, 'custom', true]],
      });
  });

  test('a label photo fills the form as a draft the user checks and saves (AC6, AC14–AC17)', async ({
    page,
  }) => {
    await onboard(page, 'label@example.com');
    await openAdd(page);

    // AC4, AC6: a product without usable values offers the same options.
    const miss = await scan(page, INCOMPLETE, 'product-not-found');
    await expect(miss.getByTestId('product-miss-incomplete')).toContainText(INCOMPLETE);

    // AC14–AC16: the photo is read and fills the form; nothing is saved yet.
    await takePhoto(page, miss.getByTestId('product-label-photo'), 'label');
    const form = await screen(page, 'custom-food-form');
    await expect(form.getByTestId('label-done')).toBeVisible();
    await expect(form.getByTestId('custom-food-name')).toHaveValue('Galletas María');
    await expect(form.getByTestId('custom-food-kcal')).toHaveValue('436');
    await expect(form.getByTestId('custom-food-protein')).toHaveValue('7,1');
    await expect(form.getByTestId('custom-food-carbs')).toHaveValue('76');
    await expect(form.getByTestId('custom-food-fat')).toHaveValue('10,5');
    await expect(form.getByTestId('custom-food-fiber')).toHaveValue('');
    await expect(form.getByTestId('custom-food-serving-size')).toHaveValue('30');
    await expect(form.getByText('Leído de la foto')).toHaveCount(6);
    expect((await stored(page)).foods).toEqual([]);

    // AC17: a photo that is not a label says so and keeps what the form had.
    await takePhoto(page, form.getByTestId('label-take-photo'), 'tiny');
    await expect(form.getByTestId('label-unreadable')).toContainText(
      'no se ve una tabla de valores nutricionales',
    );
    await expect(form.getByTestId('custom-food-kcal')).toHaveValue('436');

    // The user corrects a value (the mark goes) and saves: the food is theirs, made from a label.
    await form.getByTestId('custom-food-fat').fill('11');
    await expect(form.getByText('Leído de la foto')).toHaveCount(5);
    await form.getByTestId('custom-food-submit').click();
    const sheet = await screen(page, 'portion-sheet');
    await expect(sheet.getByTestId('portion-total')).toHaveText('30 g en total');
    await submitPortion(page);

    await expect
      .poll(async () => {
        const { items, foods, aiUsage } = await stored(page);
        return {
          foods: foods.map((f) => [f.name, f.barcode, f.origin]),
          items: items.map((i) => [i.label, i.grams, i.inputMethod]),
          reads: aiUsage.map((u) => u.feature),
        };
      })
      .toEqual({
        foods: [['Galletas María', INCOMPLETE, 'label']],
        items: [['Galletas María', 30, 'label']],
        // Two reads, each metered (AC18).
        reads: ['label_scan', 'label_scan'],
      });
  });

  test('edit and delete an own food; the logged item stays (AC12)', async ({ page }) => {
    await onboard(page, 'mine@example.com');
    let add = await openAdd(page);

    await add.getByTestId('custom-food-open').click();
    let form = await screen(page, 'custom-food-form');
    await fillYogurt(form);
    await form.getByTestId('custom-food-submit').click();
    await submitPortion(page);

    // Edit: the form opens with its values; later logs use the new ones.
    add = await screen(page, 'food-add-screen');
    await add.getByTestId('food-mine').getByText('Yogur de casa').click();
    await (await screen(page, 'portion-sheet')).getByTestId('custom-food-edit').click();
    form = await screen(page, 'custom-food-form');
    await expect(form.getByTestId('custom-food-kcal')).toHaveValue('61');
    await form.getByTestId('custom-food-name').fill('Yogur griego');
    await form.getByTestId('custom-food-submit').click();
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-added')).toContainText('Guardado: Yogur griego');
    await expect(add.getByTestId('food-mine')).toContainText('Yogur griego');

    // Delete with undo: the food comes back and nothing reached the server.
    await add.getByTestId('food-mine').getByText('Yogur griego').click();
    await (await screen(page, 'portion-sheet')).getByTestId('custom-food-delete').click();
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('undo-toast')).toContainText('Borrado: Yogur griego');
    await expect(add.getByTestId('food-mine')).toHaveCount(0);
    await add.getByTestId('undo').click();
    await expect(add.getByTestId('food-mine')).toContainText('Yogur griego');
    expect((await stored(page)).foods.map((f) => f.name)).toEqual(['Yogur griego']);

    // Delete without undo: after the 5 seconds the food is gone and its item keeps its snapshot.
    await add.getByTestId('food-mine').getByText('Yogur griego').click();
    await (await screen(page, 'portion-sheet')).getByTestId('custom-food-delete').click();
    add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('undo-toast')).toBeVisible();
    await expect(add.getByTestId('undo-toast')).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(async () => {
        const { items, foods } = await stored(page);
        return { foods: foods.length, items: items.map((i) => [i.label, i.grams, i.foodId]) };
      })
      .toEqual({ foods: 0, items: [['Yogur de casa', 125, null]] });
    await add.getByTestId('food-add-done').click();
    const food = await screen(page, 'food-screen');
    await expect(food.getByTestId('meal-breakfast')).toContainText('Yogur de casa');
  });

  test('a food created offline survives a reload and syncs once, before its item (AC8, AC11)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
    await onboard(page, 'offline-food@example.com');
    await openAdd(page);
    await setOffline(page, true);

    // AC8: without a connection an unknown code cannot be looked up; the form by hand still works.
    const miss = await scan(page, NUTELLA, 'product-not-found');
    await expect(miss.getByTestId('product-miss-offline')).toBeVisible();
    await expect(miss.getByTestId('product-label-photo')).toHaveCount(0);
    await miss.getByTestId('product-by-hand').click();
    const form = await screen(page, 'custom-food-form');
    await expect(form.getByTestId('label-offline')).toBeVisible();
    await fillYogurt(form);
    await form.getByTestId('custom-food-submit').click();
    await submitPortion(page);
    expect((await stored(page)).foods).toEqual([]);

    // AC8: the code of a food the device holds opens it, still offline.
    await expect(
      (await scan(page, NUTELLA, 'portion-sheet')).getByTestId('portion-brand'),
    ).toHaveText('La Granja');
    await (await screen(page, 'portion-sheet')).getByTestId('portion-cancel').click();

    // The app is closed and opened again, still offline: the food and its item are still there.
    await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
    await screen(page, 'food-screen');
    await expect.poll(() => hasSavedWrites(page)).toBe(true);
    await page.reload();
    let food = await openTab(page, 'food');
    await expect(food.getByTestId('meal-breakfast')).toContainText('Yogur de casa');
    expect((await stored(page)).foods).toEqual([]);
    // The user's own foods are in the offline cache, so the food can be logged again (AC19 of 005).
    await food.getByTestId('meal-breakfast-add').click();
    await expect((await screen(page, 'food-add-screen')).getByTestId('food-mine')).toContainText(
      'Yogur de casa',
    );
    await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
    await screen(page, 'food-screen');

    await setOffline(page, false);
    await expect
      .poll(async () => {
        const { items, foods } = await stored(page);
        return {
          foods: foods.map((f) => [f.name, f.barcode]),
          items: items.map((i) => [i.label, i.inputMethod, i.foodId === foods[0]?.id]),
        };
      })
      .toEqual({
        foods: [['Yogur de casa', NUTELLA]],
        // The item reached the server after its food: it still points to it.
        items: [['Yogur de casa', 'custom', true]],
      });
    await page.reload();
    food = await openTab(page, 'food');
    await expect(food.getByTestId('meal-breakfast')).toContainText('Yogur de casa');
    const add = await openAdd(page);
    await expect(add.getByTestId('food-mine')).toContainText('Yogur de casa');
  });
});
