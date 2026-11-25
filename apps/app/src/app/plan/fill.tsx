import {
  IsoDateSchema,
  type PlanResponse,
  type Profile,
  type Program,
  type Workout,
} from '@pt/contracts';
import {
  fillWeekWithRoutine,
  formatShortDate,
  formatWeekdayDay,
  planTargetWeeks,
  weekStartOf,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { usePlanText } from '@/hooks/usePlanText';
import { useToday } from '@/hooks/useToday';
import { useMe, usePlan, useProgram, useWorkouts } from '@/lib/api';
import { newId } from '@/lib/id';
import { profileActivities } from '@/lib/week';

/**
 * "Planificar con mi rutina" (spec 013 AC11), opened from the week view with `?week=` (its Monday): a
 * preview of the next routine sessions on the gym days of the typical week ("lun 30 · Rutina A ·
 * 18:30"), then "Planificar" with a 5-second undo. Without a routine it opens "Crea tu rutina"; without
 * gym days it links to "Mi semana".
 */
export default function PlanFillRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const today = useToday();
  const plan = usePlan(today);
  const program = useProgram();
  const log = useWorkouts(today);
  const params = useLocalSearchParams<{ week?: string }>();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!me.data?.profile || plan.isPending || program.isPending || log.isPending) {
    return <BlockingState />;
  }
  const week = IsoDateSchema.safeParse(params.week);
  // The current week or a later one inside the horizon (AC1, AC11).
  const plannable =
    week.success &&
    planTargetWeeks(today).some(
      (w) => w.weekStart === week.data && week.data === weekStartOf(week.data),
    );
  if (!week.success || !plannable) {
    return (
      <Screen testID="plan-fill-sheet">
        <Notice tone="info" message={t.plan.fill.invalid} testID="plan-fill-invalid" />
        <Button variant="secondary" label={t.plan.fill.close} onPress={close} />
      </Screen>
    );
  }
  if (!program.data || program.data.sessions.length === 0) {
    return <Redirect href="/training/routine/new" />;
  }
  return (
    <PlanFillSheet
      weekStart={week.data}
      today={today}
      profile={me.data.profile}
      program={program.data}
      workouts={log.data ?? []}
      plan={plan.data ?? { mealItems: [], workouts: [] }}
      close={close}
    />
  );
}

function PlanFillSheet({
  weekStart,
  today,
  profile,
  program,
  workouts,
  plan,
  close,
}: {
  weekStart: string;
  today: string;
  profile: Profile;
  program: Program;
  workouts: readonly Workout[];
  plan: PlanResponse;
  close: () => void;
}) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const actions = usePlanActions();
  const text = usePlanText();
  const f = t.plan.fill;
  const fill = (recordedAt: string) =>
    fillWeekWithRoutine({
      weekStart,
      today,
      program,
      activities: profileActivities(profile),
      workouts,
      planned: plan.workouts,
      newId,
      recordedAt,
    });
  const preview = fill(new Date().toISOString());

  const heading = (
    <View>
      <AppText variant="title">{f.title}</AppText>
      <AppText tone="muted">
        {format(f.weekOf, { date: formatShortDate(weekStart, locale) })}
      </AppText>
    </View>
  );

  if (preview.type !== 'ok' || preview.placed.length === 0) {
    const noDays = preview.type === 'no_gym_days';
    return (
      <Screen
        testID="plan-fill-sheet"
        footer={
          <>
            {noDays ? (
              <Button
                label={f.toWeek}
                onPress={() => router.replace('/settings/week')}
                testID="plan-fill-to-week"
              />
            ) : null}
            <Button variant="ghost" label={f.close} onPress={close} testID="plan-fill-close" />
          </>
        }
      >
        {heading}
        <Notice
          tone="info"
          message={noDays ? f.noGymDays : f.nothing}
          testID={noDays ? 'plan-fill-no-days' : 'plan-fill-nothing'}
        />
      </Screen>
    );
  }

  const save = () => {
    const result = fill(new Date().toISOString());
    if (result.type !== 'ok' || result.placed.length === 0) return close();
    const count = result.placed.length;
    actions.saveWithUndo(
      result.changes,
      result.undo,
      count === 1 ? f.doneOne : format(f.doneOther, { count: String(count) }),
    );
    close();
  };

  return (
    <Screen
      testID="plan-fill-sheet"
      footer={
        <>
          <Button label={f.save} onPress={save} testID="plan-fill-save" />
          <Button variant="ghost" label={f.cancel} onPress={close} testID="plan-fill-cancel" />
        </>
      }
    >
      {heading}
      <AppText>{f.intro}</AppText>
      <View style={styles.preview} testID="plan-fill-preview">
        {preview.placed.map((planned) => (
          <AppText key={planned.localDate} style={styles.line} testID="plan-fill-line">
            {format(f.line, {
              day: formatWeekdayDay(planned.localDate, locale),
              session: text.line(planned),
            })}
          </AppText>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { gap: tokens.space.xs },
  line: { paddingVertical: tokens.space.xs },
});
