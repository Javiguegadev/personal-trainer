import type { Profile, Targets } from '@pt/contracts';
import { dailyTotals, showsFoodNumbers } from '@pt/core';
import { useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useToday } from '@/hooks/useToday';
import { useFoodLog } from '@/lib/api';
import { Button } from './Button';
import { FeedbackCard } from './FeedbackCard';
import { Notice } from './Notice';
import { NutritionSummaryCard } from './NutritionSummaryCard';
import { TargetsCard } from './TargetsCard';

/**
 * The food block of "Today" (spec 005 AC17): what was eaten today against the targets, and "Registrar
 * comida". With an eating-disorder signal the plain targets card stays, without eaten numbers (AC18).
 */
export function TodayFoodCard({ profile, targets }: { profile: Profile; targets: Targets | null }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const today = useToday();
  const log = useFoodLog(today);
  const s = t.food.summary;

  // No meal in the link: the add screen preselects it from the time of day (AC12).
  const logFood = (
    <Button label={s.logFood} onPress={() => router.push('/food/add')} testID="log-food" />
  );
  if (!showsFoodNumbers(profile.safetyFlags)) {
    return (
      <>
        <TargetsCard status="ready" targets={targets} breakdown={null} />
        {logFood}
      </>
    );
  }

  const failed = log.isError && !log.data;
  const todayItems = (log.data ?? []).filter((item) => item.localDate === today);
  return (
    <NutritionSummaryCard
      title={s.title}
      totals={dailyTotals(todayItems)}
      targets={targets}
      noTargetsNote={t.targets.none}
      aside={
        log.isLoading ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
        ) : null
      }
      testID="targets-card"
    >
      {failed ? (
        <>
          <Notice tone="danger" message={t.food.loadError} />
          <Button variant="secondary" label={t.common.retry} onPress={() => void log.refetch()} />
        </>
      ) : null}
      {logFood}
      {log.data ? (
        <FeedbackCard
          key={today}
          localDate={today}
          today={today}
          items={todayItems}
          safetyFlags={profile.safetyFlags}
          hasTargets={targets !== null}
        />
      ) : null}
      {targets ? (
        <Button
          variant="ghost"
          label={t.today.howCalculated}
          onPress={() => router.push('/settings/profile')}
          testID="how-calculated-link"
        />
      ) : null}
    </NutritionSummaryCard>
  );
}
