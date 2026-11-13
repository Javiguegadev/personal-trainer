import { formatLongDate, profileNotices } from '@pt/core';
import { View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { TargetsCard } from '@/components/TargetsCard';
import { TrainingLine } from '@/components/TrainingLine';
import { WeightCard } from '@/components/WeightCard';
import { TargetsChangeNotice, WeightRejectedNotice } from '@/components/WeightNotices';
import { useI18n } from '@/hooks/useI18n';
import { useToday } from '@/hooks/useToday';
import { useMe } from '@/lib/api';

/**
 * "Today" (spec 003 AC3–AC5): the date, the daily targets, the weight and the planned training. Offline
 * it shows the last data received. Meals and workouts arrive with E4 and E5.
 */
export default function TodayScreen() {
  const { t, locale } = useI18n();
  const today = useToday();
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;

  const { profile, targets } = me.data;
  const notices = profileNotices({ flags: profile.safetyFlags }, targets);
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
      <TargetsCard status="ready" targets={targets} breakdown={null} />
      <SafetyNotices
        notices={notices}
        // A clamped target is exactly the safety minimum (rounded up to 10 kcal).
        floorKcal={targets?.clampedReason === 'calorie_floor' ? targets.kcal : undefined}
      />
      <WeightCard profile={profile} />
      <TrainingLine activities={profile.plannedActivities} />
    </Screen>
  );
}
