import { IsoDateSchema, WORKOUT_LIMITS, type Profile, type Weekday } from '@pt/contracts';
import {
  dayAccess,
  dayMeals,
  dayNotices,
  dayWorkBlock,
  daysBetween,
  formatLongDate,
  isoWeekday,
  lastDays,
  showsFoodNumbers,
  typicalDay,
  WEEK_VIEW,
  weekStartOf,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
import { Screen } from '@/components/Screen';
import { WorkoutRow } from '@/components/WorkoutRow';
import { useCheckinList } from '@/hooks/useCheckin';
import { useDraftGuard } from '@/hooks/useDraftGuard';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useTrainingActions } from '@/hooks/useTraining';
import { useWeekText } from '@/hooks/useWeekText';
import { useMe, usePendingMealItemIds, usePendingTrainingIds, useWeekLog } from '@/lib/api';
import { pastSessionStart } from '@/lib/trainingTime';
import { profileActivities, profileWeek } from '@/lib/week';

/**
 * A day of the week view (spec 010 AC11, AC12): its work hours, planned training, meals by meal type
 * and workouts, each opening its edit screen. Today and the 27 days before can add a meal or a
 * workout; older days are read-only; future days show only their typical week. The day's check-in
 * ("Cómo estaba"), the shift it tells and the shift overlap notices come from spec 011 (AC5, AC11,
 * AC12).
 */
export default function DayRoute() {
  const { t } = useI18n();
  const me = useMe();
  const today = useToday();
  const params = useLocalSearchParams<{ date: string }>();
  const parsed = IsoDateSchema.safeParse(params.date);
  if (!me.data?.profile) return <BlockingState />;

  // The range of the week view: 12 weeks back to the end of next week (AC10).
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
  return <DayScreen key={date} date={date} today={today} profile={me.data.profile} />;
}

function DayScreen({ date, today, profile }: { date: string; today: string; profile: Profile }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const text = useWeekText();
  const actions = useTrainingActions();
  const pendingItems = usePendingMealItemIds();
  const pendingWorkouts = usePendingTrainingIds();
  const [choosing, setChoosing] = useState(false);
  const draftGuard = useDraftGuard();
  const { checkins } = useCheckinList();
  const access = dayAccess(date, today);
  const monday = weekStartOf(date);
  const log = useWeekLog(monday, { enabled: access !== 'future' });
  const d = t.week.day;
  const flags = profile.safetyFlags;

  const week = {
    workBlocks: profileWeek(profile).workBlocks,
    plannedActivities: profileActivities(profile),
  };
  const typical = typicalDay(week, isoWeekday(date) as Weekday);
  const checkin = checkins.find((c) => c.localDate === date) ?? null;
  // The typical work block, or the shift told in the day's check-in (spec 011 AC11).
  const work = dayWorkBlock(week, checkin, date);
  const notices = dayNotices({ date, plannedActivities: week.plannedActivities, checkins });
  const meals = dayMeals(log.data?.mealItems ?? [], date, flags);
  const workouts = (log.data?.workouts ?? [])
    .filter((w) => w.localDate === date)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const canAdd = access === 'add';

  const startGym = () => {
    // An hour ago on that day; the day and the time can still be changed on the next screen.
    actions.startManual(date, pastSessionStart(date, today, new Date()));
    router.push({ pathname: '/training/session', params: { slot: 'draft' } });
  };
  // The sentence shortcut reads today and the 6 days before only (spec 012 AC1, AC4).
  const canDescribe = lastDays(today, WORKOUT_LIMITS.pastDaysUi).includes(date);

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
                showNumbers={showsFoodNumbers(flags)}
                pendingIds={pendingItems}
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

  return (
    <Screen testID="day-screen">
      <BackLink fallback="/" />
      <AppText variant="title" testID="day-title">
        {formatLongDate(date, locale)}
      </AppText>
      <OfflineBanner />
      {work || typical.training.length > 0 ? (
        <Card title={typical.training.length > 0 ? d.planned : d.work} testID="day-typical">
          {work ? (
            <AppText testID="day-work">
              {work.shift ? text.shift(work.shift, work) : `${d.work}: ${text.work(work)}`}
            </AppText>
          ) : null}
          {typical.training.map((slot) => (
            <AppText key={slot.activityIndex} testID={`day-planned-${slot.activityIndex}`}>
              {text.slot(slot)}
            </AppText>
          ))}
        </Card>
      ) : null}
      <DayNotices notices={notices} activities={week.plannedActivities} date={date} today={today} />
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
          {draftGuard.notice}
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
});
