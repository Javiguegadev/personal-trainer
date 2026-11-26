import { formatLongDate, profileNotices } from '@pt/core';
import { View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { CalibrationNotice } from '@/components/CalibrationNotice';
import { CheckinRejectedNotice } from '@/components/CheckinRejectedNotice';
import { FoodRejectedNotice } from '@/components/FoodRejectedNotice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PlanRejectedNotice } from '@/components/PlanRejectedNotice';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TodayCheckin } from '@/components/TodayCheckin';
import { TodayFoodCard } from '@/components/TodayFoodCard';
import { TodayWeek } from '@/components/TodayWeek';
import { TodayWorkoutCard } from '@/components/TodayWorkoutCard';
import { TrainingLine } from '@/components/TrainingLine';
import { TrainingRejectedNotice } from '@/components/TrainingRejectedNotice';
import { UndoToast } from '@/components/UndoToast';
import { WeightCard } from '@/components/WeightCard';
import { TodayReview } from '@/components/WeeklyReviewCard';
import { TargetsChangeNotice, WeightRejectedNotice } from '@/components/WeightNotices';
import { useI18n } from '@/hooks/useI18n';
import { usePlanActions } from '@/hooks/usePlanActions';
import { useToday } from '@/hooks/useToday';
import { useMe } from '@/lib/api';
import { usePlanUndo } from '@/lib/planUndo';
import { setTodayView, useTodayView, type TodayView } from '@/lib/todayView';

/**
 * "Today" (spec 003 AC3–AC5): the date, what was eaten against the daily targets (spec 005 AC17), the
 * weight, the workouts of the day (spec 009 AC21) and the planned training. Offline it shows the last
 * data received. The daily check-in sits above the workouts (spec 011 AC1, AC4). "Día" / "Semana"
 * switches to the week view (spec 010 AC7), remembered on the device. The day view opens with the
 * weekly review while it waits for a decision (spec 014 AC1).
 */
export default function TodayScreen() {
  const { t, locale } = useI18n();
  const today = useToday();
  const me = useMe();
  const view = useTodayView();
  const planActions = usePlanActions();
  const planUndo = usePlanUndo();
  if (!me.data?.profile) return <BlockingState />;

  const { profile, targets } = me.data;
  // No breakdown here: `profileNotices` derives the sport notices from the profile (spec 004 AC5, AC8).
  const notices = profileNotices({ flags: profile.safetyFlags }, targets, profile);
  return (
    <Screen
      testID="today-screen"
      footer={
        // "Planificar con mi rutina" and "Copiar semana" close onto the week view (spec 013 AC11, AC21).
        planUndo ? (
          <UndoToast message={planUndo.message} onUndo={() => planActions.undo(planUndo)} />
        ) : undefined
      }
    >
      <View>
        <AppText variant="title">{t.today.title}</AppText>
        <AppText tone="muted" testID="today-date">
          {formatLongDate(today, locale)}
        </AppText>
      </View>
      <SegmentedControl<TodayView>
        label={t.today.dayWeek.label}
        options={[
          { value: 'day', label: t.today.dayWeek.day },
          { value: 'week', label: t.today.dayWeek.week },
        ]}
        value={view}
        onChange={setTodayView}
        testID="today-view"
      />
      <OfflineBanner />
      <WeightRejectedNotice />
      <TargetsChangeNotice />
      <CalibrationNotice />
      <FoodRejectedNotice />
      <TrainingRejectedNotice />
      <CheckinRejectedNotice />
      <PlanRejectedNotice />
      {view === 'week' ? (
        <TodayWeek profile={profile} targets={targets} />
      ) : (
        <>
          <TodayReview profile={profile} today={today} />
          <TodayFoodCard profile={profile} targets={targets} />
          <SafetyNotices
            notices={notices}
            // A clamped target is exactly the safety minimum (rounded up to 10 kcal).
            floorKcal={targets?.clampedReason === 'calorie_floor' ? targets.kcal : undefined}
          />
          <WeightCard profile={profile} />
          <TodayCheckin profile={profile} />
          <TodayWorkoutCard profile={profile} />
          <TrainingLine activities={profile.plannedActivities} focus={profile.trainingFocus} />
        </>
      )}
    </Screen>
  );
}
