import { expect, type Locator, type Page } from '@playwright/test';

/** Mock auth (apps/app/src/lib/auth/mock.ts): any email signs in with this code. */
const MOCK_CODE = '123456';

/**
 * The navigator keeps earlier screens mounted but hidden, so the same test id can exist twice in the
 * page. Every lookup goes through the screen it belongs to, and waits for that screen to be on top.
 */
export async function screen(page: Page, testId: string): Promise<Locator> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  return locator;
}

async function openSignIn(page: Page): Promise<Locator> {
  await page.goto('/');
  const signIn = await screen(page, 'sign-in-screen');
  await expect(
    signIn.getByTestId('demo-banner'),
    'The app must run with the mock backend: pnpm --filter @pt/app web:mock',
  ).toBeVisible();
  return signIn;
}

/** AC1: email + 6-digit code. The code is submitted as soon as it is complete. */
export async function signInWithEmail(page: Page, email: string): Promise<void> {
  const signIn = await openSignIn(page);
  await signIn.getByTestId('email-input').fill(email);
  await signIn.getByTestId('send-code').click();
  const verify = await screen(page, 'verify-screen');
  await verify.getByTestId('otp-input').fill(MOCK_CODE);
}

/** AC3 on the mock: a fixed demo account. */
export async function signInWithGoogle(page: Page): Promise<void> {
  const signIn = await openSignIn(page);
  await signIn.getByTestId('google-sign-in').click();
}

/** AC6: nothing continues without the explicit checkbox. The form is the onboarding entry (ADR 004). */
export async function acceptConsent(page: Page): Promise<Locator> {
  const consent = await screen(page, 'consent-screen');
  await expect(consent.getByTestId('accept-consent')).toBeDisabled();
  await consent.getByTestId('consent-checkbox').click();
  await consent.getByTestId('accept-consent').click();
  return screen(page, 'onboarding-form-screen');
}

/** One activity card. Unset fields keep what "Add activity" inserts: strength, 3 × 60 min, moderate. */
export interface Activity {
  kind?: 'strength' | 'cardio' | 'sport' | 'other';
  name?: string;
  timesPerWeek?: number;
  minutes?: 30 | 45 | 60 | 90 | 120;
  intensity?: 'light' | 'moderate' | 'hard';
}

/** Adds an activity card with taps only (spec 002 AC2); the name is the one optional typed field. */
export async function addActivity(form: Locator, activity: Activity): Promise<void> {
  const index = await form.locator('[data-testid^="activity-"][data-testid$="-kind"]').count();
  await form.getByTestId('add-activity').click();
  const card = form.getByTestId(`activity-${index}`);
  await expect(card).toBeVisible();
  if (activity.kind) await card.getByTestId(`activity-${index}-kind-${activity.kind}`).click();
  if (activity.name) await card.getByTestId(`activity-${index}-name`).fill(activity.name);
  const DEFAULT_TIMES = 3;
  const times = activity.timesPerWeek ?? DEFAULT_TIMES;
  const step = times > DEFAULT_TIMES ? 'increase' : 'decrease';
  for (let i = 0; i < Math.abs(times - DEFAULT_TIMES); i++) {
    await card.getByTestId(`activity-${index}-sessions-${step}`).click();
  }
  await expect(card.getByTestId(`activity-${index}-sessions-value`)).toHaveText(String(times));
  if (activity.minutes) {
    await card.getByTestId(`activity-${index}-duration-${activity.minutes}`).click();
  }
  if (activity.intensity) {
    await card.getByTestId(`activity-${index}-intensity-${activity.intensity}`).click();
  }
}

export interface FormAnswers {
  sex: 'female' | 'male';
  /** The birth date is 1 January, so the age is the same on any day of the year. */
  age: number;
  height: { cm: string } | { ft: string; in: string };
  /** In kg, or in lb when the height is in feet. */
  weight: string;
  job: 'sedentary' | 'standing' | 'physical';
  /** Weekly training outside work. Omitted means "I don't train". */
  training?: Activity[];
  goal: 'lose' | 'maintain' | 'gain';
  /** What the user trains for (spec 004 AC2). Omitted keeps the preselected health and general fitness. */
  focus?: 'hypertrophy' | 'strength' | 'sport_performance' | 'general_fitness';
}

/** Fills the profile form with taps and fields; imperial units when the height is in feet. */
export async function fillForm(form: Locator, answers: FormAnswers): Promise<void> {
  await form.getByTestId(`field-sex-${answers.sex}`).click();
  await form.getByTestId('field-birth-day').fill('1');
  await form.getByTestId('field-birth-month').fill('1');
  await form.getByTestId('field-birth-year').fill(String(new Date().getFullYear() - answers.age));
  if ('cm' in answers.height) {
    await form.getByTestId('field-height-cm').fill(answers.height.cm);
  } else {
    await form.getByTestId('field-units-imperial').click();
    await form.getByTestId('field-height-ft').fill(answers.height.ft);
    await form.getByTestId('field-height-in').fill(answers.height.in);
  }
  await form.getByTestId('field-weight').fill(answers.weight);
  await form.getByTestId(`field-job-${answers.job}`).click();
  for (const activity of answers.training ?? []) await addActivity(form, activity);
  await form.getByTestId(`field-goal-${answers.goal}`).click();
  if (answers.focus) await form.getByTestId(`field-focus-${answers.focus}`).click();
  await form.getByTestId('field-diet-omnivore').click();
}

/** AC10: nothing is saved until the summary is confirmed; the root guard then opens "Today". */
export async function confirmSummary(page: Page): Promise<Locator> {
  const summary = await screen(page, 'onboarding-summary-screen');
  await expect(summary.getByTestId('targets-kcal')).toBeVisible();
  await summary.getByTestId('confirm-profile').click();
  return screen(page, 'today-screen');
}

const TAB_SCREENS = {
  today: 'today-screen',
  food: 'food-screen',
  progress: 'progress-screen',
  profile: 'profile-tab-screen',
} as const;

/** Spec 003 AC1: the tab bar (role "tab"). Returns the screen of that tab. */
export async function openTab(page: Page, tab: keyof typeof TAB_SCREENS): Promise<Locator> {
  const button = page.getByTestId(`tab-${tab}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
  return screen(page, TAB_SCREENS[tab]);
}

/** The user's day in the test time zone (Europe/Madrid, see playwright.config.ts). */
export async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

/** What the mock backend has stored (what the server has) for the only user of the test. */
export async function mockRecord<T>(page: Page): Promise<T | undefined> {
  return page.evaluate(() => {
    // Must match `MOCK_DB_KEY` in packages/api-client/src/mock/backend.ts.
    const db = JSON.parse(localStorage.getItem('pt.mock-db.v6') ?? '{}') as Record<string, unknown>;
    return Object.values(db)[0];
  }) as Promise<T | undefined>;
}

/**
 * Offline without blocking the dev server: the app reads `navigator.onLine` and the online/offline
 * events (lib/online.web.ts). A flag in sessionStorage keeps the state across a reload. Call it before
 * the first navigation.
 */
export async function emulateOnlineState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => sessionStorage.getItem('e2e-offline') !== '1',
    });
  });
}

export async function setOffline(page: Page, offline: boolean): Promise<void> {
  await page.evaluate((off) => {
    if (off) sessionStorage.setItem('e2e-offline', '1');
    else sessionStorage.removeItem('e2e-offline');
    // In the page `globalThis` is `window`.
    (globalThis as unknown as EventTarget).dispatchEvent(new Event(off ? 'offline' : 'online'));
  }, offline);
}

/** True once the queue of offline writes is saved on the device (about a second after a change). */
export async function hasSavedWrites(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Object.keys(localStorage).some(
      (key) =>
        key.startsWith('pt.query-cache.') &&
        (localStorage.getItem(key) ?? '').includes('"mutations":[{'),
    ),
  );
}

/**
 * A JPEG drawn in the page: big enough to be a real photo for the mock (a label, a plate), or a few
 * pixels, which the mock reads as "not a label" or "no food".
 */
export async function jpeg(page: Page, kind: 'photo' | 'tiny'): Promise<Buffer> {
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
    kind === 'photo' ? 600 : 2,
  );
  return Buffer.from(base64, 'base64');
}

/** Presses a button that opens the system picker and gives it the photo. */
export async function takePhoto(
  page: Page,
  button: Locator,
  kind: 'photo' | 'tiny',
): Promise<void> {
  const buffer = await jpeg(page, kind);
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer });
}
