import { formatNumber, isStaleSession, type LiveSession } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useNow } from '@/hooks/useNow';
import { useTheme } from '@/hooks/useTheme';
import { useStaleDismissed } from '@/lib/liveSession';
import { AppText } from './AppText';
import { Button } from './Button';
import { StaleSessionNotice } from './StaleSessionNotice';

/**
 * The session in progress, on the Training tab and on Today (spec 009 AC6, AC21): "Entreno en curso ·
 * 23 min · Continuar". A session open for more than 6 hours asks first whether it finished (AC13).
 */
export function SessionInProgress({ session, label }: { session: LiveSession; label: string }) {
  const { t, format, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const now = useNow(30_000);
  const dismissed = useStaleDismissed(session.id);
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(session.startedAt)) / 60_000));
  const open = (finish?: 'stale') =>
    router.push({
      pathname: '/training/session',
      params: finish ? { slot: 'live', finish } : { slot: 'live' },
    });

  if (isStaleSession(session, now.toISOString()) && !dismissed) {
    return <StaleSessionNotice session={session} onFinish={() => open('stale')} />;
  }
  return (
    <View
      style={[styles.card, { backgroundColor: colors.successSurface, borderColor: colors.success }]}
      testID="session-in-progress"
    >
      <AppText weight="bold" style={styles.text}>
        {format(label, { minutes: formatNumber(minutes, locale) })}
      </AppText>
      <Button label={t.training.continue} onPress={() => open()} testID="session-continue" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
  },
  text: { flex: 1, minWidth: 160 },
});
