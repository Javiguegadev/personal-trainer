import { feedbackIsStale, foodKeys, isApiError } from '@pt/api-client';
import type { FeedbackSuggestion, MealItem, MealType, SafetyFlag } from '@pt/contracts';
import { FEEDBACK_SOURCE_URLS, feedbackAvailable, toLocalTime } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { useTheme } from '@/hooks/useTheme';
import { useDailyFeedback, useFoodLogSyncing } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { FeedbackNoteRow } from './FeedbackNoteRow';
import { Notice } from './Notice';

interface FeedbackCardProps {
  localDate: string;
  today: string;
  /** The live items of `localDate`, as the app shows them. */
  items: readonly MealItem[];
  safetyFlags: readonly SafetyFlag[];
  hasTargets: boolean;
}

/**
 * The daily feedback (spec 008): the "¿Cómo va el día?" button under the day's summary, the
 * training-day chip, and the notes once asked for. Not shown with `ed_soft_stop` or without numeric
 * targets (AC2). Give it `key={localDate}` so the chip starts off on every day.
 */
export function FeedbackCard({
  localDate,
  today,
  items,
  safetyFlags,
  hasTargets,
}: FeedbackCardProps) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const syncing = useFoodLogSyncing(localDate);
  const { feedback, ask } = useDailyFeedback(localDate);
  const [trainingDay, setTrainingDay] = useState(false);
  const f = t.feedback;

  if (!feedbackAvailable(safetyFlags, hasTargets)) return null;

  const isToday = localDate === today;
  const blocked = items.length === 0 ? f.button.empty : !online ? f.button.offline : null;
  const request = () =>
    ask.mutate({
      localDate,
      today,
      localTime: toLocalTime(new Date()),
      trainingDay,
      locale,
    });
  const stale = feedback !== null && feedbackIsStale(feedback, items);

  /** A suggestion opens the add screen on the next meal with the portion sheet ready (AC16). */
  const suggest = (suggestion: FeedbackSuggestion, meal: MealType) => {
    queryClient.setQueryData(foodKeys.food(suggestion.food.id, locale), suggestion.food);
    router.push({
      pathname: '/food/add',
      params: {
        date: localDate,
        meal,
        foodId: suggestion.food.id,
        portion: JSON.stringify(suggestion.portion),
      },
    });
  };

  const openSource = (id: keyof typeof FEEDBACK_SOURCE_URLS) => {
    const url = FEEDBACK_SOURCE_URLS[id];
    if (url) void Linking.openURL(url);
    else router.push('/settings/profile');
  };

  return (
    <View style={styles.gap} testID="feedback">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: trainingDay }}
        accessibilityLabel={isToday ? f.trainingChip.today : f.trainingChip.past}
        onPress={() => setTrainingDay((on) => !on)}
        style={[
          styles.trainingChip,
          {
            borderColor: trainingDay ? colors.primary : colors.border,
            backgroundColor: trainingDay ? colors.surfaceMuted : colors.surface,
          },
        ]}
        testID="feedback-training"
      >
        <AppText variant="label" tone={trainingDay ? 'primary' : 'default'}>
          {`${trainingDay ? '✓ ' : ''}${isToday ? f.trainingChip.today : f.trainingChip.past}`}
        </AppText>
      </Pressable>
      <Button
        variant="secondary"
        label={syncing ? f.button.syncing : isToday ? f.button.today : f.button.past}
        onPress={request}
        disabled={blocked !== null || syncing}
        loading={ask.isPending}
        accessibilityHint={blocked ?? undefined}
        testID="feedback-button"
      />
      {blocked ? (
        <AppText variant="caption" tone="muted" testID="feedback-blocked">
          {blocked}
        </AppText>
      ) : null}

      {ask.isError && !ask.isPending ? (
        <View style={styles.gap}>
          <Notice
            tone="danger"
            message={
              isApiError(ask.error, 'feedback_unavailable')
                ? t.errors.feedback_unavailable
                : f.state.error
            }
            testID="feedback-error"
          />
          {blocked === null && !syncing ? (
            <Button variant="ghost" label={t.common.retry} onPress={request} />
          ) : null}
        </View>
      ) : null}

      {ask.isPending && !feedback ? (
        <Card title={isToday ? f.title : f.titlePast} testID="feedback-loading">
          <AppText tone="muted" accessibilityLiveRegion="polite">
            {f.state.loading}
          </AppText>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.skeleton, { backgroundColor: colors.surfaceMuted }]} />
          ))}
        </Card>
      ) : null}

      {feedback ? (
        <Card title={isToday ? f.title : f.titlePast} testID="feedback-card">
          {stale ? (
            <View
              style={[styles.stale, { backgroundColor: colors.surfaceMuted }]}
              testID="feedback-stale"
            >
              <AppText variant="label" style={styles.staleText}>
                {f.state.stale}
              </AppText>
              <Button
                variant="ghost"
                label={f.state.update}
                onPress={request}
                loading={ask.isPending}
                disabled={blocked !== null || syncing}
                testID="feedback-update"
              />
            </View>
          ) : null}
          {feedback.notes.map((note, index) => (
            <FeedbackNoteRow
              key={note.observation.kind}
              note={note}
              state={feedback.state}
              index={index}
              onSuggest={suggest}
            />
          ))}
          <View style={styles.sources} testID="feedback-sources">
            <AppText variant="caption" weight="semibold" tone="muted">
              {f.sources.title}
            </AppText>
            {feedback.citations.map((id) => (
              <Pressable
                key={id}
                accessibilityRole="link"
                onPress={() => openSource(id)}
                style={styles.source}
              >
                <AppText variant="caption" tone="primary">
                  {f.sources[id]}
                </AppText>
              </Pressable>
            ))}
            <AppText variant="caption" tone="muted" testID="feedback-disclaimer">
              {f.disclaimer}
            </AppText>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: tokens.space.sm },
  trainingChip: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.space.md,
  },
  skeleton: { height: 48, borderRadius: tokens.radius.md },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: tokens.space.xs,
    borderRadius: tokens.radius.md,
    paddingLeft: tokens.space.sm,
  },
  staleText: { flex: 1 },
  sources: { gap: tokens.space.xs },
  source: { minHeight: 32, justifyContent: 'center' },
});
