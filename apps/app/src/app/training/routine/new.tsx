import type { EquipmentAccess, Profile, TrainingExperience } from '@pt/contracts';
import {
  DEFAULT_TRAINING_FOCUS,
  emptyRoutine,
  routineDays,
  routineSafety,
  starterRoutine,
  type RoutineCatalogEntry,
} from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SafetyNotices } from '@/components/SafetyNotices';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useExerciseLookups } from '@/hooks/useTraining';
import { useMe, useSaveTrainingProfile } from '@/lib/api';
import { newId } from '@/lib/id';
import { setRoutineDraft } from '@/lib/routineDraft';
import { profileActivities } from '@/lib/week';

const EXPERIENCES: readonly TrainingExperience[] = ['beginner', 'intermediate', 'advanced'];
const EQUIPMENT: readonly EquipmentAccess[] = ['full_gym', 'home_dumbbells', 'bodyweight'];
const STEPS = 3;

/**
 * "Crea tu rutina" (spec 010 AC14, Safety): experience, equipment and the gym days of "Mi semana",
 * one screen each, then the proposal of `starterRoutine` opens in the editor. With pregnancy there is
 * no template: the midwife line and an empty routine built by hand.
 */
export default function RoutineWizardRoute() {
  const me = useMe();
  if (!me.data?.profile) return <BlockingState />;
  return <RoutineWizard profile={me.data.profile} />;
}

function RoutineWizard({ profile }: { profile: Profile }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const authState = useAuth();
  const saveTrainingProfile = useSaveTrainingProfile();
  const { catalog, exercises } = useExerciseLookups();
  const [step, setStep] = useState(0);
  const [experience, setExperience] = useState<TrainingExperience | null>(
    profile.trainingExperience,
  );
  const [equipment, setEquipment] = useState<EquipmentAccess | null>(profile.equipmentAccess);
  const r = t.routine;
  const w = r.wizard;
  const safety = routineSafety(profile.safetyFlags);
  const gym = routineDays(profileActivities(profile));
  const catalogByKey = useMemo(
    () =>
      new Map<string, RoutineCatalogEntry>(
        exercises.flatMap((e) => (e.key === null ? [] : [[e.key, e] as const])),
      ),
    [exercises],
  );

  const cancel = () => (router.canGoBack() ? router.back() : router.replace('/training'));
  const openEditor = () => router.replace('/training/routine');
  const changeWeek = () => router.push('/settings/week');

  const painLine = safety.showsPainLine ? (
    <AppText variant="caption" tone="muted" testID="routine-pain-line">
      {r.painLine}
    </AppText>
  ) : null;

  if (!safety.buildsTemplate) {
    return (
      <Screen testID="routine-wizard">
        <AppText variant="title">{w.title}</AppText>
        <Notice tone="info" message={w.pregnancy} testID="routine-pregnancy" />
        {painLine}
        <Button
          variant="secondary"
          label={w.empty}
          onPress={() => {
            setRoutineDraft(
              emptyRoutine({ newId, name: w.emptyName, sessionName: w.emptySession }),
            );
            openEditor();
          }}
          testID="routine-empty"
        />
        <Button variant="ghost" label={w.cancel} onPress={cancel} />
      </Screen>
    );
  }

  if (!gym) {
    return (
      <Screen testID="routine-wizard">
        <AppText variant="title">{w.title}</AppText>
        <AppText tone="muted">{r.needsGym}</AppText>
        <Button variant="secondary" label={r.needsGymLink} onPress={changeWeek} />
        <Button variant="ghost" label={w.cancel} onPress={cancel} />
      </Screen>
    );
  }

  const finish = () => {
    if (!experience || !equipment) return;
    const draft = starterRoutine(
      {
        days: gym.days,
        minutes: gym.minutes,
        experience,
        equipment,
        focus: profile.trainingFocus ?? DEFAULT_TRAINING_FOCUS,
        flags: profile.safetyFlags,
      },
      {
        catalogByKey,
        locale,
        newId,
        names: { program: (key) => r.templates[key], session: (key) => r.sessions[key] },
      },
    );
    if (!draft) return;
    const userId = authState.status === 'signedIn' ? authState.session.userId : null;
    if (
      userId &&
      (experience !== profile.trainingExperience || equipment !== profile.equipmentAccess)
    ) {
      saveTrainingProfile.mutate({ id: userId, update: { experience, equipment } });
    }
    setRoutineDraft(draft);
    openEditor();
  };

  let body;
  if (step === 0) {
    body = (
      <ChoiceGroup
        label={w.experience}
        options={EXPERIENCES.map((value) => ({ value, label: w.experiences[value] }))}
        value={experience}
        onChange={setExperience}
        layout="list"
        testID="routine-experience"
      />
    );
  } else if (step === 1) {
    body = (
      <ChoiceGroup
        label={w.equipment}
        options={EQUIPMENT.map((value) => ({ value, label: w.equipments[value] }))}
        value={equipment}
        onChange={setEquipment}
        layout="list"
        testID="routine-equipment"
      />
    );
  } else {
    body = (
      <View style={styles.gap}>
        <Card title={w.days} testID="routine-days">
          <AppText weight="bold" testID="routine-days-value">
            {gym.days === 1
              ? format(w.daysOne, { minutes: gym.minutes })
              : format(w.daysOther, { count: gym.days, minutes: gym.minutes })}
          </AppText>
          <AppText variant="caption" tone="muted">
            {w.daysHint}
          </AppText>
          <Button
            variant="ghost"
            label={w.change}
            onPress={changeWeek}
            testID="routine-days-change"
          />
        </Card>
        {profile.safetyFlags.includes('high_training_load') ? (
          <SafetyNotices notices={['high_training_load']} />
        ) : null}
        {catalog.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
        ) : catalog.isError && !catalog.data ? (
          <View style={styles.gap}>
            <Notice tone="danger" message={t.training.picker.loadError} />
            <Button
              variant="secondary"
              label={t.common.retry}
              onPress={() => void catalog.refetch()}
            />
          </View>
        ) : null}
      </View>
    );
  }

  const canGoOn = step === 0 ? experience !== null : step === 1 ? equipment !== null : true;
  const last = step === STEPS - 1;
  return (
    <Screen
      testID="routine-wizard"
      footer={
        <>
          <Button
            label={last ? w.finish : w.next}
            disabled={!canGoOn || (last && catalogByKey.size === 0)}
            onPress={last ? finish : () => setStep(step + 1)}
            testID="routine-wizard-next"
          />
          <Button
            variant="ghost"
            label={step === 0 ? w.cancel : w.back}
            onPress={step === 0 ? cancel : () => setStep(step - 1)}
            testID="routine-wizard-back"
          />
        </>
      }
    >
      <View>
        <AppText variant="title">{w.title}</AppText>
        <AppText tone="muted" testID="routine-wizard-step">
          {format(w.step, { n: step + 1, total: STEPS })}
        </AppText>
      </View>
      <OfflineBanner />
      {painLine}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.md },
});
