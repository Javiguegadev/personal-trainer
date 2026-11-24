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
 * The typical week, the week view and the starter routine (spec 010), on the web build with the mock
 * backend. The clock is fixed where the weekday matters: Wednesday 18 November 2026 at noon.
 */
const WEDNESDAY = new Date('2026-11-18T12:00:00+01:00');
const TODAY = '2026-11-18';

interface StoredWorkout {
  localDate: string;
  inputMethod: string;
  programSessionId: string | null;
  deleted: boolean;
}
interface StoredProgram {
  id: string;
  sessions: { id: string; name: string }[];
  deletedAt: string | null;
}
interface StoredRecord {
  profile: { safetyFlags: string[] } | null;
  mealItems: { localDate: string; deleted: boolean }[];
  workouts: StoredWorkout[];
  programs: StoredProgram[];
}

async function stored(page: Page): Promise<StoredRecord> {
  const record = await mockRecord<StoredRecord>(page);
  return {
    profile: record?.profile ?? null,
    mealItems: (record?.mealItems ?? []).filter((i) => !i.deleted),
    workouts: (record?.workouts ?? []).filter((w) => !w.deleted),
    programs: (record?.programs ?? []).filter((p) => p.deletedAt === null),
  };
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

/** Profile → "Mi semana" (AC1). */
async function openWeekSettings(page: Page): Promise<Locator> {
  const profile = await openTab(page, 'profile');
  await profile.getByTestId('open-week').click();
  return screen(page, 'week-settings-screen');
}

/** A quick add of `kcal` to a meal from the add screen already open. */
async function quickAdd(page: Page, kcal: string): Promise<void> {
  const add = await screen(page, 'food-add-screen');
  await add.getByTestId('food-search').fill('menu del bar');
  await add.getByTestId('quick-add-query').click();
  const quick = await screen(page, 'quick-add-form');
  await quick.getByTestId('quick-add-kcal').fill(kcal);
  await quick.getByTestId('quick-add-submit').click();
  await expect((await screen(page, 'food-add-screen')).getByTestId('food-added')).toBeVisible();
  await (await screen(page, 'food-add-screen')).getByTestId('food-add-done').click();
}

/** Today → "Semana" (AC7). */
async function openWeekView(page: Page): Promise<Locator> {
  const today = await openTab(page, 'today');
  await today.getByTestId('today-view-week').click();
  await expect(today.getByTestId('today-view-week')).toHaveAttribute('aria-checked', 'true');
  return today.getByTestId('today-week');
}

/** The wizard with a strength activity (AC13, AC14): beginner, full gym, the profile's days. */
async function createRoutine(page: Page): Promise<Locator> {
  const training = await openTab(page, 'training');
  await training.getByTestId('routine-create').click();
  const wizard = await screen(page, 'routine-wizard');
  await expect(wizard.getByTestId('routine-wizard-step')).toHaveText('Paso 1 de 3');
  await wizard.getByTestId('routine-experience-beginner').click();
  await wizard.getByTestId('routine-wizard-next').click();
  await wizard.getByTestId('routine-equipment-full_gym').click();
  await wizard.getByTestId('routine-wizard-next').click();
  await expect(wizard.getByTestId('routine-days-value')).toHaveText('3 días · 60 min');
  await wizard.getByTestId('routine-wizard-next').click();
  return screen(page, 'routine-screen');
}

/** Completes the first set of the first exercise with 20 kg and saves the session (spec 009). */
async function saveFirstSet(page: Page): Promise<Locator> {
  const session = await screen(page, 'session-screen');
  // The reps start at the top of the routine's range (AC18): only the weight is typed.
  await session.getByTestId('exercise-0-set-0-weight').fill('20');
  await session.getByTestId('exercise-0-set-0-complete').click();
  await expect(session.getByTestId('exercise-0-set-0-complete')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await session.getByTestId('session-finish').click();
  await (await screen(page, 'finish-sheet')).getByTestId('finish-save').click();
  return screen(page, 'training-screen');
}

test.describe('typical week, week view and starter routine (spec 010)', () => {
  test('"Mi semana": work hours, gym days, a match, notices and the targets notice (AC1–AC5)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'week-settings@example.com', [
      { timesPerWeek: 2 },
      { kind: 'sport', name: 'Fútbol', timesPerWeek: 1, minutes: 90 },
    ]);
    const week = await openWeekSettings(page);

    // Work: Monday to Friday, 08:00–16:00 (the hours of a new day).
    await week.getByTestId('week-pattern-fixed').click();
    for (const day of [1, 2, 3, 4, 5]) await week.getByTestId(`week-work-days-${day}`).click();
    await expect(week.getByTestId('week-work-5-start-value')).toHaveValue(String(8 * 60));
    await expect(week.getByTestId('week-work-5-end-value')).toHaveValue(String(16 * 60));

    // Gym Monday, Wednesday and Friday at 18:30.
    const gym = 'week-activity-0-row';
    for (const day of [1, 3, 5]) await week.getByTestId(`${gym}-days-${day}`).click();
    await expect(week.getByTestId(`${gym}-count`)).toHaveText('3 días');
    await week.getByTestId(`${gym}-time-value`).selectOption(String(18 * 60 + 30));

    // Football: a match on Saturday at 11:00.
    const football = 'week-activity-1-row';
    await week.getByTestId(`${football}-days-6`).click();
    await week.getByTestId(`${football}-match-6`).click();
    await week.getByTestId(`${football}-match-6-time-value`).selectOption(String(11 * 60));

    // AC5: the gym on Friday is the day before the match; the notice never blocks the save.
    await expect(week.getByTestId('week-notice-hard_before_match')).toBeVisible();
    await expect(week.getByTestId('week-notice-work_overlap')).toBeHidden();

    // AC4: 2 → 3 gym days changes the targets, shown as old and new kcal.
    await week.getByTestId('week-save').click();
    await expect(week.getByTestId('week-targets-change')).toContainText(/pasan de .+ a .+ kcal/);

    // The week view shows the typical week (AC8). "Mi semana" sits over the tabs.
    await page.goto('/');
    const view = await openWeekView(page);
    await expect(view.getByTestId('week-day-2026-11-16-work')).toHaveText('08:00–16:00');
    await expect(view.getByTestId('week-day-2026-11-16-planned')).toContainText('18:30');
    await expect(view.getByTestId('week-day-2026-11-21-planned')).toContainText('partido 11:00');
    await expect(view.getByTestId('week-day-2026-11-22-planned')).toBeHidden();
  });

  test('the week view with a meal and a workout, a day 10 days back and ed_soft_stop (AC7–AC12)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'week-view@example.com', [{}]);

    // A meal and an activity today.
    const food = await openTab(page, 'food');
    await food.getByTestId('meal-lunch-add').click();
    await quickAdd(page, '650');
    const training = await openTab(page, 'training');
    await training.getByTestId('training-log-activity').click();
    const sheet = await screen(page, 'activity-sheet');
    await sheet.getByTestId('activity-type-a:football').click();
    await sheet.getByTestId('activity-minutes-90').click();
    await sheet.getByTestId('activity-save').click();
    await screen(page, 'training-screen');

    let view = await openWeekView(page);
    const today = view.getByTestId(`week-day-${TODAY}`);
    await expect(today).toContainText('Hoy');
    await expect(view.getByTestId(`week-day-${TODAY}-workouts`)).toContainText('Fútbol');
    await expect(view.getByTestId(`week-day-${TODAY}-meals`)).toBeVisible();
    await expect(view.getByTestId(`week-day-${TODAY}-kcal`)).toContainText(/^650 \/ .+ kcal$/);

    // AC10: two weeks back (8 November is 10 days before), "Hoy" returns.
    await view.getByTestId('week-previous').click();
    await view.getByTestId('week-previous').click();
    await expect(view.getByTestId('week-current')).toBeVisible();
    await view.getByTestId('week-day-2026-11-08').click();

    // AC11, AC12: the day screen of 8 November adds a meal on that day.
    let day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-title')).toContainText('8 de noviembre');
    await expect(day.getByTestId('day-nothing')).toBeVisible();
    await day.getByTestId('day-add-meal').click();
    const add = await screen(page, 'food-add-screen');
    await add.getByTestId('food-add-meal-dinner').click();
    await quickAdd(page, '500');
    day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-meals')).toContainText('500');
    await expect
      .poll(async () => (await stored(page)).mealItems.map((i) => i.localDate).sort())
      .toEqual(['2026-11-08', TODAY]);

    // The day screen of a day older than 4 weeks is read-only.
    await page.goto('/day/2026-10-01');
    day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-read-only')).toBeVisible();
    await expect(day.getByTestId('day-add-meal')).toBeHidden();

    // AC9: with `ed_soft_stop`, the dots stay and the kcal go. The flag is set on the mock server.
    await page.evaluate(() => {
      const key = 'pt.mock-db.v8';
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
        string,
        { profile: { safetyFlags: string[] } }
      >;
      for (const record of Object.values(db)) record.profile.safetyFlags.push('ed_soft_stop');
      localStorage.setItem(key, JSON.stringify(db));
    });
    await page.goto('/');
    // The choice of view is remembered on the device (AC7).
    view = (await screen(page, 'today-screen')).getByTestId('today-week');
    await expect(view).toBeVisible();
    await expect(view.getByTestId(`week-day-${TODAY}-meals`)).toBeVisible();
    await expect(view.getByTestId(`week-day-${TODAY}-kcal`)).toBeHidden();
  });

  test('a starter routine: create, edit, start "Rutina A" from Today, then "Rutina B" (AC13–AC19)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'routine@example.com', [{ timesPerWeek: 3, minutes: 60 }]);

    let editor = await createRoutine(page);
    await expect(editor.getByTestId('routine-provisional')).toBeVisible();
    await expect(editor.getByTestId('routine-session-name-0')).toHaveValue('Rutina A');
    await expect(editor.getByTestId('routine-session-name-1')).toHaveValue('Rutina B');

    // AC16: one more set on the first exercise.
    const row = 'routine-exercise-0-0';
    const before = await editor.getByTestId(`${row}-target`).innerText();
    const sets = Number(before.split(' ×')[0]);
    await editor.getByTestId(`${row}-toggle`).click();
    await editor.getByTestId(`${row}-sets-increase`).click();
    await editor.getByTestId(`${row}-done`).click();
    await expect(editor.getByTestId(`${row}-target`)).toHaveText(
      before.replace(`${sets} ×`, `${sets + 1} ×`),
    );
    await editor.getByTestId('routine-save').click();

    let training = await screen(page, 'training-screen');
    await expect(training.getByTestId('routine-next')).toHaveText('Siguiente: Rutina A');
    await expect.poll(async () => (await stored(page)).programs.length).toBe(1);

    // AC17: a gym activity without days shows the routine on Today too.
    const today = await openTab(page, 'today');
    await today.getByTestId('today-view-day').click();
    await today.getByTestId('today-routine-start').click();

    // AC18: the session has the routine's sets for the first exercise.
    const session = await screen(page, 'session-screen');
    await expect(session.getByTestId(`exercise-0-set-${sets}`)).toBeVisible();
    await expect(session.getByTestId(`exercise-0-set-${sets + 1}`)).toBeHidden();
    training = await saveFirstSet(page);

    // AC19: the rotation moves on.
    await expect(training.getByTestId('routine-next')).toHaveText('Siguiente: Rutina B');
    await expect
      .poll(async () => (await stored(page)).workouts.map((w) => w.inputMethod))
      .toEqual(['program']);
    const { programs, workouts } = await stored(page);
    expect(workouts[0]!.programSessionId).toBe(programs[0]!.sessions[0]!.id);

    // AC20: "Borrar rutina" after a confirmation; the workout keeps its sets.
    await training.getByTestId('routine-open').click();
    editor = await screen(page, 'routine-screen');
    await editor.getByTestId('routine-delete').click();
    await editor.getByTestId('routine-delete-yes').click();
    training = await screen(page, 'training-screen');
    await expect(training.getByTestId('routine-create-card')).toBeVisible();
    await expect.poll(async () => (await stored(page)).programs.length).toBe(0);
    expect((await stored(page)).workouts).toHaveLength(1);
  });

  test('without a strength activity, the card links to "Mi semana" (AC13)', async ({ page }) => {
    await onboard(page, 'routine-no-gym@example.com', []);
    const training = await openTab(page, 'training');
    await expect(training.getByTestId('routine-needs-gym')).toBeVisible();
    await training.getByTestId('routine-needs-gym-link').click();
    await screen(page, 'week-settings-screen');
  });

  test('a routine created offline syncs before the workout that uses it (AC21)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
    await onboard(page, 'routine-offline@example.com', [{ timesPerWeek: 3, minutes: 60 }]);
    // The catalog is cached when the tab opens.
    const tab = await openTab(page, 'training');
    await expect(tab.getByTestId('routine-create')).toBeVisible();
    await expect(tab.getByTestId('training-first-hint')).toBeVisible();

    await setOffline(page, true);
    const editor = await createRoutine(page);
    await editor.getByTestId('routine-save').click();
    const training = await screen(page, 'training-screen');
    await expect(training.getByTestId('routine-card').getByTestId('sync-badge')).toBeVisible();
    await training.getByTestId('routine-start').click();
    await saveFirstSet(page);
    expect((await stored(page)).programs).toHaveLength(0);
    expect((await stored(page)).workouts).toHaveLength(0);

    // "Mi semana" needs the connection (its write recomputes the targets).
    const week = await openWeekSettings(page);
    await expect(week.getByTestId('week-offline')).toBeVisible();
    await expect(week.getByTestId('week-save')).toBeDisabled();

    await setOffline(page, false);
    // The workout keeps its link only if the routine reached the server first.
    await expect.poll(async () => (await stored(page)).workouts.length).toBe(1);
    const { programs, workouts } = await stored(page);
    expect(programs).toHaveLength(1);
    expect(workouts[0]!.programSessionId).toBe(programs[0]!.sessions[0]!.id);
  });

  test('a day that starts at 04:00 keeps Monday until then (AC6)', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-16T20:00:00+01:00'));
    await onboard(page, 'day-start@example.com', [{}]);
    const week = await openWeekSettings(page);
    await week.getByTestId('week-pattern-none').click();
    await week.getByTestId('week-day-start-240').click();
    await week.getByTestId('week-save').click();
    await expect(week.getByTestId('week-saved')).toBeVisible();

    // Tuesday at 02:30: still Monday.
    await page.clock.setFixedTime(new Date('2026-11-17T02:30:00+01:00'));
    await page.goto('/');
    const today = await screen(page, 'today-screen');
    await expect(today.getByTestId('today-date')).toContainText('lunes');
    const food = await openTab(page, 'food');
    await food.getByTestId('meal-dinner-add').click();
    await quickAdd(page, '300');
    await expect
      .poll(async () => (await stored(page)).mealItems.map((i) => i.localDate))
      .toEqual(['2026-11-16']);
  });
});
