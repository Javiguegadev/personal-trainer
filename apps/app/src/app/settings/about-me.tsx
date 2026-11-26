import type { DailyCheckin, DietaryPrefs, Profile, Program, WeightEntry } from '@pt/contracts';
import {
  cmToFeetInches,
  computeAge,
  formatDecimal,
  formatNumber,
  isWeightTrendHidden,
  recentStress,
  usualSleep,
  weightTrend,
  type ClearableItem,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AboutMeSection, type AboutMeItem } from '@/components/AboutMeSection';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { CalibrationNotice } from '@/components/CalibrationNotice';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Screen } from '@/components/Screen';
import { UndoToast } from '@/components/UndoToast';
import type { WeekdayKey } from '@/components/WeekdayChips';
import { useDeferredClear } from '@/hooks/useDeferredClear';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useToday } from '@/hooks/useToday';
import { useWeightFormat } from '@/hooks/useWeightFormat';
import {
  useCheckins,
  useDeleteAllCheckins,
  useMe,
  useProgram,
  useResetCalibration,
  useWeights,
} from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { profileWeek } from '@/lib/week';

/**
 * "Lo que sé de ti" (spec 014 AC11–AC13): everything the app knows, grouped, declared or computed from
 * the logs, with "Cambiar" (the screen where it is edited today) and "Borrar" for the optional items.
 * The deletes and the reset need a connection (AC15).
 */
export default function AboutMeRoute() {
  const me = useMe();
  const today = useToday();
  const weights = useWeights(today);
  const checkins = useCheckins(today);
  const program = useProgram();
  if (!me.data?.profile) return <BlockingState />;
  return (
    <AboutMe
      profile={me.data.profile}
      prefs={me.data.dietaryPrefs}
      weights={weights.data ?? []}
      checkins={checkins.data ?? []}
      program={program.data ?? null}
      today={today}
    />
  );
}

function AboutMe({
  profile,
  prefs,
  weights,
  checkins,
  program,
  today,
}: {
  profile: Profile;
  prefs: DietaryPrefs | null;
  weights: readonly WeightEntry[];
  checkins: readonly DailyCheckin[];
  program: Program | null;
  today: string;
}) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const weight = useWeightFormat(profile.units);
  const clear = useDeferredClear();
  const deleteCheckins = useDeleteAllCheckins();
  const reset = useResetCalibration();
  const [confirmCheckins, setConfirmCheckins] = useState(false);
  const a = t.aboutMe;
  const v = a.values;
  const f = t.onboarding.form;

  const cleared = (item: ClearableItem) => clear.pending === item;
  const optional = (item: ClearableItem, present: boolean) =>
    present && !cleared(item) ? () => clear.request(item) : undefined;
  const list = (items: readonly string[] | undefined) =>
    items && items.length > 0 ? items.join(', ') : v.noneList;

  const height =
    profile.units === 'metric'
      ? format(v.heightCm, { cm: formatDecimal(profile.heightCm, locale) })
      : (({ feet, inches }) => format(v.heightFt, { ft: String(feet), in: String(inches) }))(
          cmToFeetInches(profile.heightCm),
        );

  const me: AboutMeItem[] = [
    {
      key: 'sex',
      label: a.items.sex,
      value: f.sexOptions[profile.sex],
      change: '/settings/profile',
      required: true,
    },
    {
      key: 'age',
      label: a.items.age,
      value: format(v.age, { age: String(computeAge(profile.birthDate, today)) }),
      change: '/settings/profile',
      required: true,
    },
    {
      key: 'height',
      label: a.items.height,
      value: height,
      change: '/settings/profile',
      required: true,
    },
    {
      key: 'weight',
      label: a.items.weight,
      value: weight.weight(profile.weightKg),
      change: '/settings/profile',
      required: true,
    },
    {
      key: 'targetWeight',
      label: a.items.targetWeight,
      value:
        profile.targetWeightKg === null || cleared('targetWeight')
          ? v.none
          : weight.weight(profile.targetWeightKg),
      change: '/settings/profile',
      clear: optional('targetWeight', profile.targetWeightKg !== null),
    },
  ];

  const goals: AboutMeItem[] = [
    {
      key: 'goal',
      label: a.items.goal,
      value: f.goalOptions[profile.requestedGoal],
      change: '/settings/profile',
      required: true,
    },
    {
      key: 'focus',
      label: a.items.focus,
      value: f.focusOptions[profile.trainingFocus ?? 'general_fitness'],
      change: '/settings/profile',
    },
  ];

  const { workPattern } = profileWeek(profile);
  const activities = profile.plannedActivities.map((activity) => {
    const values = {
      name: activity.label ?? t.week.kindName[activity.kind],
      sessions: String(activity.sessionsPerWeek),
      minutes: String(activity.minutesPerSession),
      days: activity.days.map((day) => t.week.weekdayShort[day.weekday as WeekdayKey]).join(' '),
    };
    return format(activity.days.length > 0 ? v.activityDays : v.activity, values);
  });
  const week: AboutMeItem[] = [
    {
      key: 'job',
      label: a.items.job,
      value: profile.jobActivity ? f.jobOptions[profile.jobActivity] : v.none,
      change: '/settings/profile',
    },
    {
      key: 'schedule',
      label: a.items.schedule,
      value: workPattern ? t.week.patternOptions[workPattern] : v.none,
      change: '/settings/week',
    },
    {
      key: 'activities',
      label: a.items.activities,
      value: activities.length > 0 ? activities.join('\n') : v.noActivities,
      change: '/settings/week',
    },
  ];

  const eating: AboutMeItem[] = [
    {
      key: 'diet',
      label: a.items.diet,
      value: prefs ? f.dietOptions[prefs.dietType] : v.none,
      change: '/settings/profile',
    },
    {
      key: 'allergies',
      label: a.items.allergies,
      value: cleared('allergies') ? v.noneList : list(prefs?.allergies),
      change: '/settings/profile',
      clear: optional('allergies', (prefs?.allergies.length ?? 0) > 0),
    },
    {
      key: 'dislikes',
      label: a.items.dislikes,
      value: cleared('dislikes') ? v.noneList : list(prefs?.dislikes),
      change: '/settings/profile',
      clear: optional('dislikes', (prefs?.dislikes.length ?? 0) > 0),
    },
  ];

  const reported = (['pregnancy', 'medical_condition', 'ed_soft_stop'] as const).filter((flag) =>
    profile.safetyFlags.includes(flag),
  );
  const health: AboutMeItem[] = [
    {
      key: 'conditions',
      label: a.items.conditions,
      value: list(reported.map((flag) => v.conditions[flag])),
      change: '/settings/profile',
    },
    {
      key: 'injuries',
      label: a.items.injuries,
      value: profile.injuries === null || cleared('injuries') ? v.noneList : profile.injuries,
      change: '/settings/profile',
      clear: optional('injuries', profile.injuries !== null),
    },
  ];

  const wizard = t.routine.wizard;
  const training: AboutMeItem[] = [
    {
      key: 'experience',
      label: a.items.experience,
      value: profile.trainingExperience ? wizard.experiences[profile.trainingExperience] : v.none,
      change: '/training/routine',
    },
    {
      key: 'equipment',
      label: a.items.equipment,
      value: profile.equipmentAccess ? wizard.equipments[profile.equipmentAccess] : v.none,
      change: '/training/routine',
    },
    {
      key: 'routine',
      label: a.items.routine,
      value: program?.name ?? v.noRoutine,
      change: '/training/routine',
    },
  ];

  const sleep = usualSleep(checkins, today);
  const stress = recentStress(checkins, today);
  const trend = weightTrend(weights, today).changePerWeekKg;
  const calibration = profile.energyCalibrationKcal;
  const signed = (value: number) =>
    `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value), locale)}`;
  const computed: AboutMeItem[] = [
    {
      key: 'sleep',
      label: a.items.sleep,
      value:
        sleep === null
          ? v.notEnough
          : format(sleep % 60 === 0 ? v.sleepHours : v.sleep, {
              hours: String(Math.floor(sleep / 60)),
              minutes: String(sleep % 60),
            }),
    },
    {
      key: 'stress',
      label: a.items.stress,
      value:
        stress === null
          ? v.notEnough
          : format(v.stress, { high: String(stress.highDays), days: String(stress.days) }),
    },
    // The weight trend stays hidden where Progress hides it (spec 003).
    ...(isWeightTrendHidden(profile.safetyFlags)
      ? []
      : [
          {
            key: 'trend',
            label: a.items.trend,
            value: trend === null ? v.notEnough : format(v.trend, { rate: weight.change(trend) }),
          },
        ]),
    {
      key: 'calibration',
      label: a.items.calibration,
      value:
        calibration === 0 ? v.noCalibration : format(v.calibration, { value: signed(calibration) }),
    },
  ];

  // "Necesita conexión" where an action is disabled (AC15).
  const offline =
    online || (calibration === 0 && checkins.length === 0) ? null : (
      <AppText variant="caption" tone="muted">
        {a.needsConnection}
      </AppText>
    );

  return (
    <Screen
      testID="about-me-screen"
      footer={
        clear.pending ? (
          <UndoToast
            message={format(a.cleared, { item: a.items[clear.pending] })}
            onUndo={clear.undo}
          />
        ) : undefined
      }
    >
      <BackLink fallback="/profile" />
      <AppText variant="title" accessibilityRole="header">
        {a.title}
      </AppText>
      <View style={styles.intro}>
        <AppText tone="muted" testID="about-me-intro">
          {a.intro}
        </AppText>
        <View style={styles.link}>
          <Button
            variant="ghost"
            label={a.download}
            onPress={() => router.push('/settings/privacy')}
            testID="about-me-download"
          />
        </View>
      </View>
      <OfflineBanner />
      <CalibrationNotice />
      {clear.error ? (
        <Notice
          tone="danger"
          message={format(a.clearError, { reason: errorMessage(clear.error, t) })}
          testID="about-me-clear-error"
        />
      ) : null}
      <AboutMeSection title={a.groups.me} items={me} online={online} />
      <AboutMeSection title={a.groups.goals} items={goals} online={online} />
      <AboutMeSection title={a.groups.week} items={week} online={online} />
      <AboutMeSection title={a.groups.eating} items={eating} online={online} />
      <AboutMeSection title={a.groups.health} items={health} online={online} />
      <AboutMeSection title={a.groups.training} items={training} online={online} />
      <AboutMeSection
        title={a.groups.computed}
        items={computed}
        online={online}
        testID="about-me-computed"
      >
        <View style={styles.actions}>
          {calibration !== 0 ? (
            <Button
              variant="secondary"
              label={a.resetCalibration}
              onPress={() => reset.mutate(today)}
              loading={reset.isPending}
              disabled={!online}
              testID="about-me-reset-calibration"
            />
          ) : null}
          {checkins.length > 0 && !confirmCheckins ? (
            <Button
              variant="secondary"
              label={a.deleteCheckins}
              onPress={() => setConfirmCheckins(true)}
              disabled={!online}
              testID="about-me-delete-checkins"
            />
          ) : null}
        </View>
        {confirmCheckins ? (
          <Notice
            tone="warning"
            message={a.deleteCheckinsConfirm}
            testID="about-me-checkins-confirm"
          >
            <View style={styles.actions}>
              <Button
                variant="danger"
                label={a.deleteCheckinsYes}
                onPress={() =>
                  deleteCheckins.mutate(undefined, { onSuccess: () => setConfirmCheckins(false) })
                }
                loading={deleteCheckins.isPending}
                disabled={!online}
                testID="about-me-checkins-yes"
              />
              <Button variant="ghost" label={a.cancel} onPress={() => setConfirmCheckins(false)} />
            </View>
          </Notice>
        ) : null}
        {deleteCheckins.isSuccess ? (
          <Notice tone="success" message={a.checkinsDeleted} testID="about-me-checkins-deleted" />
        ) : null}
        {deleteCheckins.isError || reset.isError ? (
          <Notice tone="danger" message={errorMessage(deleteCheckins.error ?? reset.error, t)} />
        ) : null}
        {offline}
      </AboutMeSection>
      <AppText variant="caption" tone="muted">
        {t.common.notMedicalAdvice}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: tokens.space.xs },
  link: { alignSelf: 'flex-start', marginLeft: -tokens.space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
