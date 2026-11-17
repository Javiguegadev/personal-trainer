import { expect, test } from '@playwright/test';
import { acceptConsent, confirmSummary, fillForm, screen, signInWithEmail } from './app';

test.describe('training focus (spec 004)', () => {
  test('"gain strength" raises the protein and shows on Today (AC2, AC4, AC6, AC12)', async ({
    page,
  }) => {
    await signInWithEmail(page, 'strength@example.com');
    const form = await acceptConsent(page);
    // AC2: health and general fitness is preselected.
    await expect(form.getByTestId('field-focus-general_fitness')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await fillForm(form, {
      sex: 'male',
      age: 30,
      height: { cm: '175' },
      weight: '80',
      job: 'sedentary',
      goal: 'maintain',
      focus: 'strength',
    });
    await form.getByTestId('form-continue').click();

    // AC6: man, 30, 175 cm, 80 kg, seated, maintain: 1.8 g/kg × 80 = 144 g (health would be 128 g).
    const summary = await screen(page, 'onboarding-summary-screen');
    await expect(summary.getByTestId('targets-kcal')).toContainText('2450');
    await expect(summary.getByTestId('targets-protein')).toContainText('144 g');
    // AC4: the breakdown names the focus and its protein per kg.
    await summary.getByTestId('how-calculated').click();
    const breakdown = summary.getByTestId('targets-breakdown');
    await expect(breakdown).toContainText('Ganar fuerza');
    await expect(breakdown).toContainText('1,8 g por kg');

    // Changing the focus in the summary updates the preview before anything is saved.
    await summary.getByTestId('field-focus-general_fitness').click();
    await expect(summary.getByTestId('targets-protein')).toContainText('128 g');
    await summary.getByTestId('field-focus-strength').click();
    await expect(summary.getByTestId('targets-protein')).toContainText('144 g');

    const today = await confirmSummary(page);
    await expect(today.getByTestId('targets-protein')).toContainText('144 g');
    await expect(today.getByTestId('training-for')).toHaveText('Para: ganar fuerza');
  });

  test('"perform in my sport" needs a named sport, then keeps the carbohydrates (AC3, AC5, AC7, AC12)', async ({
    page,
  }) => {
    await signInWithEmail(page, 'sport@example.com');
    const form = await acceptConsent(page);
    await fillForm(form, {
      sex: 'female',
      age: 30,
      height: { cm: '165' },
      weight: '60',
      job: 'sedentary',
      goal: 'lose',
      focus: 'sport_performance',
    });

    // AC3: no sport in the week → an error on the list and "Add a sport"; the form does not continue.
    await form.getByTestId('form-continue').click();
    await expect(form.getByTestId('training-error')).toContainText('añade al menos un deporte');
    await expect(page.getByTestId('onboarding-summary-screen')).toBeHidden();
    await form.getByTestId('add-sport').click();
    const card = form.getByTestId('activity-0');
    await expect(card.getByTestId('activity-0-kind-sport')).toHaveAttribute('aria-checked', 'true');
    await expect(form.getByTestId('add-sport')).toBeHidden();

    // AC3: the sport needs a name.
    await expect(card).toContainText('Ponle nombre a tu deporte.');
    await form.getByTestId('form-continue').click();
    await expect(page.getByTestId('onboarding-summary-screen')).toBeHidden();
    await card.getByTestId('activity-0-name').fill('fútbol');
    await expect(card).not.toContainText('Ponle nombre a tu deporte.');

    // Football 6 × 120 min, moderate: 720 min a week, a high training load.
    for (let i = 0; i < 3; i++) await card.getByTestId('activity-0-sessions-increase').click();
    await expect(card.getByTestId('activity-0-sessions-value')).toHaveText('6');
    await card.getByTestId('activity-0-duration-120').click();
    await form.getByTestId('form-continue').click();

    // AC7: TDEE 2319.9, deficit 232 → 2090 kcal; protein 108 g; carbs at least 5 × 60 = 300 g, so
    // fat 50 g and carbs 302 g.
    const summary = await screen(page, 'onboarding-summary-screen');
    await expect(summary.getByTestId('targets-kcal')).toContainText('2090');
    await expect(summary.getByTestId('targets-protein')).toContainText('108 g');
    await expect(summary.getByTestId('targets-fat')).toContainText('50 g');
    await expect(summary.getByTestId('targets-carbs')).toContainText('302 g');
    // AC5: the smaller deficit is explained.
    await expect(summary.getByTestId('notice-performance_deficit')).toBeVisible();
    // AC4: the breakdown shows the carbohydrate minimum.
    await summary.getByTestId('how-calculated').click();
    await expect(summary.getByTestId('targets-breakdown')).toContainText('mínimo de 5 g por kg');

    const today = await confirmSummary(page);
    await expect(today.getByTestId('targets-carbs')).toContainText('302 g');
    await expect(today.getByTestId('notice-performance_deficit')).toBeVisible();
    await expect(today.getByTestId('training-for')).toHaveText('Para: rendir en fútbol');
  });
});
