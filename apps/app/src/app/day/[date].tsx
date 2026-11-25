import {
  IsoDateSchema,
  WORKOUT_LIMITS,
  type PlannedWorkout,
  type Profile,
  type Weekday,
} from '@pt/contracts';
import {
  canPlan,
  dayAccess,
  dayMeals,
  dayNotices,
  dayPlanMeals,
  dayWorkBlock,
  daysBetween,
  formatLongDate,
  formatNumber,
  formatPortion,
  isoWeekday,
  lastDays,
  pendingPlannedWorkouts,
  planNotices,
  plannedDayEnergy,
  showsFoodNumbers,
  sortPlannedSessions,
  typicalDay,
  WEEK_VIEW,
  weekStartOf,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DayCheckin } from '@/components/DayCheckin';
import { DayNotices } from '@/components/DayNotices';
import { DescribeWorkoutButton } from '@/components/DescribeWorkoutButton';
import { MealSection } from '@/components/MealSection';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PlanNotices } from '@/components/PlanNotices';
import { PlanRejectedNotice } from '@/components/PlanRejectedNotice';
import { PlannedSessionRow, type PlannedSessionAction } from '@/components/PlannedSessionRow';
import { Screen } from '@/components/Screen';
import { SyncBadge } from '@/components/SyncBadge';
import { UndoToast } from '@/components/UndoToast';
import { WorkoutRow } from '@/components/WorkoutRow';
import { useCheckinList } from '@/hooks/useCheckin';
import { useDraftGuard } from '@/hooks/useDraftGuard';
import { useFoodLogActions } from '@/hooks/useFoodLogActions';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { usePlannedStart } from '@/hooks/usePlannedStart';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { useWeekText } from '@/hooks/useWeekText';
import {
  useMe,
  usePendingMealItemIds,
  usePendingPlanIds,
  usePendingTrainingIds,
  usePlan,
  useWeekLog,
} from '@/lib/api';
import { useFoodUndo } from '@/lib/foodUndo';
import { useSession } from '@/lib/liveSession';
import { usePlanUndo } from '@/lib/planUndo';
import { pastSessionStart } from '@/lib/trainingTime';
import { profileActivities, profileWeek } from '@/lib/week';

/**
 * A day of the week view (spec 010 AC11, AC12): its work hours, planned training, meals by meal type
 * and workouts, each opening its edit screen. Today and the 27 days before can add a meal or a
 * workout; older days are read-only; future days show only their typical week. The day's check-in
 * ("Cómo estaba"), the shift it tells and the shift overlap notices come from spec 011 (AC5, AC11,
 * AC12). The plan (spec 013): pending planned items under each meal with "Registrar lo planificado"
 * (AC8), the pending planned sessions with "Empezar", "Hecho" or "Registrar" (AC14–AC17), their notices
 * (AC13) and "Plan del día" with the planned energy (AC4); a future day lists its planned meals there.
 * Past days older than 27 days show only what was logged.
 */
export default function DayRoute() {
  const { t } = useI18n();
  const me = useMe();
  const today = useToday();
  const params = useLocalSearchParams<{ date: string }>();
  const parsed = IsoDateSchema.safeParse(params.date);
  if (!me.data?.profile) return <BlockingState />;

  // The range of the week view: 12 weeks back to the end of the plan horizon (AC10, spec 013 AC1).
  const date = parsed.success ? parsed.data : null;
  const inRange =
    date !== null &&
    daysBetween(weekStartOf(today), weekStartOf(date)) >= -7 * WEEK_VIEW.weeksBack &&
    daysBetween(weekStartOf(today), weekStartOf(date)) <= 7 * WEEK_VIEW.weeksForward;
  if (!date || !inRange) {
    return (
      <Screen testID="day-screen">
        <BackLink fallback="/" />
        <Notice tone="info" message={t.week.day.invalid} testID="day-invalid" />
      </Screen>
    );
  }
  return (
    <DayScreen
      key={date}
      date={date}
      today={today}
      profile={me.data.profile}
      targetKcal={me.data.targets?.kcal ?? null}
    />
  );
}

function DayScreen({
  date,
  today,
  profile,
  targetKcal,
}: {
  date: string;
  today: string;
  profile: Profile;
  targetKcal: number | null;
}) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const text = useWeekText();
  const actions = useTrainingActions();
  const foodActions = useFoodLogActions();
  const planActions = usePlanActions();
  const startPlanned = usePlannedStart();
  const pendingItems = usePendingMealItemIds();
  const pendingWorkouts = usePendingTrainingIds();
  const pendingPlan = usePendingPlanIds();
  const foodUndo = useFoodUndo();
  const planUndo = usePlanUndo();
  const live = useSession('live');
  const [choosing, setChoosing] = useState(false);
  const draftGuard = useDraftGuard();
  const { checkins } = useCheckinList();
  const access = dayAccess(date, today);
  const monday = weekStartOf(date);
  const log = useWeekLog(monday, { enabled: access !== 'future' });
  const plan = usePlan(today);
  const d = t.week.day;
  const flags = profile.safetyFlags;
  const showNumbers = showsFoodNumbers(flags);

  const week = {
    workBlocks: profileWeek(profile).workBlocks,
    plannedActivities: profileActivities(profile),
  };
  const typical = typicalDay(week, isoWeekday(date) as Weekday);
  const checkin = checkins.find((c) => c.localDate === date) ?? null;
  // The typical work block, or the shift told in the day's check-in (spec 011 AC11).
  const work = dayWorkBlock(week, checkin, date);
  const notices = dayNotices({ date, plannedActivities: week.plannedActivities, checkins });
  const loggedItems = log.data?.mealItems ?? [];
  const planItems = (plan.data?.mealItems ?? []).filter((p) => p.localDate === date);
  const planSessions = (plan.data?.workouts ?? []).filter((p) => p.localDate === date);
  // Pending planned items go under their meal where they can be logged (AC8).
  const meals = dayMeals(loggedItems, date, flags, access === 'add' ? planItems : []);
  const workouts = (log.data?.workouts ?? [])
    .filter((w) => w.localDate === date)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  // Nothing planned and not done is shown on a day older than the add window (spec 013 AC2, AC17).
  const pendingSessions =
    access === 'read_only'
      ? []
      : sortPlannedSessions(pendingPlannedWorkouts(planSessions, workouts));
  // A day with planned sessions shows them instead of the typical ones (spec 013 AC2).
  const typicalSlots = planSessions.length > 0 ? [] : typical.training;
  const planNoticeList = planNotices({
    date,
    planned: plan.data?.workouts ?? [],
    week,
    checkins,
  });
  const plannable = canPlan(date, today);
  const energy = plannedDayEnergy({
    date,
    today,
    planned: planItems,
    logged: loggedItems,
    flags,
    targetKcal,
  });
  const futureMeals =
    access === 'future'
      ? dayPlanMeals(planItems, [], date, flags).filter((m) => m.items.length)
      : [];
  const canAdd = access === 'add';

  const startGym = () => {
    // An hour ago on that day; the day and the time can still be changed on the next screen.
    actions.startManual(date, pastSessionStart(date, today, new Date()));
    router.push({ pathname: '/training/session', params: { slot: 'draft' } });
  };
  // The sentence shortcut reads today and the 6 days before only (spec 012 AC1, AC4).
  const canDescribe = lastDays(today, WORKOUT_LIMITS.pastDaysUi).includes(date);
  const sessionAction = (planned: PlannedWorkout): PlannedSessionAction | null => {
    if (access === 'future') return null;
    if (date < today) return 'log';
    if (planned.kind !== 'gym') return 'done';
    return live ? null : 'start';
  };
  const openPlanned = (id: string) => router.push({ pathname: '/plan/item/[id]', params: { id } });

  let logged;
  if (access === 'future') logged = null;
  else if (!log.data && log.fetchStatus === 'paused') {
    logged = <Notice tone="info" message={t.week.view.offline} testID="day-offline-empty" />;
  } else if (!log.data && log.isError) {
    logged = (
      <Notice tone="danger" message={d.loadError}>
        <Button variant="secondary" label={t.common.retry} onPress={() => void log.refetch()} />
      </Notice>
    );
  } else if (!log.data) {
    logged = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel={t.common.loading}
        style={styles.loading}
      />
    );
  } else if (meals.length === 0 && workouts.length === 0) {
    logged = (
      <AppText tone="muted" testID="day-nothing">
        {d.nothing}
      </AppText>
    );
  } else {
    logged = (
      <>
        {meals.length > 0 ? (
          <View style={styles.group} testID="day-meals">
            <AppText variant="subtitle" weight="bold" accessibilityRole="header">
              {d.meals}
            </AppText>
            {meals.map((meal) => (
              <MealSection
                key={meal.mealType}
                meal={meal.mealType}
                items={meal.items}
                showNumbers={showNumbers}
                pendingIds={[...pendingItems, ...pendingPlan]}
                repeatable={null}
                onAdd={
                  canAdd
                    ? () =>
                        router.push({
                          pathname: '/food/add',
                          params: { date, meal: meal.mealType },
                        })
                    : undefined
                }
                onRepeat={() => undefined}
                onOpenItem={(item) =>
                  router.push({
                    pathname: '/food/item/[id]',
                    params: { id: item.id, week: monday },
                  })
                }
                planned={meal.pending}
                onLogPlanned={canAdd ? () => planActions.logPlanned(meal.pending) : undefined}
                onOpenPlanned={(item) => openPlanned(item.id)}
              />
            ))}
          </View>
        ) : null}
        {workouts.length > 0 ? (
          <View style={styles.group} testID="day-workouts">
            <AppText variant="subtitle" weight="bold" accessibilityRole="header">
              {d.workouts}
            </AppText>
            {workouts.map((workout) => (
              <WorkoutRow
                key={workout.id}
                workout={workout}
                today={today}
                records={0}
                pending={pendingWorkouts.includes(workout.id)}
              />
            ))}
          </View>
        ) : null}
      </>
    );
  }

  const footer = foodUndo ? (
    <UndoToast
      message={
        foodUndo.kind === 'deleted'
          ? format(t.food.item.deleted, { food: foodUndo.item.label })
          : format(t.food.item.added, {
              count:
                foodUndo.items.length === 1
                  ? t.food.foodsOne
                  : format(t.food.foodsOther, { count: String(foodUndo.items.length) }),
            })
      }
      onUndo={() => foodActions.undo(foodUndo)}
    />
  ) : planUndo ? (
    <UndoToast message={planUndo.message} onUndo={() => planActions.undo(planUndo)} />
  ) : undefined;

  return (
    <Screen testID="day-screen" footer={footer}>
      <BackLink fallback="/" />
      <AppText variant="title" testID="day-title">
        {formatLongDate(date, locale)}
      </AppText>
      <OfflineBanner />
      <PlanRejectedNotice />
      {work || typicalSlots.length > 0 ? (
        <Card title={typicalSlots.length > 0 ? d.planned : d.work} testID="day-typical">
          {work ? (
            <AppText testID="day-work">
              {work.shift ? text.shift(work.shift, work) : `${d.work}: ${text.work(work)}`}
            </AppText>
          ) : null}
          {typicalSlots.map((slot) => (
            <AppText key={slot.activityIndex} testID={`day-planned-${slot.activityIndex}`}>
              {text.slot(slot)}
            </AppText>
          ))}
        </Card>
      ) : null}
      <DayNotices notices={notices} activities={week.plannedActivities} date={date} today={today} />
      {pendingSessions.length > 0 ? (
        <Card title={t.plan.sessionsTitle} testID="day-planned-sessions">
          {pendingSessions.map((planned) => {
            const action = sessionAction(planned);
            return (
              <PlannedSessionRow
                key={planned.id}
                planned={planned}
                action={action}
                pending={pendingPlan.includes(planned.id)}
                onAction={() =>
                  action === 'log' && planned.kind === 'gym'
                    ? draftGuard.guard(() => startPlanned(planned))
                    : startPlanned(planned)
                }
              />
            );
          })}
          {draftGuard.notice}
        </Card>
      ) : null}
      <PlanNotices notices={planNoticeList} planned={planSessions} />
      {plannable && (energy || futureMeals.length > 0) ? (
        <Card title={t.plan.dayTitle} testID="day-plan">
          {energy ? (
            <AppText tone="muted" testID="day-plan-energy">
              {energy.targetKcal === null
                ? format(t.plan.energyOnly, { kcal: formatNumber(energy.kcal, locale) })
                : format(t.plan.energy, {
                    kcal: formatNumber(energy.kcal, locale),
                    target: formatNumber(energy.targetKcal, locale),
                  })}
            </AppText>
          ) : null}
          {futureMeals.map((meal) => (
            <View key={meal.mealType} style={styles.planMeal} testID={`day-plan-${meal.mealType}`}>
              <AppText weight="bold">
                {[
                  t.food.meals[meal.mealType],
                  meal.kcal === null
                    ? null
                    : format(t.food.kcal, { value: formatNumber(meal.kcal, locale) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
              {meal.items.map((item) => (
                <Pressable
                  key={item.id}
                  role="button"
                  accessibilityLabel={format(t.plan.openPlanned, { food: item.label })}
                  onPress={() => openPlanned(item.id)}
                  style={({ pressed }) => [styles.planItem, { opacity: pressed ? 0.6 : 1 }]}
                  testID="day-plan-item"
                >
                  <AppText style={styles.flex}>
                    {[item.label, formatPortion(item, locale)].filter(Boolean).join(' · ')}
                  </AppText>
                  {pendingPlan.includes(item.id) ? <SyncBadge /> : null}
                </Pressable>
              ))}
            </View>
          ))}
        </Card>
      ) : null}
      {access === 'future' ? null : <DayCheckin checkin={checkin} date={date} access={access} />}
      {logged}
      {access === 'read_only' ? (
        <Notice tone="info" message={d.readOnly} testID="day-read-only" />
      ) : null}
      {canAdd ? (
        <View style={styles.group}>
          <Button
            label={d.addMeal}
            onPress={() => router.push({ pathname: '/food/add', params: { date } })}
            testID="day-add-meal"
          />
          {pendingSessions.length > 0 ? null : draftGuard.notice}
          {choosing ? (
            <View style={styles.choice} testID="day-workout-choice">
              <Button
                variant="secondary"
                label={d.logGym}
                onPress={() => draftGuard.guard(startGym)}
                testID="day-log-gym"
              />
              <Button
                variant="secondary"
                label={d.logActivity}
                onPress={() => router.push({ pathname: '/training/activity', params: { date } })}
                testID="day-log-activity"
              />
              {canDescribe ? (
                <DescribeWorkoutButton
                  date={date}
                  label={d.describe}
                  accessibilityLabel={d.describeA11y}
                  testID="day-describe"
                />
              ) : null}
            </View>
          ) : (
            <Button
              variant="secondary"
              label={d.logWorkout}
              onPress={() => setChoosing(true)}
              testID="day-log-workout"
            />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  choice: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  loading: { marginVertical: tokens.space.lg },
  planMeal: { gap: tokens.space.xs },
  planItem: {
    minHeight: tokens.layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  flex: { flex: 1 },
});
