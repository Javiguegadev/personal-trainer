import type { PlannedActivity, Weekday } from '@pt/contracts';
import { isoWeekday, type DayNotice } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useWeekText } from '@/hooks/useWeekText';
import { Notice } from './Notice';

/**
 * The quiet notices of one day (spec 011 AC12): a planned training that overlaps the shift told in the
 * check-in. Same family as the work overlap of "Mi semana" (spec 010 AC5); never blocking.
 */
export function DayNotices({
  notices,
  activities,
  date,
  today,
}: {
  notices: readonly DayNotice[];
  activities: readonly PlannedActivity[];
  date: string;
  today: string;
}) {
  const { t, format } = useI18n();
  const text = useWeekText();
  if (notices.length === 0) return null;
  const n = t.week.dayNotices;

  const message = (notice: DayNotice) => {
    const activity = activities[notice.activityIndex];
    const values = {
      activity: activity ? text.activityNoun(activity.kind, activity.label) : '',
      day: text.day(isoWeekday(date) as Weekday),
      time: text.time(notice.startMinute),
    };
    return format(date === today ? n.shift_overlap_today : n.shift_overlap_day, values);
  };

  return (
    <View style={styles.group} testID="day-notices">
      {notices.map((notice) => (
        <Notice
          key={`${notice.type}-${notice.activityIndex}`}
          tone="info"
          message={message(notice)}
          testID={`day-notice-${notice.type}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: tokens.space.sm } });
