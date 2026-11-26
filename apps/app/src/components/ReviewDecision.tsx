import type { Units, WeeklyReview } from '@pt/contracts';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useReviewText } from '@/hooks/useReviewText';
import { useDecideReview } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { dismissReview } from '@/lib/reviewPrefs';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * Why the review proposes what it does (AC3–AC5), and the proposal with "Aplicar (from → to kcal)" and
 * "Ahora no" (AC6). Both need a connection (AC15): offline they are disabled with "Necesita conexión".
 * A review without a proposal can be closed with "Entendido" where `dismissible` (the Today card); a
 * decided one says what was decided.
 */
export function ReviewDecision({
  review,
  today,
  units,
  dismissible = false,
}: {
  review: WeeklyReview;
  today: string;
  units: Units;
  dismissible?: boolean;
}) {
  const { t } = useI18n();
  const text = useReviewText(units);
  const online = useOnline();
  const decide = useDecideReview();
  const r = t.review;
  const proposal = review.status === 'proposed' ? review.proposal : null;
  const pending = decide.isPending ? decide.variables.decision : null;

  return (
    <View style={styles.gap} testID="review-decision">
      <View style={styles.reasons} testID="review-reasons">
        {review.reasons.length === 0 ? <AppText>{r.noChange}</AppText> : null}
        {review.reasons.map((reason) => (
          <AppText key={reason} testID={`review-reason-${reason}`}>
            {r.reasons[reason]}
          </AppText>
        ))}
      </View>
      {proposal ? (
        <>
          <View style={styles.reasons}>
            <AppText weight="bold" testID="review-proposal">
              {text.proposalText(proposal)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {r.proposalNote}
            </AppText>
          </View>
          {decide.isError ? (
            <Notice
              tone="danger"
              message={errorMessage(decide.error, t)}
              testID="review-decision-error"
            />
          ) : null}
          <View style={styles.actions}>
            <Button
              label={text.applyLabel(proposal)}
              onPress={() =>
                decide.mutate({ weekStart: review.weekStart, decision: 'accept', today })
              }
              loading={pending === 'accept'}
              disabled={!online || pending !== null}
              testID="review-apply"
            />
            <Button
              variant="secondary"
              label={r.notNow}
              onPress={() =>
                decide.mutate({ weekStart: review.weekStart, decision: 'reject', today })
              }
              loading={pending === 'reject'}
              disabled={!online || pending !== null}
              testID="review-reject"
            />
          </View>
          {online ? null : (
            <AppText variant="caption" tone="muted" testID="review-needs-connection">
              {r.needsConnection}
            </AppText>
          )}
        </>
      ) : review.status === 'no_change' ? (
        dismissible ? (
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={r.gotIt}
              onPress={() => dismissReview(review.weekStart)}
              testID="review-dismiss"
            />
          </View>
        ) : null
      ) : (
        <AppText weight="bold" testID="review-outcome">
          {text.outcome(review)}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.md },
  reasons: { gap: tokens.space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
