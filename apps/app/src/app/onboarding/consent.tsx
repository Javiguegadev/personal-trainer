import { CONSENT_VERSION } from '@pt/contracts';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/hooks/useI18n';
import { useGrantConsent } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { signOut } from '@/lib/session';

/** AC6: explicit health-data consent before anything is collected. */
export default function ConsentScreen() {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const grant = useGrantConsent();
  const points = [
    t.consent.points.what,
    t.consent.points.where,
    t.consent.points.ai,
    t.consent.points.control,
    t.consent.points.advice,
  ];

  return (
    <Screen
      testID="consent-screen"
      footer={
        <>
          {grant.isError ? <Notice tone="danger" message={errorMessage(grant.error, t)} /> : null}
          <Button
            label={t.consent.accept}
            onPress={() => grant.mutate({ kind: 'health_data', version: CONSENT_VERSION })}
            loading={grant.isPending}
            disabled={!checked}
            testID="accept-consent"
          />
          <Button variant="ghost" label={t.common.signOut} onPress={() => void signOut()} />
        </>
      }
    >
      <AppText variant="title">{t.consent.title}</AppText>
      <AppText>{t.consent.intro}</AppText>
      <View style={styles.list}>
        {points.map((point) => (
          <View key={point} style={styles.item}>
            <AppText tone="primary" weight="bold" importantForAccessibility="no">
              •
            </AppText>
            <AppText style={styles.itemText}>{point}</AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="muted">
        {t.consent.privacyPending}
      </AppText>
      <Checkbox
        label={t.consent.checkbox}
        checked={checked}
        onChange={setChecked}
        testID="consent-checkbox"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.sm },
  item: { flexDirection: 'row', gap: tokens.space.sm },
  itemText: { flex: 1 },
});
