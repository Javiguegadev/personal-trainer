import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useRejectedPlanWrite } from '@/lib/api';
import { Button } from './Button';
import { Notice } from './Notice';

/** A queued plan write the API refused: it was undone entirely, and this says so (spec 013 AC22). */
export function PlanRejectedNotice() {
  const { t } = useI18n();
  const { rejected, dismiss } = useRejectedPlanWrite();
  if (!rejected) return null;
  return (
    <Notice tone="danger" message={t.plan.rejected} testID="plan-rejected-notice">
      <View style={styles.actions}>
        <Button variant="ghost" label={t.today.dismiss} onPress={dismiss} />
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
