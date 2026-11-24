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
 * The daily check-in and the day's readiness (spec 011), on the web build with the mock backend. The
 * clock is fixed where the weekday matters: Wednesday 18 November 2026 at noon.
 */
const WEDNESDAY = new Date('2026-11-18T12:00:00+01:00');
const THURSDAY = new Date('2026-11-19T12:00:00+01:00');
const TODAY = '2026-11-18';

interface StoredCheckin {
  localDate: string;
  sleepMinutes: number | null;
  stress: string | null;
  workShift: string | null;
  shiftStartMinute: number | null;
  shiftEndMinute: number | null;
  deletedAt: string | null;
}
interface StoredRecord {
  checkins: StoredCheckin[];
  programs: { deletedAt: string | null }[];
}

async function stored(page: Page): Promise<{ checkins: StoredCheckin[]; programs: number }> {
  const record = await mockRecord<StoredRecord>(page);
  return {
    checkins: (record?.checkins ?? []).filter((c) => c.deletedAt === null),
    programs: (record?.programs ?? []).filter((p) => p.deletedAt === null).length,
  };
}

async function onboard(page: Page, email: string, training: Activity[]): Promise<Locator> {
  await signInWithEmail(page, email);
  const form = await acceptConsent(page);
  await fillForm(form, {
    sex: 'female',
    age: 32,
    height: { cm: '166' },
    weight: '61',
    job: 'standing',
    training,
    goal: 'maintain',
  });
  await form.getByTestId('form-continue').click();
  return confirmSummary(page);
}

/** Profile → "Mi semana" (spec 010 AC1). */
async function openWeekSettings(page: Page): Promise<Locator> {
  const profile = await openTab(page, 'profile');
  await profile.getByTestId('open-week').click();
  return screen(page, 'week-settings-screen');
}

/** Today → "Día". */
async function openDayView(page: Page): Promise<Locator> {
  const today = await openTab(page, 'today');
  await today.getByTestId('today-view-day').click();
  await expect(today.getByTestId('today-view-day')).toHaveAttribute('aria-checked', 'true');
  return today;
}

/** Today → "Semana" (spec 010 AC7). */
async function openWeekView(page: Page): Promise<Locator> {
  const today = await openTab(page, 'today');
  await today.getByTestId('today-view-week').click();
  await expect(today.getByTestId('today-view-week')).toHaveAttribute('aria-checked', 'true');
  return today.getByTestId('today-week');
}

/** The starter routine (spec 010 AC13–AC16); returns the sets of each exercise of "Rutina A". */
async function createRoutine(page: Page): Promise<number[]> {
  const training = await openTab(page, 'training');
  await training.getByTestId('routine-create').click();
  const wizard = await screen(page, 'routine-wizard');
  await wizard.getByTestId('routine-experience-beginner').click();
  await wizard.getByTestId('routine-wizard-next').click();
  await wizard.getByTestId('routine-equipment-full_gym').click();
  await wizard.getByTestId('routine-wizard-next').click();
  await wizard.getByTestId('routine-wizard-next').click();
  const editor = await screen(page, 'routine-screen');
  const targets = editor.locator('[data-testid^="routine-exercise-0-"][data-testid$="-target"]');
  await expect(targets.first()).toBeVisible();
  const sets = (await targets.allInnerTexts()).map((text) => Number(text.split(' ×')[0]));
  await editor.getByTestId('routine-save').click();
  await screen(page, 'training-screen');
  await expect.poll(async () => (await stored(page)).programs).toBe(1);
  return sets;
}

/** The last set of every exercise of the session is `sets[i]` (and exercise `sets.length` is absent). */
async function expectSets(session: Locator, sets: readonly number[]): Promise<void> {
  for (const [index, count] of sets.entries()) {
    await expect(session.getByTestId(`exercise-${index}-set-${count - 1}`)).toBeVisible();
    await expect(session.getByTestId(`exercise-${index}-set-${count}`)).toBeHidden();
  }
  await expect(session.getByTestId(`exercise-${sets.length}-set-0`)).toBeHidden();
}

test.describe('daily check-in and day readiness (spec 011)', () => {
  test('a gym day: "5–6 h" and "Alto" lighten "Rutina A", "Entrenar normal" restores it (AC1, AC2, AC4, AC6–AC8)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'checkin-routine@example.com', [{ timesPerWeek: 3, minutes: 60 }]);
    const sets = await createRoutine(page);
    // The adjustment needs a session with more than 4 exercises and one of 3 sets or more.
    expect(sets.length).toBeGreaterThan(4);
    expect(sets.some((count) => count >= 3)).toBe(true);

    // AC1, AC2: a gym activity without days is planned every day. The first check-in has no sleep
    // to prefill, stress is "Normal", and nobody without shifts is asked for one.
    const today = await openDayView(page);
    const card = today.getByTestId('checkin-card');
    await expect(card).toContainText('¿Qué tal hoy?');
    await expect(card.getByTestId('checkin-stress-normal')).toHaveAttribute('aria-checked', 'true');
    for (const chip of ['under_5', '5_6', '6_7', '7_8', 'over_8']) {
      await expect(card.getByTestId(`checkin-sleep-${chip}`)).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }
    await expect(card.getByTestId('checkin-shift')).toBeHidden();

    await card.getByTestId('checkin-sleep-5_6').click();
    await card.getByTestId('checkin-stress-high').click();
    await card.getByTestId('checkin-save').click();

    // AC4, AC6: low (5–6 h with high stress); the line says what the session loses.
    await expect(card).toBeHidden();
    await expect(today.getByTestId('readiness-text')).toHaveText(
      'Has dormido poco y el estrés está alto: hoy una serie menos por ejercicio y un ejercicio menos',
    );
    await expect
      .poll(async () =>
        (await stored(page)).checkins.map(({ localDate, sleepMinutes, stress }) => ({
          localDate,
          sleepMinutes,
          stress,
        })),
      )
      .toEqual([{ localDate: TODAY, sleepMinutes: 330, stress: 'high' }]);

    // AC7: one set less from 3 sets (never under 2) and no last exercise.
    await today.getByTestId('today-routine-start').click();
    const session = await screen(page, 'session-screen');
    await expect(session.getByTestId('readiness-banner')).toContainText(
      'Has dormido poco y el estrés está alto: hoy una serie menos por ejercicio y un ejercicio menos',
    );
    await expectSets(
      session,
      sets.slice(0, -1).map((count) => (count >= 3 ? count - 1 : count)),
    );

    // AC8: "Entrenar normal" puts everything back and hides the line.
    await session.getByTestId('readiness-train-normally').click();
    await expect(session.getByTestId('readiness-banner')).toBeHidden();
    await expectSets(session, sets);
  });

  test('"Hoy no" hides the card until the next day and stores nothing (AC2)', async ({ page }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'checkin-skip@example.com', [{}]);
    let today = await openDayView(page);
    await today.getByTestId('checkin-skip').click();
    await expect(today.getByTestId('checkin-card')).toBeHidden();

    await page.goto('/');
    today = await screen(page, 'today-screen');
    await expect(today.getByTestId('today-workout')).toBeVisible();
    await expect(today.getByTestId('checkin-card')).toBeHidden();
    expect((await stored(page)).checkins).toHaveLength(0);

    await page.clock.setFixedTime(THURSDAY);
    await page.goto('/');
    today = await screen(page, 'today-screen');
    await expect(today.getByTestId('checkin-card')).toBeVisible();
  });

  test('a rest day with a fixed schedule shows no card; a gym day does, without shifts (AC1, AC11)', async ({
    page,
  }) => {
    // Tuesday: work, no gym.
    await page.clock.setFixedTime(new Date('2026-11-17T12:00:00+01:00'));
    await onboard(page, 'checkin-rest@example.com', [{}]);
    const week = await openWeekSettings(page);
    await week.getByTestId('week-pattern-fixed').click();
    for (const day of [1, 2, 3, 4, 5]) await week.getByTestId(`week-work-days-${day}`).click();
    for (const day of [1, 3, 5]) await week.getByTestId(`week-activity-0-row-days-${day}`).click();
    await week.getByTestId('week-save').click();
    await expect(week.getByTestId('week-saved')).toBeVisible();

    await page.goto('/');
    let today = await screen(page, 'today-screen');
    await expect(today.getByTestId('today-workout')).toBeVisible();
    await expect(today.getByTestId('checkin-card')).toBeHidden();

    await page.clock.setFixedTime(WEDNESDAY);
    await page.goto('/');
    today = await screen(page, 'today-screen');
    await expect(today.getByTestId('checkin-card')).toBeVisible();
    await expect(today.getByTestId('checkin-shift')).toBeHidden();
  });

  test('a shift worker picks "Noche": the week view, the overlap notice and the next prefill (AC2, AC3, AC11, AC12)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'checkin-shift@example.com', [{}]);
    const week = await openWeekSettings(page);
    await week.getByTestId('week-pattern-shifts').click();
    for (const day of [1, 3, 5]) await week.getByTestId(`week-activity-0-row-days-${day}`).click();
    await week.getByTestId('week-activity-0-row-time-value').selectOption(String(22 * 60 + 30));
    await week.getByTestId('week-save').click();
    await expect(week.getByTestId('week-saved')).toBeVisible();

    await page.goto('/');
    let today = await screen(page, 'today-screen');
    let card = today.getByTestId('checkin-card');
    await card.getByTestId('checkin-shift-night').click();
    await expect(card.getByTestId('checkin-shift-hours')).toHaveText(
      'Noche · 22:00–06:00 · termina al día siguiente',
    );
    // AC3: "Cambiar hora".
    await card.getByTestId('checkin-shift-change').click();
    await card.getByTestId('checkin-shift-start-value').selectOption(String(21 * 60));
    await expect(card.getByTestId('checkin-shift-hours')).toHaveText(
      'Noche · 21:00–06:00 · termina al día siguiente',
    );
    await card.getByTestId('checkin-save').click();

    // AC12: the gym at 22:30 falls inside the shift; the notice never blocks anything.
    await expect(today.getByTestId('day-notice-shift_overlap')).toHaveText(
      'Tu gimnasio de hoy (22:30) coincide con tu turno.',
    );
    await expect
      .poll(async () =>
        (await stored(page)).checkins.map((c) => [
          c.workShift,
          c.shiftStartMinute,
          c.shiftEndMinute,
        ]),
      )
      .toEqual([['night', 21 * 60, 6 * 60]]);

    // AC11: the week view shows the shift where the typical week has no work block.
    const view = await openWeekView(page);
    await expect(view.getByTestId(`week-day-${TODAY}-work`)).toHaveText(
      'Turno de noche 21:00–06:00',
    );

    // AC2, AC3: the next day starts with yesterday's shift; "Noche" again takes the hours chosen.
    await page.clock.setFixedTime(THURSDAY);
    await page.goto('/');
    today = await openDayView(page);
    card = today.getByTestId('checkin-card');
    await expect(card.getByTestId('checkin-shift-night')).toHaveAttribute('aria-checked', 'true');
    await card.getByTestId('checkin-shift-off').click();
    await expect(card.getByTestId('checkin-shift-hours')).toBeHidden();
    await card.getByTestId('checkin-shift-night').click();
    await expect(card.getByTestId('checkin-shift-hours')).toHaveText(
      'Noche · 21:00–06:00 · termina al día siguiente',
    );
  });

  test('a check-in saved offline syncs once (AC14)', async ({ page }) => {
    await emulateOnlineState(page);
    await onboard(page, 'checkin-offline@example.com', [{}]);
    const today = await screen(page, 'today-screen');
    const card = today.getByTestId('checkin-card');
    await expect(card).toBeVisible();

    await setOffline(page, true);
    await card.getByTestId('checkin-sleep-7_8').click();
    await card.getByTestId('checkin-save').click();
    // The readiness works offline: 7–8 h and normal stress on a gym day.
    await expect(today.getByTestId('readiness-text')).toHaveText('Todo en orden para entrenar');
    await expect(today.getByTestId('readiness').getByTestId('sync-badge')).toBeVisible();
    expect((await stored(page)).checkins).toHaveLength(0);

    await setOffline(page, false);
    await expect.poll(async () => (await stored(page)).checkins.length).toBe(1);
    await expect(today.getByTestId('readiness').getByTestId('sync-badge')).toBeHidden();
  });

  test('a check-in added 10 days back from the day screen; older days are read-only (AC2, AC5)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(WEDNESDAY);
    await onboard(page, 'checkin-past@example.com', [{}]);
    const view = await openWeekView(page);
    await view.getByTestId('week-previous').click();
    await view.getByTestId('week-previous').click();
    await view.getByTestId('week-day-2026-11-08').click();

    let day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-checkin-none')).toHaveText('Sin check-in');
    await day.getByTestId('day-checkin-add').click();
    const sheet = await screen(page, 'checkin-screen');
    await expect(sheet.getByTestId('checkin-title')).toHaveText(/^Check-in del 8 nov/);
    await sheet.getByTestId('checkin-sleep-7_8').click();
    await sheet.getByTestId('checkin-stress-low').click();
    await sheet.getByTestId('checkin-save').click();

    day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-checkin-line')).toHaveText(['Sueño: 7–8 h', 'Estrés: Bajo']);
    await expect
      .poll(async () => (await stored(page)).checkins.map((c) => c.localDate))
      .toEqual(['2026-11-08']);

    // 29 days back: shown, never changed.
    await page.goto('/day/2026-10-20');
    day = await screen(page, 'day-screen');
    await expect(day.getByTestId('day-checkin-none')).toBeVisible();
    await expect(day.getByTestId('day-checkin-add')).toBeHidden();

    // AC2: today's card starts with the latest check-in's sleep (no usual sleep before 5 nights).
    await page.goto('/');
    const today = await openDayView(page);
    await expect(
      today.getByTestId('checkin-card').getByTestId('checkin-sleep-7_8'),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
