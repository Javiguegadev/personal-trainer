import { toLocalTime, type LiveSession } from '@pt/core';
import { tokens } from '@pt/ui';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { dismissStale } from '@/lib/liveSession';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * A live session open for more than 6 hours (spec 009 AC13): did it finish? "Sí" opens the summary
 * with the end at the last completed set; "No" stops asking for this session until the app restarts.
 */
export function StaleSessionNotice({
  session,
  onFinish,
}: {
  session: LiveSession;
  onFinish: () => void;
}) {
  const { t, format } = useI18n();
  const s = t.training.stale;
  return (
    <Notice
      tone="info"
      title={s.title}
      message={format(s.text, { time: toLocalTime(new Date(session.startedAt)) })}
      testID="stale-session"
    >
      <View style={styles.actions}>
        <Button label={s.finish} onPress={onFinish} testID="stale-finish" />
        <Button
          variant="secondary"
          label={s.continue}
          onPress={() => dismissStale(session.id)}
          testID="stale-continue"
        />
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
