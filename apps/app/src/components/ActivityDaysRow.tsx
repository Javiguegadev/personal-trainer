import { TRAINING_LIMITS } from '@pt/contracts';
import {
  activityStartMinute,
  setActivityStartMinute,
  setMatchDay,
  toggleActivityDay,
  type WithDays,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { Checkbox } from './Checkbox';
import { AppText } from './AppText';
import { Stepper } from './Stepper';
import { TimeField } from './TimeField';
import { WeekdayChips, type WeekdayKey } from './WeekdayChips';

interface ActivityDaysRowProps<A extends WithDays> {
  /** Names the chips for screen readers ("Gimnasio"). */
  name: string;
  activity: A;
  onChange: (activity: A) => void;
  testID: string;
}

/**
 * The days of one planned activity (spec 010 AC2): weekday chips, one optional start time for every
 * day, and for a sport each day can be a match with its own time. With no day picked, the "times per
 * week" stepper of spec 002 returns with the last count. Also used by the profile form (AC4).
 */
export function ActivityDaysRow<A extends WithDays>({
  name,
  activity,
  onChange,
  testID,
}: ActivityDaysRowProps<A>) {
  const { t, format } = useI18n();
  const w = t.week;
  const f = t.onboarding.form;
  const count = activity.days.length;
  const shared = activityStartMinute(activity);
  const hasTrainingDay = activity.days.some((d) => !d.isMatch);

  return (
    <View style={styles.group} testID={testID}>
      <View style={styles.header}>
        <AppText variant="label">{w.activityDays}</AppText>
        {count > 0 ? (
          <AppText variant="caption" tone="muted" testID={`${testID}-count`}>
            {count === 1 ? w.daysOne : format(w.daysOther, { count })}
          </AppText>
        ) : null}
      </View>
      <WeekdayChips
        label={name}
        selected={activity.days.map((d) => d.weekday)}
        onToggle={(weekday) => onChange(toggleActivityDay(activity, weekday))}
        testID={`${testID}-days`}
      />
      {count === 0 ? (
        <>
          <AppText variant="caption" tone="muted">
            {w.activityDaysHint}
          </AppText>
          <Stepper
            label={f.sessions}
            value={activity.sessionsPerWeek}
            min={TRAINING_LIMITS.sessionsPerWeek.min}
            max={TRAINING_LIMITS.sessionsPerWeek.max}
            onChange={(sessionsPerWeek) => onChange({ ...activity, sessionsPerWeek })}
            decreaseLabel={f.sessionsDecrease}
            increaseLabel={f.sessionsIncrease}
            testID={`${testID}-sessions`}
          />
        </>
      ) : (
        <>
          {hasTrainingDay ? (
            <TimeField
              label={w.startTime}
              value={shared}
              optional
              onChange={(minute) => onChange(setActivityStartMinute(activity, minute))}
              testID={`${testID}-time`}
            />
          ) : null}
          {activity.kind === 'sport'
            ? activity.days.map((day) => {
                const dayName = w.weekdayLong[day.weekday as WeekdayKey];
                return (
                  <View key={day.weekday} style={styles.match}>
                    <Checkbox
                      label={format(w.matchA11y, { day: dayName })}
                      checked={day.isMatch}
                      onChange={(isMatch) =>
                        onChange(
                          setMatchDay(activity, day.weekday, {
                            isMatch,
                            startMinute: isMatch ? (day.startMinute ?? shared) : null,
                          }),
                        )
                      }
                      testID={`${testID}-match-${day.weekday}`}
                    />
                    {day.isMatch ? (
                      <TimeField
                        label={format(w.matchTime, { day: dayName })}
                        value={day.startMinute}
                        optional
                        onChange={(startMinute) =>
                          onChange(
                            setMatchDay(activity, day.weekday, { isMatch: true, startMinute }),
                          )
                        }
                        testID={`${testID}-match-${day.weekday}-time`}
                      />
                    ) : null}
                  </View>
                );
              })
            : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  match: { gap: tokens.space.xs },
});
