import type { PlannedWorkout } from '@pt/contracts';
import type { PlanNotice } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { usePlanText } from '@/hooks/usePlanText';
import { Notice } from './Notice';

/**
 * The quiet notices of a planned day (spec 013 AC13): a session over the work hours or the shift, and a
 * strength session or a hard activity the day before a match. Never blocking, never a judgement.
 */
export function PlanNotices({
  notices,
  planned,
}: {
  notices: readonly PlanNotice[];
  planned: readonly PlannedWorkout[];
}) {
  const { t, format } = useI18n();
  const text = usePlanText();
  if (notices.length === 0) return null;
  const n = t.plan.notices;

  const message = (notice: PlanNotice) => {
    const session = planned.find((p) => p.id === notice.plannedId);
    const values = {
      session: session ? text.name(session) : '',
      time: session?.startMinute != null ? text.time(session.startMinute) : '',
    };
    if (notice.type === 'hard_before_match') return format(n.hard_before_match, values);
    return format(notice.shift ? n.shift_overlap : n.work_overlap, values);
  };

  return (
    <View style={styles.group} testID="plan-notices">
      {notices.map((notice) => (
        <Notice
          key={`${notice.type}-${notice.plannedId}`}
          tone="info"
          message={message(notice)}
          testID={`plan-notice-${notice.type}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: tokens.space.sm } });
