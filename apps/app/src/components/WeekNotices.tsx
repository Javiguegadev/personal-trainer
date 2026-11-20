import type { PlannedActivity } from '@pt/contracts';
import type { WeekNotice } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useWeekText } from '@/hooks/useWeekText';
import { Notice } from './Notice';

/**
 * The quiet notes under "Mi semana" (spec 010 AC5). Informative only: they never block the save and
 * never suggest training more.
 */
export function WeekNotices({
  notices,
  activities,
}: {
  notices: readonly WeekNotice[];
  activities: readonly PlannedActivity[];
}) {
  const { t, format } = useI18n();
  const text = useWeekText();
  const n = t.week.notices;
  if (notices.length === 0) return null;

  const noun = (index: number) => {
    const activity = activities[index];
    return activity ? text.activityNoun(activity.kind, activity.label) : '';
  };
  const message = (notice: WeekNotice) => {
    switch (notice.type) {
      case 'work_overlap':
        return format(n.work_overlap, {
          activity: noun(notice.activityIndex),
          day: text.day(notice.weekday),
        });
      case 'hard_before_match':
        return format(n.hard_before_match, {
          activity: noun(notice.activityIndex),
          day: text.day(notice.weekday),
        });
      case 'no_rest_day':
        return n.no_rest_day;
    }
  };

  return (
    <View style={styles.group} testID="week-notices">
      {notices.map((notice, index) => (
        <Notice
          key={`${notice.type}-${index}`}
          tone="info"
          message={message(notice)}
          testID={`week-notice-${notice.type}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: tokens.space.sm } });
