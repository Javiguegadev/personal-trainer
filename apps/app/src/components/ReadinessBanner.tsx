import { canTrainNormally, type LiveSession } from '@pt/core';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useReadinessText } from '@/hooks/useReadinessText';
import { dispatchSession, type SessionSlot } from '@/lib/liveSession';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * The reason a live session was lightened (spec 011 AC8): "Has dormido poco: hoy una serie menos por
 * ejercicio · Entrenar normal". "Entrenar normal" puts back what was removed (the sets already done
 * stay) and hides the line. A session with nothing removed shows only the reason.
 */
export function ReadinessBanner({ slot, session }: { slot: SessionSlot; session: LiveSession }) {
  const { t } = useI18n();
  const text = useReadinessText();
  const readiness = session.readiness;
  if (!readiness) return null;
  const r = t.readiness;
  return (
    <Notice tone="info" message={text.banner(readiness)} testID="readiness-banner">
      {canTrainNormally(session) ? (
        <View style={styles.start}>
          <Button
            variant="secondary"
            label={r.trainNormally}
            accessibilityHint={r.trainNormallyHint}
            onPress={() => dispatchSession(slot, { type: 'trainNormally' })}
            testID="readiness-train-normally"
          />
        </View>
      ) : null}
    </Notice>
  );
}

const styles = StyleSheet.create({ start: { alignSelf: 'flex-start' } });
