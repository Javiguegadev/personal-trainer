import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  acceptConsent,
  confirmSummary,
  emulateOnlineState,
  fillForm,
  mockRecord,
  openTab,
  screen,
  setOffline,
  signInWithEmail,
  type Activity,
} from './app';

/**
 * The weekly planner (spec 013) on the web build with the mock backend. The clock is fixed: Tuesday 24
 * November 2026 at noon unless a journey moves it (the horizon ends on Sunday 20 December).
 */
const TUESDAY = new Date('2026-11-24T12:00:00+01:00');
const TODAY = '2026-11-24';
const THURSDAY = '2026-11-26';

interface StoredRecord {
  profile: { safetyFlags: string[]; plannedActivities: { days: unknown[] }[] } | null;
  mealItems: {
    localDate: string;
    mealType: string;
    label: string;
    inputMethod: string;
    plannedItemId: string | null;
    deleted: boolean;
  }[];
  workouts: {
    kind: string;
    minutes: number | null;
    programSessionId: string | null;
    plannedWorkoutId: string | null;
    deleted: boolean;
  }[];
  programs: { sessions: { id: string; name: string }[]; deletedAt: string | null }[];
  plannedMealItems: {
    id: string;
    localDate: string;
    mealType: string;
    label: string;
    deletedAt: string | null;
  }[];
  plannedWorkouts: {
    id: string;
    localDate: string;
    name: string | null;
    programSessionId: string | null;
    deletedAt: string | null;
  }[];
}

/** What the mock server holds, without deleted rows. */
async function stored(page: Page) {
  const record = await mockRecord<StoredRecord>(page);
  return {
    profile: record?.profile ?? null,
    mealItems: (record?.mealItems ?? []).filter((i) => !i.deleted),
    workouts: (record?.workouts ?? []).filter((w) => !w.deleted),
    programs: (record?.programs ?? []).filter((p) => p.deletedAt === null),
    plannedMealItems: (record?.plannedMealItems ?? []).filter((i) => i.deletedAt === null),
    plannedWorkouts: (record?.plannedWorkouts ?? []).filter((w) => w.deletedAt === null),
  };
}

/** The planned items on the server as "date meal label", sorted. */
async function plannedItems(page: Page): Promise<string[]> {
  return (await stored(page)).plannedMealItems
    .map((i) => `${i.localDate} ${i.mealType} ${i.label}`)
    .sort();
}

async function onboard(page: Page, email: string, training: Activity[]): Promise<Locator> {
  await signInWithEmail(page, email);
  const form = await acceptConsent(page);
  await fillForm(form, {
    sex: 'male',
    age: 30,
    height: { cm: '178' },
    weight: '78',
    job: 'sedentary',
    training,
    goal: 'maintain',
  });
  await form.getByTestId('form-continue').click();
  return confirmSummary(page);
}

/** Today → "Semana" (spec 010 AC7). */
async function openWeekView(page: Page): Promise<Locator> {
  const today = await openTab(page, 'today');
  await today.getByTestId('today-view-week').click();
  await expect(today.getByTestId('today-view-week')).toHaveAttribute('aria-checked', 'true');
  return today.getByTestId('today-week');
}

/** A quick add (`name`, `kcal`) from the add screen already open, then "Listo". */
async function quickAdd(page: Page, name: string, kcal: string): Promise<void> {
  const add = await screen(page, 'food-add-screen');
  await add.getByTestId('quick-add-open').click();
  const quick = await screen(page, 'quick-add-form');
  await quick.getByTestId('quick-add-name').fill(name);
  await quick.getByTestId('quick-add-kcal').fill(kcal);
  await quick.getByTestId('quick-add-submit').click();
  await expect((await screen(page, 'food-add-screen')).getByTestId('food-added')).toBeVisible();
  await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
}

/** "Añadir al plan" for a meal of a day, then a food of the catalog by search with its portion (AC5). */
async function planFood(page: Page, day: Locator, meal: string, search: string, food: string) {
  await day.getByTestId(`day-plan-add-${meal}`).click();
  const add = await screen(page, 'food-add-screen');
  await add.getByTestId('food-search').fill(search);
  await add.getByTestId('food-results').getByText(food, { exact: true }).click();
  const submit = page.getByTestId('portion-submit');
  await expect(submit).toHaveText('Añadir al plan');
  await submit.click();
  await expect(add.getByTestId('food-added')).toContainText(`Añadido al plan: ${food}`);
  await add.getByTestId('food-add-done').click();
  return screen(page, 'day-screen');
}

test.describe('weekly planner (spec 013)', () => {
  test('a dinner planned for Thursday by search counts only once it is logged, and is pending again when its log goes (AC1, AC2, AC4, AC5, AC7–AC9)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(TUESDAY);
    await onboard(page, 'plan-dinner@example.com', [{}]);
    let food = await openTab(page, 'food');
    const before = await food.getByTestId('summary-kcal').innerText();

    // AC4, AC5: Thursday's day screen → "Añadir al plan" → the add screen in plan mode.
    let view = await openWeekView(page);
    await view.getByTestId(`week-day-${THURSDAY}`).click();
    let day = await screen(page, 'day-screen');
    await day.getByTestId('day-plan-add-dinner').click();
    const add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-add-plan-title')).toHaveText(
      'Planificar · Cena del jueves 26',
    );
    for (const shortcut of ['food-scan', 'food-plate-photo', 'food-describe']) {
      await expect(add.getByTestId(shortcut)).toBeHidden();
    }
    await add.getByTestId('food-add-done').click();
    day = await planFood(
      page,
      await screen(page, 'day-screen'),
      'dinner',
      'pechuga',
      'Pechuga de pollo a la plancha',
    );
    await expect(day.getByTestId('day-plan-dinner')).toContainText(
      'Pechuga de pollo a la plancha · 1 filete (100 g)',
    );
    await expect(day.getByTestId('day-plan-energy')).toHaveText(/^Plan: 141 \/ .+ kcal$/);
    await expect
      .poll(async () => plannedItems(page))
      .toEqual([`${THURSDAY} dinner Pechuga de pollo a la plancha`]);
    const plannedId = (await stored(page)).plannedMealItems[0]!.id;

    // AC2: an outlined dot and "Plan: …" on Thursday; AC7: Today's summary does not change.
    await page.goto('/');
    view = (await screen(page, 'today-screen')).getByTestId('today-week');
    await expect(view.getByTestId(`week-day-${THURSDAY}-planned-dinner`)).toBeVisible();
    await expect(view.getByTestId(`week-day-${THURSDAY}-plan-kcal`)).toHaveText(
      /^Plan: 141 \/ .+ kcal$/,
    );
    await expect(view.getByTestId(`week-day-${THURSDAY}-kcal`)).toBeHidden();
    food = await openTab(page, 'food');
    await expect(food.getByTestId('summary-kcal')).toHaveText(before);

    // AC8: on Thursday the planned dinner waits under its meal and is logged in one tap.
    await page.clock.setFixedTime(new Date(`${THURSDAY}T12:00:00+01:00`));
    await page.goto('/');
    food = await openTab(page, 'food');
    const dinner = food.getByTestId('meal-dinner');
    await expect(dinner.getByTestId('meal-planned-item')).toContainText('Plan · 1 filete (100 g)');
    await expect(dinner.getByTestId('meal-dinner-log-planned')).toHaveText(
      'Registrar lo planificado (1 alimento · 141 kcal)',
    );
    await dinner.getByTestId('meal-dinner-log-planned').click();
    await expect(food.getByTestId('summary-kcal')).toHaveText('141 kcal');
    await expect(dinner.getByTestId('meal-item-registered')).toHaveText('✓ Registrado del plan');
    await expect(dinner.getByTestId('meal-planned-item')).toBeHidden();
    await expect
      .poll(async () =>
        (await stored(page)).mealItems.map((i) => [i.localDate, i.inputMethod, i.plannedItemId]),
      )
      .toEqual([[THURSDAY, 'plan', plannedId]]);

    // AC9: the log item deleted, the planned item is pending again.
    await dinner.getByTestId('meal-item').click();
    await (await screen(page, 'food-item-sheet')).getByTestId('delete-item').click();
    food = await screen(page, 'food-screen');
    await expect(food.getByTestId('meal-dinner').getByTestId('meal-planned-item')).toBeVisible();
    await expect(food.getByTestId('summary-kcal')).toHaveText(before);
  });

  test('"Planificar con mi rutina" places A, B and C on Monday, Wednesday and Friday; on Wednesday B starts with both links (AC11, AC14, AC15, AC17)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-23T08:00:00+01:00'));
    await onboard(page, 'plan-fill@example.com', [{ timesPerWeek: 3, minutes: 60 }]);

    // Gym Monday, Wednesday and Friday at 18:30 ("Mi semana", spec 010).
    const profile = await openTab(page, 'profile');
    await profile.getByTestId('open-week').click();
    const week = await screen(page, 'week-settings-screen');
    await week.getByTestId('week-pattern-none').click();
    for (const day of [1, 3, 5]) await week.getByTestId(`week-activity-0-row-days-${day}`).click();
    await week.getByTestId('week-activity-0-row-time-value').selectOption(String(18 * 60 + 30));
    await week.getByTestId('week-save').click();
    await expect
      .poll(async () => (await stored(page)).profile?.plannedActivities[0]?.days.length)
      .toBe(3);

    // A routine of three sessions (intermediate, full gym). "Mi semana" sits over the tabs.
    await page.goto('/');
    const training = await openTab(page, 'training');
    await training.getByTestId('routine-create').click();
    const wizard = await screen(page, 'routine-wizard');
    await wizard.getByTestId('routine-experience-intermediate').click();
    await wizard.getByTestId('routine-wizard-next').click();
    await wizard.getByTestId('routine-equipment-full_gym').click();
    await wizard.getByTestId('routine-wizard-next').click();
    await wizard.getByTestId('routine-wizard-next').click();
    await (await screen(page, 'routine-screen')).getByTestId('routine-save').click();
    await screen(page, 'training-screen');
    await expect.poll(async () => (await stored(page)).programs.length).toBe(1);

    const view = await openWeekView(page);
    await view.getByTestId('week-plan-fill').click();
    const fill = await screen(page, 'plan-fill-sheet');
    await expect(fill.getByTestId('plan-fill-line')).toHaveText([
      'lun 23 · Rutina A · 18:30',
      'mié 25 · Rutina B · 18:30',
      'vie 27 · Rutina C · 18:30',
    ]);
    await fill.getByTestId('plan-fill-save').click();
    const today = await screen(page, 'today-screen');
    await expect(today.getByTestId('undo-toast')).toContainText('3 sesiones planificadas');
    await expect(today.getByTestId('week-day-2026-11-25-planned')).toHaveText('Rutina B · 18:30');
    await expect.poll(async () => (await stored(page)).plannedWorkouts.length).toBe(3);

    // AC14: Monday's A was not done; on Wednesday Today shows the planned B, not "Siguiente".
    await page.clock.setFixedTime(new Date('2026-11-25T12:00:00+01:00'));
    await page.goto('/');
    await (await screen(page, 'today-screen')).getByTestId('today-view-day').click();
    const planned = page.getByTestId('today-planned');
    await expect(planned).toContainText('Hoy: Rutina B · 18:30');
    await planned.getByTestId('planned-session-start').click();

    // AC15: the session of B, saved with the routine session and the plan links.
    const session = await screen(page, 'session-screen');
    await session.getByTestId('exercise-0-set-0-weight').fill('20');
    await session.getByTestId('exercise-0-set-0-complete').click();
    await session.getByTestId('session-finish').click();
    await (await screen(page, 'finish-sheet')).getByTestId('finish-save').click();
    const tab = await screen(page, 'training-screen');
    await expect.poll(async () => (await stored(page)).workouts.length).toBe(1);
    const { programs, workouts, plannedWorkouts } = await stored(page);
    const wednesday = plannedWorkouts.find((p) => p.localDate === '2026-11-25')!;
    expect(workouts[0]!.programSessionId).toBe(programs[0]!.sessions[1]!.id);
    expect(workouts[0]!.plannedWorkoutId).toBe(wednesday.id);

    // AC17: done, so the rotation of spec 010 shows again and follows the workouts.
    await expect(tab.getByTestId('routine-next')).toHaveText('Siguiente: Rutina C');
  });

  test('an activity planned for today is logged with "Hecho" and keeps the link (AC10, AC16, AC17)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(TUESDAY);
    await onboard(page, 'plan-activity@example.com', [
      {},
      { kind: 'sport', name: 'Fútbol', timesPerWeek: 1, minutes: 90 },
    ]);
    await page.goto(`/day/${TODAY}`);
    let day = await screen(page, 'day-screen');
    await day.getByTestId('day-plan-workout').click();

    const sheet = await screen(page, 'plan-workout-sheet');
    await sheet.getByTestId('plan-workout-what-activity').click();
    await sheet.getByTestId('plan-workout-activity-p:Fútbol').click();
    // The minutes of the profile's football.
    await expect(sheet.getByTestId('plan-workout-minutes-field')).toHaveValue('90');
    await sheet.getByTestId('plan-workout-match').click();
    await sheet.getByTestId('plan-workout-time-value').selectOption(String(19 * 60));
    await sheet.getByTestId('plan-workout-save').click();

    day = await screen(page, 'day-screen');
    const sessions = day.getByTestId('day-planned-sessions');
    await expect(sessions).toContainText('Fútbol · partido 19:00 · 90 min');
    await expect.poll(async () => (await stored(page)).plannedWorkouts.length).toBe(1);
    const plannedId = (await stored(page)).plannedWorkouts[0]!.id;

    // AC16: "Hecho" opens the activity sheet with its type and minutes; one tap saves it.
    await sessions.getByTestId('planned-session-done').click();
    const activity = await screen(page, 'activity-sheet');
    await expect(activity.getByTestId('activity-type-p:Fútbol')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(activity.getByTestId('activity-minutes-field')).toHaveValue('90');
    await activity.getByTestId('activity-save').click();

    // AC17: shown once, as done.
    day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-workouts')).toContainText('Fútbol');
    await expect(day.getByTestId('planned-session-done')).toBeHidden();
    await expect
      .poll(async () =>
        (await stored(page)).workouts.map((w) => [w.kind, w.minutes, w.plannedWorkoutId]),
      )
      .toEqual([['sport', 90, plannedId]]);
  });

  test('"Copiar día" onto a planned day asks, replaces and undoes; "Copiar semana" copies to the next week (AC19–AC21)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(TUESDAY);
    await onboard(page, 'plan-copy@example.com', [{}]);

    // Today: a logged lunch. Thursday: a planned dinner.
    const food = await openTab(page, 'food');
    await food.getByTestId('meal-lunch-add').click();
    await quickAdd(page, 'menú del bar', '650');
    await expect.poll(async () => (await stored(page)).mealItems.length).toBe(1);
    await page.goto(`/day/${THURSDAY}`);
    let day = await screen(page, 'day-screen');
    await day.getByTestId('day-plan-add-dinner').click();
    await quickAdd(page, 'cena de casa', '300');
    await expect.poll(async () => plannedItems(page)).toEqual([`${THURSDAY} dinner cena de casa`]);

    // AC19, AC20: today's day screen → "Copiar día" → Thursday, which has a plan.
    await page.goto(`/day/${TODAY}`);
    day = await screen(page, 'day-screen');
    await day.getByTestId('day-copy').click();
    const copy = await screen(page, 'plan-copy-sheet');
    await expect(copy.getByTestId('plan-copy-title')).toHaveText('Copiar el martes 24');
    await copy.getByTestId('plan-copy-submit').click();
    await expect(copy.getByText('Elige al menos un día.')).toBeVisible();
    await copy.getByTestId(`plan-copy-target-${THURSDAY}`).click();
    await copy.getByTestId('plan-copy-submit').click();
    const confirm = await screen(page, 'plan-copy-confirm');
    await expect(confirm.getByTestId('plan-copy-replaced')).toHaveText(
      'Se sustituirá lo planificado del jueves 26. Lo que ya está registrado no cambia.',
    );
    await confirm.getByTestId('plan-copy-replace').click();
    day = await screen(page, 'day-screen');
    await expect(day.getByTestId('undo-toast')).toContainText('Copiado en 1 día');
    await expect
      .poll(async () => plannedItems(page), { timeout: 3000 })
      .toEqual([`${THURSDAY} lunch menú del bar`]);

    // "Deshacer" removes the copy and brings the dinner back; the log never changed.
    await day.getByTestId('undo').click();
    await expect.poll(async () => plannedItems(page)).toEqual([`${THURSDAY} dinner cena de casa`]);
    expect((await stored(page)).mealItems.map((i) => [i.localDate, i.label])).toEqual([
      [TODAY, 'menú del bar'],
    ]);

    // AC21: the week view → "Copiar semana" → the next week (no plan there: no confirmation).
    const view = await openWeekViewFromRoot(page);
    await view.getByTestId('week-plan-copy').click();
    const weekCopy = await screen(page, 'plan-copy-sheet');
    await expect(weekCopy.getByTestId('plan-copy-title')).toHaveText('Copiar la semana del 23 nov');
    await expect(weekCopy.getByTestId('plan-copy-week-2026-11-30')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await weekCopy.getByTestId('plan-copy-submit').click();
    await expect((await screen(page, 'today-screen')).getByTestId('undo-toast')).toContainText(
      'Semana copiada',
    );
    await expect
      .poll(async () => plannedItems(page))
      .toEqual([
        `${THURSDAY} dinner cena de casa`,
        '2026-12-01 lunch menú del bar',
        '2026-12-03 dinner cena de casa',
      ]);
  });

  test('a plan made and logged offline is sent first, then the log that points at it (AC22)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
    await page.clock.setFixedTime(TUESDAY);
    await onboard(page, 'plan-offline@example.com', [{}]);
    // The week log and the plan are cached when the week view opens.
    const view = await openWeekView(page);
    await expect(view.getByTestId(`week-day-${TODAY}`)).toBeVisible();

    await setOffline(page, true);
    await view.getByTestId(`week-day-${TODAY}`).click();
    let day = await screen(page, 'day-screen');
    await day.getByTestId('day-plan-add-dinner').click();
    const add = await screen(page, 'food-add-screen');
    await expect(add.getByTestId('food-search-offline')).toBeVisible();
    await quickAdd(page, 'cena de casa', '300');

    day = await screen(page, 'day-screen');
    const dinner = day.getByTestId('meal-dinner');
    await expect(dinner.getByTestId('meal-planned-item')).toContainText('cena de casa');
    await expect(dinner.getByTestId('sync-badge')).toBeVisible();
    await dinner.getByTestId('meal-dinner-log-planned').click();
    await expect(dinner.getByTestId('meal-item-registered')).toBeVisible();
    expect((await stored(page)).plannedMealItems).toHaveLength(0);
    expect((await stored(page)).mealItems).toHaveLength(0);

    // Back online: the planned item first, so the log keeps its link (AC23 would drop it otherwise).
    await setOffline(page, false);
    await expect.poll(async () => (await stored(page)).mealItems.length).toBe(1);
    const { plannedMealItems, mealItems } = await stored(page);
    expect(plannedMealItems).toHaveLength(1);
    expect(mealItems[0]!.plannedItemId).toBe(plannedMealItems[0]!.id);
    expect(mealItems[0]!.inputMethod).toBe('plan');
  });

  test('with ed_soft_stop the plan shows foods, portions and dots without any number (AC3)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(TUESDAY);
    await onboard(page, 'plan-ed@example.com', [{}]);
    // The flag is set on the mock server, as spec 010's test does.
    await page.evaluate(() => {
      const key = 'pt.mock-db.v11';
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
        string,
        { profile: { safetyFlags: string[] } }
      >;
      for (const record of Object.values(db)) record.profile.safetyFlags.push('ed_soft_stop');
      localStorage.setItem(key, JSON.stringify(db));
    });
    await page.goto(`/day/${THURSDAY}`);
    let day = await screen(page, 'day-screen');
    day = await planFood(page, day, 'dinner', 'pechuga', 'Pechuga de pollo a la plancha');
    await expect(day.getByTestId('day-plan-dinner')).toContainText(
      'Pechuga de pollo a la plancha · 1 filete (100 g)',
    );
    await expect(day.getByTestId('day-plan-energy')).toBeHidden();
    await expect(day.getByTestId('day-plan')).not.toContainText('kcal');
    await expect.poll(async () => (await stored(page)).plannedMealItems.length).toBe(1);

    await page.goto('/');
    const view = await openWeekView(page);
    await expect(view.getByTestId(`week-day-${THURSDAY}-planned-dinner`)).toBeVisible();
    await expect(view.getByTestId(`week-day-${THURSDAY}-plan-kcal`)).toBeHidden();
    await expect(view).not.toContainText('kcal');
  });
});

/** The week view after a full load (`page.goto('/')`), with the view the device remembers. */
async function openWeekViewFromRoot(page: Page): Promise<Locator> {
  await page.goto('/');
  return openWeekView(page);
}
