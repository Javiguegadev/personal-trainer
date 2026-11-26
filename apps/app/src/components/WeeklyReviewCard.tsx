import type { Profile, WeeklyReview } from '@pt/contracts';
import { reviewToShow } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useReviewText } from '@/hooks/useReviewText';
import { useReview } from '@/lib/api';
import { useDismissedReviewWeek } from '@/lib/reviewPrefs';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { ReviewDecision } from './ReviewDecision';

/**
 * "Tu semana" on Today (spec 014 AC1): the last complete week's review until the user decides on its
 * proposal, or closes a review without one ("Entendido"); the next week's review replaces it. Offline
 * it shows the last one received (AC15). Nothing while the review loads or when there is none.
 */
export function TodayReview({ profile, today }: { profile: Profile; today: string }) {
  const review = useReview(today);
  const dismissedWeek = useDismissedReviewWeek();
  const shown = reviewToShow(review.data, dismissedWeek);
  if (!shown) return null;
  return <WeeklyReviewCard review={shown} profile={profile} today={today} />;
}

export function WeeklyReviewCard({
  review,
  profile,
  today,
}: {
  review: WeeklyReview;
  profile: Profile;
  today: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const text = useReviewText(profile.units);
  const [first, second] = text.cardLines(review.summary);
  return (
    <Card
      title={t.review.cardTitle}
      aside={
        <AppText variant="caption" tone="muted">
          {text.range(review.weekStart)}
        </AppText>
      }
      testID="weekly-review-card"
    >
      <View style={styles.summary} testID="review-card-summary">
        <AppText variant="label" weight="regular">
          {first}
        </AppText>
        <AppText variant="label" weight="regular">
          {second}
        </AppText>
      </View>
      <ReviewDecision review={review} today={today} units={profile.units} dismissible />
      <View style={styles.link}>
        <Button
          variant="ghost"
          label={t.review.open}
          onPress={() => router.push('/review')}
          testID="review-open"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: { gap: tokens.space.xs },
  link: { alignSelf: 'flex-start', marginLeft: -tokens.space.md },
});
