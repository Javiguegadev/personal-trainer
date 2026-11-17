import { normalizeBarcode, type BarcodeType } from '@pt/core';
import { tokens } from '@pt/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { BarcodeField } from './BarcodeField';
import { Button } from './Button';
import { Notice } from './Notice';
import { Screen } from './Screen';

export interface BarcodeScannerProps {
  /** A lookup is running: reads are ignored until it ends. */
  busy: boolean;
  /** Shown above the camera: "looking for the product", or that scanning needs a connection. */
  notice?: ReactNode;
  /** A valid barcode, read or typed, in its canonical form (spec 006 AC2). */
  onCode: (barcode: string) => void;
  onCancel: () => void;
}

const BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e'];

/** The same code is not reported again while the camera keeps seeing it. */
const SAME_CODE_MS = 3000;

/**
 * The barcode scanner of a phone (spec 006 AC1, AC2): the camera with a frame and a torch button, and
 * the code typed by hand as the way that always works. The permission is explained before the system
 * asks for it; when it is denied, the screen says how to enable it.
 */
export function BarcodeScanner({ busy, notice, onCode, onCancel }: BarcodeScannerProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = t.food.scan;
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [typing, setTyping] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const last = useRef<{ barcode: string; at: number } | null>(null);

  const onScanned = ({ type, data }: BarcodeScanningResult) => {
    // The symbology decides how eight digits are read (EAN-8 or UPC-E); an unknown name is ignored.
    const symbology = BARCODE_TYPES.find((known) => known === type);
    const barcode = normalizeBarcode(data, symbology);
    // A wrong check digit is a bad read: keep scanning.
    if (barcode === null) return;
    const now = Date.now();
    if (last.current?.barcode === barcode && now - last.current.at < SAME_CODE_MS) return;
    last.current = { barcode, at: now };
    onCode(barcode);
  };

  const footer = <Button variant="ghost" label={s.back} onPress={onCancel} testID="barcode-back" />;
  const title = <AppText variant="title">{s.title}</AppText>;

  if (!permission) {
    return (
      <Screen testID="barcode-scanner" footer={footer}>
        {title}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t.common.loading} />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen testID="barcode-scanner" footer={footer}>
        {title}
        {notice}
        {permission.canAskAgain ? (
          <Notice tone="info" title={s.permissionTitle} message={s.permissionText}>
            <Button
              label={s.allow}
              onPress={() => void requestPermission()}
              testID="barcode-allow"
            />
          </Notice>
        ) : (
          <Notice tone="info" title={s.permissionTitle} message={s.deniedText}>
            <Button
              variant="secondary"
              label={s.openSettings}
              onPress={() => void Linking.openSettings()}
            />
          </Notice>
        )}
        <BarcodeField busy={busy} onCode={onCode} />
      </Screen>
    );
  }

  return (
    <Screen testID="barcode-scanner" footer={footer}>
      {title}
      {notice}
      {cameraFailed ? (
        <Notice tone="warning" message={s.cameraError} />
      ) : (
        <>
          <View style={[styles.camera, { backgroundColor: colors.surface }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={busy ? undefined : onScanned}
              onMountError={() => setCameraFailed(true)}
            />
            <View style={[styles.frame, { borderColor: colors.onPrimary }]} pointerEvents="none" />
          </View>
          <AppText tone="muted">{s.frameHint}</AppText>
          <Button
            variant="secondary"
            label={torch ? s.torchOff : s.torchOn}
            onPress={() => setTorch(!torch)}
            testID="barcode-torch"
          />
        </>
      )}
      {typing || cameraFailed ? (
        <BarcodeField busy={busy} onCode={onCode} autoFocus={typing} />
      ) : (
        <Button
          variant="ghost"
          label={s.typeCode}
          onPress={() => setTyping(true)}
          testID="barcode-type"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: {
    height: 260,
    borderRadius: tokens.radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A wide frame, the shape of a barcode: it tells where to hold the product, not what is read.
  frame: {
    width: '80%',
    height: 110,
    borderWidth: 2,
    borderRadius: tokens.radius.md,
  },
});
