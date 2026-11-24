import { IsoDateSchema, type DailyCheckin, type Profile } from '@pt/contracts';
import { asksShift, checkinPrefill, dayAccess, formatShortDate } from '@pt/core';
import { tokens } from '@pt/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { BlockingState } from '@/components/BlockingState';
import { Button } from '@/components/Button';
import { CheckinForm } from '@/components/CheckinForm';
import { Notice } from '@/components/Notice';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Screen } from '@/components/Screen';
import { useCheckinActions, useCheckinList } from '@/hooks/useCheckin';
import { useI18n } from '@/hooks/useI18n';
import { useMe } from '@/lib/api';
import { profileWeek } from '@/lib/week';

/**
 * The check-in of one day (spec 011 AC4, AC5): the same questions as the Today card, to add, change or
 * delete it, for today and the 27 days before. Opened from the readiness line and the day screen.
 * Works offline: the write is queued (AC14).
 */
export default function CheckinRoute() {
  const { t } = useI18n();
  const me = useMe();
  const params = useLocalSearchParams<{ date: string }>();
  const { checkins, today, settled } = useCheckinList();
  // Wait for the cached check-ins once: the form opens with the day's own answers.
  if (!me.data?.profile || !settled) return <BlockingState />;

  const parsed = IsoDateSchema.safeParse(params.date);
  const date = parsed.success ? parsed.data : null;
  const access = date === null ? null : dayAccess(date, today);
  if (date === null || access !== 'add') {
    return (
      <Screen testID="checkin-screen">
        <BackLink fallback="/" />
        <Notice
          tone="info"
          message={access === 'read_only' ? t.checkin.readOnly : t.checkin.invalid}
          testID="checkin-unavailable"
        />
      </Screen>
    );
  }
  return (
    <CheckinSheet
      key={date}
      date={date}
      today={today}
      profile={me.data.profile}
      checkins={checkins}
    />
  );
}

function CheckinSheet({
  date,
  today,
  profile,
  checkins,
}: {
  date: string;
  today: string;
  profile: Profile;
  checkins: readonly DailyCheckin[];
}) {
  const { t, format, locale } = useI18n();
  const router = useRouter();
  const actions = useCheckinActions();
  const own = checkins.find((c) => c.localDate === date) ?? null;
  // A shift told before the work pattern changed stays visible, so it can be cleared.
  const shift = asksShift(profileWeek(profile).workPattern) || (own?.workShift ?? null) !== null;
  const [answers, setAnswers] = useState(() =>
    checkinPrefill({ checkins, today: date, asksShift: shift }),
  );
  const c = t.checkin;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen testID="checkin-screen">
      <BackLink fallback="/" />
      <AppText variant="title" testID="checkin-title">
        {date === today
          ? c.todayTitle
          : format(c.dayTitle, { date: formatShortDate(date, locale) })}
      </AppText>
      <OfflineBanner />
      <CheckinForm answers={answers} onChange={setAnswers} asksShift={shift} />
      <View style={styles.actions}>
        <Button
          label={c.save}
          onPress={() => {
            actions.save(date, answers);
            close();
          }}
          testID="checkin-save"
        />
        {own ? (
          <Button
            variant="secondary"
            label={c.delete}
            onPress={() => {
              actions.remove(date);
              close();
            }}
            testID="checkin-delete"
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
