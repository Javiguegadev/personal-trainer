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
  type Activity,
} from './app';

/**
 * The workout sentence shortcut (spec 012), on the web build with the mock backend: the mock reads a
 * sentence with simple rules (`packages/api-client/src/mock/workout-drafts.ts`) and builds the draft
 * with the same `workoutDraft` of `@pt/core` as the API, so the journeys test the draft screens, not
 * the AI.
 */
interface StoredWorkout {
  id: string;
  localDate: string;
  kind: string;
  activity: string | null;
  name: string | null;
  minutes: number;
  inputMethod: string;
  programSessionId: string | null;
  exercises: { label: string; sets: { reps: number | null; weightKg: number | null }[] }[];
  deleted: boolean;
}
interface StoredRecord {
  workouts: StoredWorkout[];
  programs: { sessions: { id: string; name: string }[]; deletedAt: string | null }[];
  aiUsage: { feature: string; createdAt: string }[];
}

async function stored(page: Page) {
  const record = await mockRecord<StoredRecord>(page);
  return {
    workouts: (record?.workouts ?? []).filter((w) => !w.deleted),
    programs: (record?.programs ?? []).filter((p) => p.deletedAt === null),
    aiUsage: record?.aiUsage ?? [],
    json: JSON.stringify(record ?? {}),
  };
}

async function onboard(page: Page, email: string, training: Activity[] = []): Promise<Locator> {
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

/** `days` before the user's today, as an ISO date. */
async function daysBefore(page: Page, days: number): Promise<string> {
  const [y, m, d] = (await localToday(page)).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** Types the sentence on the describe screen already open and asks for the draft (AC2). */
async function prepare(page: Page, sentence: string): Promise<void> {
  const describe = await screen(page, 'workout-describe');
  await describe.getByTestId('workout-describe-text').fill(sentence);
  await describe.getByTestId('workout-describe-submit').click();
}

/** Training tab → "Describir entreno" → the sentence (AC1, AC2). */
async function describeFromTab(page: Page, sentence: string): Promise<void> {
  const training = await openTab(page, 'training');
  await training.getByTestId('training-describe').click();
  await prepare(page, sentence);
}

/** "Terminar" → the finish sheet with the minutes the sentence did not say → "Guardar" (AC14). */
async function save(page: Page, minutes: string, name?: string): Promise<Locator> {
  await (await screen(page, 'session-screen')).getByTestId('session-finish').click();
  const sheet = await screen(page, 'finish-sheet');
  await expect(sheet.getByTestId('finish-minutes')).toHaveValue('');
  await sheet.getByTestId('finish-minutes').fill(minutes);
  if (name) await sheet.getByTestId('finish-name').fill(name);
  await sheet.getByTestId('finish-save').click();
  return screen(page, 'training-screen');
}

const done = (session: Locator, row: string) =>
  expect(session.getByTestId(`${row}-complete`)).toHaveAttribute('aria-checked', 'true');
const notDone = (session: Locator, row: string) =>
  expect(session.getByTestId(`${row}-complete`)).toHaveAttribute('aria-checked', 'false');

test.describe('workout sentence (spec 012)', () => {
  test('a sentence fills the editor; the user completes a set, changes and creates exercises, then saves (AC1–AC3, AC7, AC10, AC12, AC14, AC15)', async ({
    page,
  }) => {
    await onboard(page, 'sentence-gym@example.com');
    const SENTENCE =
      'press banca 4x8 con 60, sentadilla 3x10, press larsen 3x8 con 50 y curl martillo 3x12 con 14, me dolía el hombro';
    await describeFromTab(page, SENTENCE);

    // AC10, AC15: the banner with the fixed pain line; nothing is saved before "Guardar".
    let session = await screen(page, 'session-screen');
    await expect(session.getByTestId('draft-banner')).toContainText(
      'Borrador de tu frase: revisa y guarda',
    );
    await expect(session.getByTestId('draft-pain')).toBeVisible();
    expect((await stored(page)).workouts).toHaveLength(0);

    // AC2: "Cambiar la frase" finds the sentence as typed; a new draft asks before discarding this one.
    await session.getByTestId('draft-edit-text').click();
    const describe = await screen(page, 'workout-describe');
    await expect(describe.getByTestId('workout-describe-text')).toHaveValue(SENTENCE);
    await describe.getByTestId('workout-describe-submit').click();
    await expect(describe.getByTestId('draft-replace')).toBeVisible();
    await describe.getByTestId('draft-replace-yes').click();

    // AC3, AC10: the exercises in the order said. Sets with every value are completed; "sentadilla
    // 3x10" said no weight, so its sets wait for one.
    session = await screen(page, 'session-screen');
    await expect(session.getByTestId('exercise-0')).toContainText('Press de banca');
    await expect(session.getByTestId('exercise-1')).toContainText('Sentadilla con barra');
    await expect(session.getByTestId('exercise-2')).toContainText('Curl martillo');
    await done(session, 'exercise-0-set-3');
    await expect(session.getByTestId('exercise-0-set-4')).toBeHidden();
    await expect(session.getByTestId('exercise-1-set-0-reps')).toHaveValue('10');
    await notDone(session, 'exercise-1-set-0');
    await expect(session.getByTestId('exercise-1-set-0-mark-incomplete')).toContainText(
      'Completa esta serie',
    );
    await done(session, 'exercise-2-set-2');

    // AC7: the exercise the catalog lacks sits where it was said, with its sets.
    const unresolved = session.getByTestId('unresolved-0');
    await expect(unresolved).toContainText('No lo encuentro: «press larsen 3x8 con 50»');
    await expect(session.getByTestId('unresolved-0-sets')).toContainText('3 × 8');

    // AC10: the user types the missing weight and ticks the set.
    await session.getByTestId('exercise-1-set-0-weight').fill('80');
    await session.getByTestId('exercise-1-set-0-complete').click();
    await done(session, 'exercise-1-set-0');
    await expect(session.getByTestId('exercise-1-set-0-mark-incomplete')).toBeHidden();

    // AC12: "Cambiar ejercicio" moves the sets said to the exercise picked.
    await session.getByTestId('exercise-2-change').click();
    const picker = await screen(page, 'exercise-picker');
    await picker.getByTestId('picker-search').fill('curl mancuernas');
    await picker.getByTestId('exercise-option-curl-mancuernas').click();
    session = await screen(page, 'session-screen');
    await expect(session.getByTestId('exercise-2')).toContainText('Curl de bíceps con mancuernas');
    await expect(session.getByTestId('exercise-2-set-0-weight')).toHaveValue('14');
    await expect(session.getByTestId('exercise-2-set-0-reps')).toHaveValue('12');
    await done(session, 'exercise-2-set-0');

    // AC7: "Crear ejercicio" names it after the words said; it takes the sets and the place.
    await session.getByTestId('unresolved-0-create').click();
    const form = await screen(page, 'custom-exercise-form');
    await expect(form.getByTestId('custom-exercise-name')).toHaveValue('Press larsen');
    await form.getByTestId('custom-exercise-save').click();
    session = await screen(page, 'session-screen');
    await expect(session.getByTestId('unresolved-0')).toBeHidden();
    await expect(session.getByTestId('exercise-2')).toContainText('Press larsen');
    await done(session, 'exercise-2-set-2');
    await expect(session.getByTestId('exercise-3')).toContainText('Curl de bíceps con mancuernas');

    // AC14: only the completed sets are saved, with the input method `text`.
    const training = await save(page, '60', 'Torso y pierna');
    await expect(training.getByTestId('training-history')).toContainText('Torso y pierna');
    await expect.poll(async () => (await stored(page)).workouts.length).toBe(1);
    const [workout] = (await stored(page)).workouts;
    expect(workout!.inputMethod).toBe('text');
    expect(workout!.localDate).toBe(await localToday(page));
    expect(workout!.exercises.map((e) => [e.label, e.sets.length])).toEqual([
      ['Press de banca', 4],
      ['Sentadilla con barra', 1],
      ['Press larsen', 3],
      ['Curl de bíceps con mancuernas', 3],
    ]);
    expect(workout!.exercises[1]!.sets[0]).toMatchObject({ reps: 10, weightKg: 80 });
    expect(workout!.exercises[3]!.sets[0]).toMatchObject({ reps: 12, weightKg: 14 });
    // AC20: the sentence itself is not kept anywhere.
    expect((await stored(page)).json).not.toContain('me dolía');

    const today = await openTab(page, 'today');
    await expect(today.getByTestId('today-training-done')).toContainText('Torso y pierna');
  });

  test('a sentence that matches a routine session counts as it and moves the rotation (AC13)', async ({
    page,
  }) => {
    await onboard(page, 'sentence-routine@example.com', [{ timesPerWeek: 3, minutes: 60 }]);
    let training = await openTab(page, 'training');
    await training.getByTestId('routine-create').click();
    const wizard = await screen(page, 'routine-wizard');
    await wizard.getByTestId('routine-experience-beginner').click();
    await wizard.getByTestId('routine-wizard-next').click();
    await wizard.getByTestId('routine-equipment-full_gym').click();
    await wizard.getByTestId('routine-wizard-next').click();
    await wizard.getByTestId('routine-wizard-next').click();
    await (await screen(page, 'routine-screen')).getByTestId('routine-save').click();
    training = await screen(page, 'training-screen');
    await expect(training.getByTestId('routine-next')).toHaveText('Siguiente: Rutina A');

    // Three of the six exercises of "Rutina A" (squat, bench, cable row, ...): half is enough.
    await describeFromTab(
      page,
      'sentadilla 3x10 con 40, press banca 3x8 con 60 y remo en polea baja 3x10 con 40',
    );
    const session = await screen(page, 'session-screen');
    await expect(session.getByTestId('routine-link')).toContainText('Cuenta como Rutina A');
    await expect(session.getByTestId('routine-link-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    training = await save(page, '50');
    await expect(training.getByTestId('routine-next')).toHaveText('Siguiente: Rutina B');
    await expect.poll(async () => (await stored(page)).workouts.length).toBe(1);
    const { programs, workouts } = await stored(page);
    expect(workouts[0]!.inputMethod).toBe('text');
    expect(workouts[0]!.programSessionId).toBe(programs[0]!.sessions[0]!.id);
  });

  test('an activity sentence fills its sheet, from the tab and from a day screen (AC1, AC4, AC5, AC10)', async ({
    page,
  }) => {
    await onboard(page, 'sentence-activity@example.com');
    const yesterday = await daysBefore(page, 1);
    const twoDaysAgo = await daysBefore(page, 2);

    // AC4, AC5: the day said, the minutes, and the distance that is not stored.
    await describeFromTab(page, 'ayer corrí 5 km en 28 minutos');
    let sheet = await screen(page, 'activity-sheet');
    await expect(sheet.getByTestId('draft-banner')).toBeVisible();
    await expect(sheet.getByTestId('draft-distance')).toContainText('La distancia y el ritmo');
    await expect(sheet.getByTestId('activity-type-a:running')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(sheet.getByTestId(`activity-day-${yesterday}`)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(sheet.getByTestId('activity-minutes-field')).toHaveValue('28');
    await sheet.getByTestId('activity-save').click();
    const training = await screen(page, 'training-screen');
    await expect(training.getByTestId('training-history')).toContainText('Ayer · Correr');
    // On the server before the page is loaded again.
    await expect.poll(async () => (await stored(page)).workouts.length).toBe(1);

    // AC1: "Describir" on a day screen; the sentence names no day, so the draft keeps that one.
    await page.goto(`/day/${twoDaysAgo}`);
    const day = await screen(page, 'day-screen');
    await day.getByTestId('day-log-workout').click();
    await day.getByTestId('day-describe').click();
    await expect(
      (await screen(page, 'workout-describe')).getByTestId('workout-describe-day'),
    ).toBeVisible();
    await prepare(page, 'pádel hora y media');
    sheet = await screen(page, 'activity-sheet');
    await expect(sheet.getByTestId('activity-type-a:padel')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(sheet.getByTestId(`activity-day-${twoDaysAgo}`)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(sheet.getByTestId('activity-minutes-field')).toHaveValue('90');
    await sheet.getByTestId('activity-save').click();
    await screen(page, 'training-screen');

    await expect
      .poll(async () =>
        (await stored(page)).workouts
          .map((w) => [w.activity, w.localDate, w.minutes, w.inputMethod])
          .sort(),
      )
      .toEqual(
        [
          ['padel', twoDaysAgo, 90, 'text'],
          ['running', yesterday, 28, 'text'],
        ].sort(),
      );
  });

  test('a gym session with another activity registers it from its line (AC6, AC10)', async ({
    page,
  }) => {
    await onboard(page, 'sentence-extra@example.com');
    await describeFromTab(page, 'press banca 3x8 con 60 y por la tarde fútbol 60 min');
    let session = await screen(page, 'session-screen');
    await expect(session.getByTestId('exercise-0')).toContainText('Press de banca');
    await expect(session.getByTestId('draft-extra-0')).toContainText('También: Fútbol · 60 min');

    await session.getByTestId('draft-extra-0-register').click();
    const sheet = await screen(page, 'activity-sheet');
    await expect(sheet.getByTestId('activity-type-a:football')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(sheet.getByTestId('activity-minutes-field')).toHaveValue('60');
    await sheet.getByTestId('activity-save').click();

    // Back to the draft it came from, without that line.
    session = await screen(page, 'session-screen');
    await expect(session.getByTestId('draft-extra-0')).toBeHidden();
    await expect.poll(async () => (await stored(page)).workouts.length).toBe(1);
    await save(page, '45');
    await expect
      .poll(async () =>
        (await stored(page)).workouts.map((w) => `${w.activity ?? 'gym'} ${w.inputMethod}`).sort(),
      )
      .toEqual(['football text', 'gym text']);
  });

  test('no workout, an unclear sentence and the daily cap keep the sentence and offer taps (AC9, AC17, AC20)', async ({
    page,
  }) => {
    await onboard(page, 'sentence-unreadable@example.com');
    await describeFromTab(page, 'hola, qué tal');
    const describe = await screen(page, 'workout-describe');
    await expect(describe.getByTestId('workout-describe-not_workout')).toContainText(
      'No encontramos ningún entreno en la frase',
    );
    await expect(describe.getByTestId('workout-describe-text')).toHaveValue('hola, qué tal');

    await prepare(page, 'lo de siempre');
    await expect(describe.getByTestId('workout-describe-unclear')).toContainText('Repetir');
    await expect(describe.getByTestId('workout-describe-not_workout')).toBeHidden();

    // AC17: the 20 sentences of the day are used (two above, 18 set on the mock server).
    await page.evaluate(() => {
      const key = 'pt.mock-db.v11';
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
        string,
        { aiUsage: Record<string, unknown>[] }
      >;
      for (const record of Object.values(db)) {
        for (let i = 0; i < 18; i++) {
          record.aiUsage.push({
            feature: 'workout_text',
            model: 'claude-haiku-5-5',
            inputTokens: 3000,
            outputTokens: 400,
            createdAt: new Date().toISOString(),
          });
        }
      }
      localStorage.setItem(key, JSON.stringify(db));
    });
    await page.goto('/training');
    await describeFromTab(page, 'press banca 3x8 con 60');
    const capped = await screen(page, 'workout-describe');
    await expect(capped.getByTestId('workout-describe-capReached')).toContainText(
      'Has llegado al límite de frases de hoy',
    );
    await expect(capped.getByTestId('workout-describe-text')).toHaveValue('press banca 3x8 con 60');
    await expect(capped.getByTestId('workout-describe-log-past')).toBeVisible();
    await capped.getByTestId('workout-describe-log-activity').click();
    await screen(page, 'activity-sheet');

    const { aiUsage, json, workouts } = await stored(page);
    expect(aiUsage.filter((u) => u.feature === 'workout_text')).toHaveLength(20);
    expect(workouts).toHaveLength(0);
    // AC20: no sentence is kept.
    expect(json).not.toContain('qué tal');
    expect(json).not.toContain('lo de siempre');
  });

  test('offline: no shortcut, but a draft received online is saved and syncs once (AC1, AC14)', async ({
    page,
  }) => {
    await emulateOnlineState(page);
    await onboard(page, 'sentence-offline@example.com');
    // The catalog and the stats are cached when the tab opens.
    let training = await openTab(page, 'training');
    await expect(training.getByTestId('training-first-hint')).toBeVisible();

    await setOffline(page, true);
    await expect(training.getByTestId('training-describe')).toBeDisabled();
    await expect(training.getByTestId('training-describe-offline')).toContainText(
      'Necesitas conexión para esto',
    );
    // Everything else keeps working.
    await expect(training.getByTestId('training-start')).toBeEnabled();
    await expect(training.getByTestId('training-log-activity')).toBeEnabled();
    await setOffline(page, false);
    await expect(training.getByTestId('training-describe')).toBeEnabled();

    await describeFromTab(page, 'press banca 3x8 con 60');
    await screen(page, 'session-screen');
    await setOffline(page, true);
    training = await save(page, '40');
    await expect(training.getByTestId('sync-badge')).toBeVisible();
    expect((await stored(page)).workouts).toHaveLength(0);

    await setOffline(page, false);
    await expect(training.getByTestId('sync-badge')).toBeHidden();
    await expect
      .poll(async () => (await stored(page)).workouts.map((w) => w.inputMethod))
      .toEqual(['text']);
  });
});
