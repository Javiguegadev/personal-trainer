import type { Profile } from '@pt/contracts';
import { asksShift, checkinDue, dayNotices } from '@pt/core';
import { useTodayPlan, useTodayReadiness } from '@/hooks/useCheckin';
import { useCheckinPrefs } from '@/lib/checkinPrefs';
import { profileActivities, profileWeek } from '@/lib/week';
import { CheckinCard } from './CheckinCard';
import { DayNotices } from './DayNotices';
import { ReadinessLine } from './ReadinessLine';

/**
 * The check-in block of Today (spec 011): the card while it can change something today (AC1), the
 * readiness line once saved (AC4), and the notices of today's shift (AC12). Nothing until the cached
 * check-ins are known, rather than a card that disappears a moment later.
 */
export function TodayCheckin({ profile }: { profile: Profile }) {
  const { checkin, readiness, checkins, today, settled } = useTodayReadiness();
  const prefs = useCheckinPrefs();
  const plan = useTodayPlan(profile);
  if (!settled) return null;

  const { workPattern } = profileWeek(profile);
  const activities = profileActivities(profile);
  const due = checkinDue({
    today,
    activities,
    workPattern,
    hasCheckin: checkin !== null,
    skippedOn: prefs.skippedOn,
  });
  const notices = dayNotices({ date: today, plannedActivities: activities, checkins });

  return (
    <>
      {checkin ? (
        <ReadinessLine
          checkin={checkin}
          readiness={readiness}
          plan={plan}
          checkins={checkins}
          today={today}
        />
      ) : due ? (
        <CheckinCard checkins={checkins} today={today} asksShift={asksShift(workPattern)} />
      ) : null}
      <DayNotices notices={notices} activities={activities} date={today} today={today} />
    </>
  );
}
