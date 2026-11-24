import { isApiError, weekTargetsChange, type WeekSaveResult } from '@pt/api-client';
import { WEEK_LIMITS, type PlannedActivity, type Profile, type WorkPattern } from '@pt/contracts';
import {
  formatMinuteOfDay,
  formatNumber,
  isValidWorkBlock,
  timeOfDayOptions,
  weekNotices,
  weekToRequest,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityDaysRow } from '@/components/ActivityDaysRow';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { WeekNotices } from '@/components/WeekNotices';
import { WorkRow } from '@/components/WorkRow';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useToday } from '@/hooks/useToday';
import { useWeekText } from '@/hooks/useWeekText';
import { useMe, useSaveWeek } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { profileActivities, profileWeek } from '@/lib/week';

/** "Mi semana" (spec 010 AC1–AC6, AC21): work hours, training days and when the day starts. */
export default function WeekSettingsScreen() {
  const me = useMe();
  const profile = me.data?.profile;
  if (!profile) return <BlockingState />;
  return <WeekSettings profile={profile} />;
}

const DAY_START_OPTIONS = timeOfDayOptions(WEEK_LIMITS.dayStartStep, WEEK_LIMITS.dayStartMinuteMax);

function WeekSettings({ profile }: { profile: Profile }) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const today = useToday();
  const online = useOnline();
  const text = useWeekText();
  const save = useSaveWeek();
  const week = profileWeek(profile);
  const w = t.week;

  const [pattern, setPattern] = useState<WorkPattern | null>(week.workPattern);
  const [blocks, setBlocks] = useState(week.workBlocks);
  const [dayStart, setDayStart] = useState(week.dayStartMinute);
  const [activities, setActivities] = useState<PlannedActivity[]>(() => profileActivities(profile));
  const [showErrors, setShowErrors] = useState(false);
  const [result, setResult] = useState<WeekSaveResult | null>(null);

  const edited = () => {
    setResult(null);
    save.reset();
  };
  const workBlocks = pattern === 'fixed' ? blocks : [];
  const blocksValid = workBlocks.every(isValidWorkBlock);
  const notices = weekNotices({ workBlocks, plannedActivities: activities });

  const onSave = () => {
    setShowErrors(true);
    if (pattern === null || !blocksValid || !online) return;
    save.mutate(
      weekToRequest({
        workPattern: pattern,
        workBlocks: blocks,
        dayStartMinute: dayStart,
        plannedActivities: activities,
        today,
      }),
      { onSuccess: setResult },
    );
  };

  let saveError: string | null = null;
  if (save.isError) {
    saveError =
      isApiError(save.error, 'validation_error') && 'profile' in save.error.fields
        ? w.profileRequired
        : errorMessage(save.error, t);
  }

  return (
    <Screen
      dense
      testID="week-settings-screen"
      footer={
        <>
          {result ? <SavedNotice result={result} /> : null}
          {!online ? <Notice tone="warning" message={w.offline} testID="week-offline" /> : null}
          {saveError ? <Notice tone="danger" message={saveError} testID="week-error" /> : null}
          <Button
            label={w.save}
            onPress={onSave}
            loading={save.isPending}
            disabled={!online}
            testID="week-save"
          />
        </>
      }
    >
      <View style={styles.inset}>
        <BackLink fallback="/profile" />
        <AppText variant="title">{w.title}</AppText>
        <AppText tone="muted">{w.subtitle}</AppText>
      </View>

      <Card title={w.work} testID="week-work-card">
        <WorkRow
          pattern={pattern}
          blocks={blocks}
          onPatternChange={(next) => {
            setPattern(next);
            edited();
          }}
          onBlocksChange={(next) => {
            setBlocks(next);
            edited();
          }}
          patternError={showErrors && pattern === null ? w.patternRequired : null}
        />
      </Card>

      {activities.map((activity, index) => (
        <Card
          key={index}
          title={`${text.activityName(activity.kind, activity.label)} · ${format(
            t.onboarding.form.durationValue,
            { minutes: activity.minutesPerSession },
          )}`}
          testID={`week-activity-${index}`}
        >
          <ActivityDaysRow
            name={text.activityName(activity.kind, activity.label)}
            activity={activity}
            onChange={(next) => {
              setActivities(activities.map((a, i) => (i === index ? next : a)));
              edited();
            }}
            testID={`week-activity-${index}-row`}
          />
        </Card>
      ))}
      {activities.length === 0 ? (
        <View style={styles.inset}>
          <AppText tone="muted" testID="week-no-activities">
            {w.noActivities}
          </AppText>
          <Button
            variant="secondary"
            label={w.addActivities}
            onPress={() => router.push('/settings/profile')}
            testID="week-add-activities"
          />
        </View>
      ) : null}

      <View style={styles.inset}>
        <WeekNotices notices={notices} activities={activities} />
        <ChoiceGroup
          label={w.dayStart}
          hint={w.dayStartHint}
          layout="scroll"
          options={DAY_START_OPTIONS.map((minute) => ({
            value: String(minute),
            label: formatMinuteOfDay(minute, locale),
          }))}
          value={String(dayStart)}
          onChange={(value) => {
            setDayStart(Number(value));
            edited();
          }}
          testID="week-day-start"
        />
      </View>
    </Screen>
  );
}

/**
 * After "Guardar" (AC4): the old and new kcal when the number of training days changed the targets,
 * without numbers with an eating-disorder signal (spec 003 AC11), or just "saved".
 */
function SavedNotice({ result }: { result: WeekSaveResult }) {
  const { t, format, locale } = useI18n();
  const w = t.week;
  const change = weekTargetsChange(result);
  if (!change) return <Notice tone="success" message={w.saved} testID="week-saved" />;
  const { previous, current } = change;
  const numbers =
    previous &&
    current &&
    previous.kcal !== current.kcal &&
    !result.me.profile?.safetyFlags.includes('ed_soft_stop');
  return (
    <Notice
      tone="info"
      message={
        numbers
          ? format(w.targetsChanged, {
              from: formatNumber(previous.kcal, locale),
              to: formatNumber(current.kcal, locale),
            })
          : w.targetsUpdated
      }
      testID="week-targets-change"
    />
  );
}

const styles = StyleSheet.create({
  inset: { gap: tokens.space.md, paddingHorizontal: tokens.space.sm },
});
