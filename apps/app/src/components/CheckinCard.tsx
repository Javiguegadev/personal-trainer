import type { DailyCheckin } from '@pt/contracts';
import { checkinPrefill } from '@pt/core';
import { tokens } from '@pt/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCheckinActions } from '@/hooks/useCheckin';
import { useI18n } from '@/hooks/useI18n';
import { updateCheckinPrefs } from '@/lib/checkinPrefs';
import { Button } from './Button';
import { Card } from './Card';
import { CheckinForm } from './CheckinForm';

/**
 * "¿Qué tal hoy?" on Today (spec 011 AC1–AC3): prefilled so a typical morning is one tap, "Guardar".
 * "Hoy no" hides it until the next local day and stores nothing; skipping is free (no reminder, no
 * streak).
 */
export function CheckinCard({
  checkins,
  today,
  asksShift,
}: {
  checkins: readonly DailyCheckin[];
  today: string;
  asksShift: boolean;
}) {
  const { t } = useI18n();
  const actions = useCheckinActions();
  const [answers, setAnswers] = useState(() => checkinPrefill({ checkins, today, asksShift }));
  const c = t.checkin;
  return (
    <Card title={c.title} testID="checkin-card">
      <CheckinForm answers={answers} onChange={setAnswers} asksShift={asksShift} />
      <View style={styles.actions}>
        <Button label={c.save} onPress={() => actions.save(today, answers)} testID="checkin-save" />
        <Button
          variant="ghost"
          label={c.skip}
          accessibilityHint={c.skipHint}
          onPress={() => updateCheckinPrefs({ skippedOn: today })}
          testID="checkin-skip"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
});
