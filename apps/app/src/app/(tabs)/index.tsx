import { formatLongDate, profileNotices } from '@pt/core';
import { View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { FoodRejectedNotice } from '@/components/FoodRejectedNotice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { TodayFoodCard } from '@/components/TodayFoodCard';
import { TrainingLine } from '@/components/TrainingLine';
import { WeightCard } from '@/components/WeightCard';
import { TargetsChangeNotice, WeightRejectedNotice } from '@/components/WeightNotices';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useMe } from '@/lib/api';

/**
 * "Today" (spec 003 AC3–AC5): the date, what was eaten against the daily targets (spec 005 AC17), the
 * weight and the planned training. Offline it shows the last data received. Workouts arrive with E5.
 */
export default function TodayScreen() {
  const { t, locale } = useI18n();
  const today = useToday();
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;

  const { profile, targets } = me.data;
  // No breakdown here: `profileNotices` derives the sport notices from the profile (spec 004 AC5, AC8).
  const notices = profileNotices({ flags: profile.safetyFlags }, targets, profile);
  return (
    <Screen testID="today-screen">
      <View>
        <AppText variant="title">{t.today.title}</AppText>
        <AppText tone="muted" testID="today-date">
          {formatLongDate(today, locale)}
        </AppText>
      </View>
      <OfflineBanner />
      <WeightRejectedNotice />
      <TargetsChangeNotice />
      <FoodRejectedNotice />
      <TodayFoodCard profile={profile} targets={targets} />
      <SafetyNotices
        notices={notices}
        // A clamped target is exactly the safety minimum (rounded up to 10 kcal).
        floorKcal={targets?.clampedReason === 'calorie_floor' ? targets.kcal : undefined}
      />
      <WeightCard profile={profile} />
      <TrainingLine activities={profile.plannedActivities} focus={profile.trainingFocus} />
    </Screen>
  );
}
