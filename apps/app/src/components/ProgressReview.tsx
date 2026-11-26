import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useReview } from '@/lib/api';
import { Button } from './Button';
import { StreakLine } from './StreakLine';

/**
 * The streak and the way to the weekly review on Progress (spec 014 AC9, AC10). Offline it shows the
 * last ones received (AC15). Nothing while they load, and no link without a review to come
 * (eating-disorder signal, pregnancy).
 */
export function ProgressReview({ today }: { today: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { data } = useReview(today);
  if (!data) return null;
  const reviews = data.review !== null || data.firstReviewOn !== null;
  if (data.streak.hidden && !reviews) return null;
  return (
    <View style={styles.block} testID="progress-review">
      <StreakLine streak={data.streak} />
      {reviews ? (
        <View style={styles.link}>
          <Button
            variant="secondary"
            label={t.review.openWeekly}
            onPress={() => router.push('/review')}
            testID="progress-open-review"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: tokens.space.sm },
  link: { alignSelf: 'flex-start' },
});
