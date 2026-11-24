import { tokens } from '@pt/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * "Describir entreno" (spec 012 AC1): opens the sentence field, for `date` when it comes from a day
 * screen. It needs a connection: offline it is disabled and says so; everything else keeps working.
 */
export function DescribeWorkoutButton({
  date,
  label,
  accessibilityLabel,
  testID,
}: {
  date?: string;
  label: string;
  accessibilityLabel: string;
  testID: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  return (
    <View style={styles.wrap}>
      <Button
        variant="secondary"
        label={label}
        accessibilityLabel={accessibilityLabel}
        disabled={!online}
        onPress={() =>
          router.push({ pathname: '/training/describe', params: date ? { date } : {} })
        }
        testID={testID}
      />
      {online ? null : (
        <AppText variant="caption" tone="muted" testID={`${testID}-offline`}>
          {t.training.describe.offline}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.space.xs, flexGrow: 1 },
});
