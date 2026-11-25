import {
  IsoDateSchema,
  MEAL_TYPES,
  type MealItem,
  type MealType,
  type PlanResponse,
  type Program,
  type Workout,
} from '@pt/contracts';
import {
  copyDay,
  copyWeek,
  copyWeekTargets,
  daysBetween,
  formatList,
  formatShortDate,
  formatWeekdayLongDay,
  WEEK_VIEW,
  weekStartOf,
  type CopyWhat,
  type PlanCopy,
} from '@pt/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TargetDayChips } from '@/components/TargetDayChips';
import { ToggleChips } from '@/components/ToggleChips';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { useToday } from '@/hooks/useToday';
import { useMe, usePlan, useProgram, useWeekLog } from '@/lib/api';
import { newId } from '@/lib/id';

/** What is copied from where: a day (`?from=`) or a week (`?week=`, its Monday). */
type Source = { kind: 'day'; from: string } | { kind: 'week'; fromWeek: string };

/**
 * "Copiar día" (spec 013 AC19, AC20) and "Copiar semana" (AC21), opened from a day screen or the week
 * view: what (some meal types, the sessions), where (target days, or a later week), a confirmation that
 * names the days whose plan is replaced, then the copy with a 5-second undo. Logs never change.
 */
export default function PlanCopyRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const today = useToday();
  const params = useLocalSearchParams<{ from?: string; week?: string }>();
  const current = weekStartOf(today);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const from = IsoDateSchema.safeParse(params.from);
  const week = IsoDateSchema.safeParse(params.week);
  // A day of the week view (12 weeks back to the horizon); a week from the current one on.
  const offset = (date: string) => daysBetween(current, weekStartOf(date)) / 7;
  const source: Source | null = week.success
    ? week.data === weekStartOf(week.data) &&
      offset(week.data) >= 0 &&
      copyWeekTargets(week.data, today).length > 0
      ? { kind: 'week', fromWeek: week.data }
      : null
    : from.success &&
        offset(from.data) >= -WEEK_VIEW.weeksBack &&
        offset(from.data) <= WEEK_VIEW.weeksForward
      ? { kind: 'day', from: from.data }
      : null;
  const sourceWeek = source
    ? source.kind === 'day'
      ? weekStartOf(source.from)
      : source.fromWeek
    : current;
  // A future week has no log; its plan is in the cached plan.
  const log = useWeekLog(sourceWeek, { enabled: source !== null && sourceWeek <= current });
  const plan = usePlan(today);
  const program = useProgram();

  if (!me.data?.profile) return <BlockingState />;
  if (!source) {
    return (
      <Screen testID="plan-copy-sheet">
        <Notice tone="info" message={t.plan.copy.invalid} testID="plan-copy-invalid" />
        <Button variant="secondary" label={t.plan.copy.close} onPress={close} />
      </Screen>
    );
  }
  const needsLog = sourceWeek <= current;
  if (
    plan.isPending ||
    program.isPending ||
    (needsLog && !log.data && log.fetchStatus === 'fetching')
  ) {
    return <BlockingState />;
  }
  if (needsLog && !log.data) {
    // Offline with that week never opened (spec 010 AC10), or an error: the copy would miss the logs.
    return (
      <Screen testID="plan-copy-sheet">
        {log.isError ? (
          <Notice tone="danger" message={t.week.day.loadError}>
            <Button variant="secondary" label={t.common.retry} onPress={() => void log.refetch()} />
          </Notice>
        ) : (
          <Notice tone="info" message={t.week.view.offline} testID="plan-copy-offline" />
        )}
        <Button variant="secondary" label={t.plan.copy.close} onPress={close} />
      </Screen>
    );
  }
  return (
    <PlanCopySheet
      source={source}
      today={today}
      logged={log.data?.mealItems ?? []}
      workouts={log.data?.workouts ?? []}
      plan={plan.data ?? { mealItems: [], workouts: [] }}
      program={program.data ?? null}
      close={close}
    />
  );
}

function PlanCopySheet({
  source,
  today,
  logged,
  workouts,
  plan,
  program,
  close,
}: {
  source: Source;
  today: string;
  logged: readonly MealItem[];
  workouts: readonly Workout[];
  plan: PlanResponse;
  program: Program | null;
  close: () => void;
}) {
  const { t, format, locale } = useI18n();
  const actions = usePlanActions();
  const c = t.plan.copy;
  const [meals, setMeals] = useState(true);
  const [mealTypes, setMealTypes] = useState<MealType[]>([...MEAL_TYPES]);
  const [sessions, setSessions] = useState(true);
  const [targets, setTargets] = useState<string[]>([]);
  const weekTargets = source.kind === 'week' ? copyWeekTargets(source.fromWeek, today) : [];
  const [toWeek, setToWeek] = useState<string | null>(weekTargets[0] ?? null);
  const [confirming, setConfirming] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const what: CopyWhat = { meals: meals ? mealTypes : [], sessions };
  const hasWhat = what.meals.length > 0 || what.sessions;
  const hasTarget = source.kind === 'day' ? targets.length > 0 : toWeek !== null;
  const run = (recordedAt: string): PlanCopy | null => {
    if (!hasWhat || !hasTarget) return null;
    const input = { today, what, logged, workouts, plan, program, newId, recordedAt };
    return source.kind === 'day'
      ? copyDay({ ...input, from: source.from, targets })
      : copyWeek({ ...input, fromWeek: source.fromWeek, toWeek: toWeek! });
  };
  const preview = run(new Date().toISOString());
  const nothing =
    preview !== null &&
    preview.changes.mealItems.upserts.length === 0 &&
    preview.changes.workouts.upserts.length === 0;

  const copy = () => {
    const result = run(new Date().toISOString());
    if (!result) return;
    const message =
      source.kind === 'week'
        ? c.copiedWeek
        : targets.length === 1
          ? c.copiedOne
          : format(c.copiedOther, { count: String(targets.length) });
    actions.saveWithUndo(result.changes, result.undo, message);
    close();
  };
  const submit = () => {
    if (!preview || nothing) {
      setShowErrors(true);
      return;
    }
    if (preview.replacedDays.length > 0) setConfirming(true);
    else copy();
  };

  const title =
    source.kind === 'day'
      ? format(c.dayTitle, { day: formatWeekdayLongDay(source.from, locale) })
      : format(c.weekTitle, { date: formatShortDate(source.fromWeek, locale) });

  if (confirming && preview) {
    // "Se sustituirá lo planificado del martes 25 y el jueves 27" (AC20).
    const days = formatList(
      preview.replacedDays.map((day, i) => {
        const name = formatWeekdayLongDay(day, locale);
        return i === 0 ? name : format(c.dayNext, { day: name });
      }),
      locale,
    );
    return (
      <Screen
        testID="plan-copy-confirm"
        footer={
          <>
            <Button label={c.replace} onPress={copy} testID="plan-copy-replace" />
            <Button variant="ghost" label={c.back} onPress={() => setConfirming(false)} />
          </>
        }
      >
        <AppText variant="title">{c.confirmTitle}</AppText>
        <AppText testID="plan-copy-replaced">{format(c.confirm, { days })}</AppText>
        {preview.capped ? (
          <Notice tone="info" message={c.capped} testID="plan-copy-capped" />
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      testID="plan-copy-sheet"
      footer={
        <>
          <Button label={c.copy} onPress={submit} testID="plan-copy-submit" />
          <Button variant="ghost" label={c.cancel} onPress={close} testID="plan-copy-cancel" />
        </>
      }
    >
      <AppText variant="title" testID="plan-copy-title">
        {title}
      </AppText>
      <AppText variant="label">{c.what}</AppText>
      <Checkbox label={c.meals} checked={meals} onChange={setMeals} testID="plan-copy-meals" />
      {meals ? (
        <ToggleChips
          label={c.mealTypes}
          options={MEAL_TYPES.map((value) => ({ value, label: t.food.meals[value] }))}
          selected={mealTypes}
          onToggle={(meal) =>
            setMealTypes((list) =>
              list.includes(meal) ? list.filter((m) => m !== meal) : [...list, meal],
            )
          }
          testID="plan-copy-meal"
        />
      ) : null}
      <Checkbox
        label={c.sessions}
        checked={sessions}
        onChange={setSessions}
        testID="plan-copy-sessions"
      />
      {showErrors && !hasWhat ? (
        <AppText variant="caption" tone="danger" role="alert">
          {c.pickWhat}
        </AppText>
      ) : null}
      {source.kind === 'day' ? (
        <TargetDayChips
          today={today}
          exclude={source.from}
          selected={targets}
          onToggle={(day) =>
            setTargets((list) =>
              list.includes(day) ? list.filter((d) => d !== day) : [...list, day],
            )
          }
          error={showErrors && !hasTarget ? c.pickTarget : null}
          testID="plan-copy-target"
        />
      ) : (
        <ChoiceGroup
          label={c.targetWeek}
          options={weekTargets.map((monday) => ({
            value: monday,
            label: format(c.weekOf, { date: formatShortDate(monday, locale) }),
          }))}
          value={toWeek}
          onChange={setToWeek}
          testID="plan-copy-week"
        />
      )}
      {nothing ? (
        <Notice
          tone="info"
          message={source.kind === 'day' ? c.nothingDay : c.nothingWeek}
          testID="plan-copy-nothing"
        />
      ) : null}
      {preview?.capped && !nothing ? (
        <Notice tone="info" message={c.capped} testID="plan-copy-capped" />
      ) : null}
    </Screen>
  );
}
