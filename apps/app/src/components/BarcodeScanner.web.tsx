import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { BarcodeField } from './BarcodeField';
import type { BarcodeScannerProps } from './BarcodeScanner';
import { Button } from './Button';
import { Screen } from './Screen';

/**
 * The scanner in a browser (spec 006 AC1): the code is typed. The Expo camera lists web support for
 * barcodes without saying which types it reads there, so the camera stays on the phone until a test in
 * a real browser shows that EAN-13 works.
 */
export function BarcodeScanner({ busy, notice, onCode, onCancel }: BarcodeScannerProps) {
  const { t } = useI18n();
  const s = t.food.scan;
  return (
    <Screen
      testID="barcode-scanner"
      footer={<Button variant="ghost" label={s.back} onPress={onCancel} testID="barcode-back" />}
    >
      <AppText variant="title">{s.title}</AppText>
      <AppText tone="muted">{s.webOnly}</AppText>
      {notice}
      <BarcodeField busy={busy} onCode={onCode} autoFocus />
    </Screen>
  );
}
