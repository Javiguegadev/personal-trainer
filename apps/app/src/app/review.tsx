import type { Profile, ReviewResponse } from '@pt/contracts';
import { formatLongDate } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { CalibrationNotice } from '@/components/CalibrationNotice';
import { Card } from '@/components/Card';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ReviewDecision } from '@/components/ReviewDecision';
import { Screen } from '@/components/Screen';
import { StreakLine } from '@/components/StreakLine';
import { useI18n } from '@/hooks/useI18n';
import { useReviewText } from '@/hooks/useReviewText';
import { useToday } from '@/hooks/useToday';
import { useMe, useReview } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * The weekly review (spec 014): the streak, the last complete week's summary (AC2), its proposal and
 * reasons (AC3–AC6), the reviews before it, and how it works. Offline it shows the last review
 * received, with the decision disabled (AC15).
 */
export default function ReviewRoute() {
  const { t } = useI18n();
  const me = useMe();
  const today = useToday();
  const review = useReview(today);
  if (!me.data?.profile) return <BlockingState />;
  const profile = me.data.profile;

  return (
    <Screen testID="review-screen">
      <BackLink fallback="/" />
      <AppText variant="title" accessibilityRole="header">
        {t.review.title}
      </AppText>
      <OfflineBanner />
      <CalibrationNotice />
      {review.data ? (
        <ReviewContent data={review.data} profile={profile} today={today} />
      ) : review.isError ? (
        <Notice tone="danger" title={t.review.loadError} message={errorMessage(review.error, t)}>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={t.common.retry}
              onPress={() => void review.refetch()}
              testID="review-retry"
            />
          </View>
        </Notice>
      ) : (
        <AppText tone="muted" testID="review-loading">
          {t.common.loading}
        </AppText>
      )}
    </Screen>
  );
}

function ReviewContent({
  data,
  profile,
  today,
}: {
  data: ReviewResponse;
  profile: Profile;
  today: string;
}) {
  const { t, format, locale } = useI18n();
  const text = useReviewText(profile.units);
  const r = t.review;
  const { review, history } = data;
  return (
    <>
      <StreakLine streak={data.streak} />
      {review ? (
        <Card
          title={text.range(review.weekStart)}
          // A decided review says what was decided under its reasons; one without a proposal, here.
          aside={
            review.status === 'no_change' ? (
              <AppText variant="caption" tone="muted">
                {text.status(review)}
              </AppText>
            ) : null
          }
          testID="review-week"
        >
          <View style={styles.lines} testID="review-summary">
            {text.lines(review.summary).map((line) => (
              <AppText key={line.key} variant="label" weight="regular">
                {line.text}
              </AppText>
            ))}
          </View>
          <ReviewDecision review={review} today={today} units={profile.units} />
        </Card>
      ) : (
        <AppText tone="muted" testID="review-none">
          {data.firstReviewOn
            ? format(r.firstReview, { date: formatLongDate(data.firstReviewOn, locale) })
            : r.none}
        </AppText>
      )}
      {review ? (
        <Card title={r.history} testID="review-history">
          {history.length === 0 ? (
            <AppText tone="muted">{r.historyEmpty}</AppText>
          ) : (
            <View style={styles.lines}>
              {history.map((past) => (
                <AppText key={past.weekStart} variant="label" weight="regular">
                  {format(r.historyRow, {
                    range: text.range(past.weekStart),
                    status: text.status(past),
                  })}
                </AppText>
              ))}
            </View>
          )}
        </Card>
      ) : null}
      {/* Without a review to come (eating-disorder signal, pregnancy) there is nothing to explain. */}
      {review || data.firstReviewOn ? (
        <Card title={r.howTitle}>
          <AppText variant="label" weight="regular">
            {r.how}
          </AppText>
          <AppText variant="caption" tone="muted">
            {r.provisional}
          </AppText>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  lines: { gap: tokens.space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
