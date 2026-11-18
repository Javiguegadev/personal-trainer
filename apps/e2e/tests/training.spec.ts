import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  emulateOnlineState,
  fillForm,
  localToday,
  mockRecord,
  openTab,
  screen,
  setOffline,
  signInWithEmail,
} from './app';

interface StoredWorkout {
  id: string;
  localDate: string;
  kind: string;
  activity: string | null;
  name: string | null;
  minutes: number;
  exercises: { label: string; sets: { reps: number | null; weightKg: number | null }[] }[];
  deleted: boolean;
}

/** The workouts stored by the mock backend (what the server has), without the deleted ones. */
async function storedWorkouts(page: Page): Promise<StoredWorkout[]> {
  const record = await mockRecord<{ workouts: StoredWorkout[] }>(page);
  return (record?.workouts ?? []).filter((w) => !w.deleted);
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

/** AC6: "Empezar entreno" opens the session screen. */
async function startSession(page: Page): Promise<Locator> {
  const training = await openTab(page, 'training');
  await training.getByTestId('training-start').click();
  return screen(page, 'session-screen');
}

/** AC5, AC7: several exercises in one visit to the picker, found by search on the device. */
async function addExercises(page: Page, picks: [query: string, key: string][]): Promise<Locator> {
  await (await screen(page, 'session-screen')).getByTestId('session-add-exercise').click();
  const picker = await screen(page, 'exercise-picker');
  for (const [query, key] of picks) {
    await picker.getByTestId('picker-search').fill(query);
    await picker.getByTestId(`exercise-option-${key}`).click();
  }
  await picker.getByTestId('picker-add').click();
  return screen(page, 'session-screen');
}

/** AC8: a weight-and-reps set typed, then ✓. */
async function logSet(session: Locator, exercise: number, set: number, kg: string, reps: string) {
  const row = `exercise-${exercise}-set-${set}`;
  await session.getByTestId(`${row}-weight`).fill(kg);
  await session.getByTestId(`${row}-reps`).fill(reps);
  await session.getByTestId(`${row}-complete`).click();
  await expect(session.getByTestId(`${row}-complete`)).toHaveAttribute('aria-checked', 'true');
}

/** AC12: "Terminar" → summary → "Guardar"; back on the Training tab. */
async function finish(page: Page, name?: string): Promise<Locator> {
  await (await screen(page, 'session-screen')).getByTestId('session-finish').click();
  const sheet = await screen(page, 'finish-sheet');
  if (name) await sheet.getByTestId('finish-name').fill(name);
  await sheet.getByTestId('finish-save').click();
  return screen(page, 'training-screen');
}

test('a live session with two exercises, the rest timer, a record, Today and repeat', async ({
  page,
}) => {
  await onboard(page, 'training-live@example.com');
  const training = await openTab(page, 'training');
  await expect(training.getByTestId('training-first-hint')).toBeVisible();

  let session = await startSession(page);
  await expect(session.getByTestId('session-elapsed')).toBeVisible();
  session = await addExercises(page, [
    ['banca', 'press-banca'],
    ['sentadila', 'sentadilla'], // one typo (AC3)
  ]);
  // Never done: 3 empty sets and no "Última vez" (AC7).
  await expect(session.getByTestId('exercise-0-last')).toContainText('Primera vez');
  await expect(session.getByTestId('exercise-0-set-2')).toBeVisible();
  await expect(session.getByTestId('exercise-0-set-0-complete')).toBeDisabled();

  await logSet(session, 0, 0, '60', '8');
  // AC9: the rest timer starts at 90 s, with −15 s / +15 s and "Saltar".
  const timer = page.getByTestId('rest-timer');
  await expect(timer.getByTestId('rest-remaining')).toContainText('1:');
  await timer.getByTestId('rest-more').click();
  await expect(timer.getByTestId('rest-remaining')).toContainText(/1:4\d/);
  await timer.getByTestId('rest-skip').click();
  await expect(timer).toBeHidden();

  // "Añadir serie" copies the last set; the extra third set is removed.
  await logSet(session, 0, 1, '60', '8');
  await session.getByTestId('exercise-0-remove-set').click();
  await expect(session.getByTestId('exercise-0-set-2')).toBeHidden();

  // Steppers only: 4 × 2.5 kg and 5 reps.
  for (let i = 0; i < 4; i++) await session.getByTestId('exercise-1-set-0-weight-more').click();
  for (let i = 0; i < 5; i++) await session.getByTestId('exercise-1-set-0-reps-more').click();
  await expect(session.getByTestId('exercise-1-set-0-weight')).toHaveValue('10');
  await session.getByTestId('exercise-1-set-0-complete').click();

  await session.getByTestId('session-finish').click();
  const sheet = await screen(page, 'finish-sheet');
  await expect(sheet.getByTestId('finish-sets')).toHaveText('3');
  await expect(sheet.getByTestId('finish-volume')).toHaveText('1010 kg');
  await sheet.getByTestId('finish-name').fill('Pierna');
  await sheet.getByTestId('finish-save').click();
  const tab = await screen(page, 'training-screen');
  await expect(tab.getByTestId('training-history')).toContainText('Pierna');

  // Only the completed sets were saved (AC12).
  await expect.poll(async () => (await storedWorkouts(page)).length).toBe(1);
  const [saved] = await storedWorkouts(page);
  expect(saved!.exercises.map((e) => e.sets.length)).toEqual([2, 1]);

  // AC21: Today shows what was done.
  const today = await openTab(page, 'today');
  await expect(today.getByTestId('today-training-done')).toContainText('Pierna');

  // AC18: "Repetir" prefills last time's values; AC10: beating 60 kg shows a record.
  const training2 = await openTab(page, 'training');
  await training2.getByTestId('training-repeat-0').click();
  session = await screen(page, 'session-screen');
  await expect(session.getByTestId('exercise-0-last')).toContainText('2 × 8 · 60 kg');
  await session.getByTestId('exercise-0-set-0-complete').click(); // the placeholder becomes the value
  await expect(session.getByTestId('exercise-0-set-0-record-heaviestKg')).toBeHidden();
  await session.getByTestId('exercise-0-set-1-weight').fill('62,5');
  await session.getByTestId('exercise-0-set-1-complete').click();
  await expect(session.getByTestId('exercise-0-set-1-record-heaviestKg')).toContainText('62,5 kg');
  const after = await finish(page);
  await expect(after.getByTestId('workout-record').first()).toBeVisible();
});

test('a session survives a reload and continues (AC11)', async ({ page }) => {
  await onboard(page, 'training-reload@example.com');
  await startSession(page);
  const session = await addExercises(page, [['press banca', 'press-banca']]);
  await logSet(session, 0, 0, '50', '10');

  // The app reopens where it was, with the session as it was left.
  await page.reload();
  const restored = await screen(page, 'session-screen');
  await expect(restored.getByTestId('exercise-0-set-0-complete')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(restored.getByTestId('exercise-0-set-0-weight')).toHaveValue('50');
  // The Training tab shows it instead of a second "Empezar entreno" (AC6).
  await page.goto('/training');
  const training = await screen(page, 'training-screen');
  await expect(training.getByTestId('session-in-progress')).toBeVisible();
  await expect(training.getByTestId('training-start')).toBeHidden();
  await training.getByTestId('session-continue').click();
  await expect(await screen(page, 'session-screen')).toBeVisible();
});

test('an activity for yesterday, edited, then deleted and undone (AC16, AC19)', async ({
  page,
}) => {
  await onboard(page, 'training-activity@example.com');
  const training = await openTab(page, 'training');
  await training.getByTestId('training-log-activity').click();
  const sheet = await screen(page, 'activity-sheet');
  const today = await localToday(page);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  await sheet.getByTestId('activity-type-a:football').click();
  await sheet.getByTestId(`activity-day-${yesterday}`).click();
  await sheet.getByTestId('activity-minutes-90').click();
  await sheet.getByTestId('activity-save').click();

  let tab = await screen(page, 'training-screen');
  await expect(tab.getByTestId('training-history')).toContainText('Ayer · Fútbol');
  await expect
    .poll(async () => (await storedWorkouts(page)).map((w) => [w.kind, w.localDate, w.minutes]))
    .toEqual([['sport', yesterday, 90]]);

  const [stored] = await storedWorkouts(page);
  await tab.getByTestId(`workout-${stored!.id}`).click();
  let detail = await screen(page, 'workout-sheet');
  await detail.getByTestId('workout-minutes').fill('75');
  await detail.getByTestId('workout-save').click();
  tab = await screen(page, 'training-screen');
  await expect(tab.getByTestId(`workout-${stored!.id}`)).toContainText('75 min');

  await tab.getByTestId(`workout-${stored!.id}`).click();
  detail = await screen(page, 'workout-sheet');
  await detail.getByTestId('workout-delete').click();
  tab = await screen(page, 'training-screen');
  await expect(tab.getByTestId(`workout-${stored!.id}`)).toBeHidden();
  await page.getByTestId('undo').click();
  await expect(tab.getByTestId(`workout-${stored!.id}`)).toBeVisible();
  await expect.poll(async () => (await storedWorkouts(page)).length).toBe(1);
});

test('a custom exercise created from the picker and used at once (AC5)', async ({ page }) => {
  await onboard(page, 'training-custom@example.com');
  await startSession(page);
  await (await screen(page, 'session-screen')).getByTestId('session-add-exercise').click();
  const picker = await screen(page, 'exercise-picker');
  await picker.getByTestId('picker-search').fill('Pallof con goma');
  await expect(picker.getByTestId('picker-no-results')).toBeVisible();
  await picker.getByTestId('picker-create').click();
  const form = await screen(page, 'custom-exercise-form');
  await expect(form.getByTestId('custom-exercise-name')).toHaveValue('Pallof con goma');
  await form.getByTestId('custom-exercise-tracking-reps').click();
  await form.getByTestId('custom-exercise-save').click();
  await picker.getByTestId('picker-add').click();
  const session = await screen(page, 'session-screen');
  await expect(session.getByTestId('exercise-0')).toContainText('Pallof con goma');
  // Reps only: a reps stepper and an optional extra weight.
  for (let i = 0; i < 12; i++) await session.getByTestId('exercise-0-set-0-reps-more').click();
  await session.getByTestId('exercise-0-set-0-complete').click();
  await finish(page);
  await expect
    .poll(async () => (await storedWorkouts(page))[0]?.exercises[0]?.label)
    .toBe('Pallof con goma');
});

test('a session saved offline syncs once when the connection returns (AC22)', async ({ page }) => {
  await emulateOnlineState(page);
  await onboard(page, 'training-offline@example.com');
  // The catalog and the stats are cached when the tab opens.
  const training = await openTab(page, 'training');
  await expect(training.getByTestId('training-first-hint')).toBeVisible();

  await setOffline(page, true);
  await training.getByTestId('training-start').click();
  const session = await addExercises(page, [['dominadas', 'dominadas']]);
  for (let i = 0; i < 8; i++) await session.getByTestId('exercise-0-set-0-reps-more').click();
  await session.getByTestId('exercise-0-set-0-complete').click();
  const tab = await finish(page);
  await expect(tab.getByTestId('sync-badge')).toBeVisible();
  expect(await storedWorkouts(page)).toHaveLength(0);

  await setOffline(page, false);
  await expect(tab.getByTestId('sync-badge')).toBeHidden();
  await expect.poll(async () => (await storedWorkouts(page)).length).toBe(1);
});
