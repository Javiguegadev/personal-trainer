import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { Screen } from './Screen';

/** Why a scanned code gave no food: what the API answered, or that it could not be asked. */
export type ProductMiss = 'not_found' | 'incomplete' | 'unavailable' | 'rate_limited' | 'offline';

interface ProductNotFoundProps {
  barcode: string;
  reason: ProductMiss;
  /** A label photo is being taken: the buttons wait. */
  busy: boolean;
  /** False with an eating-disorder signal: the label photo, which fills in numbers, is not offered. */
  showNumbers: boolean;
  /** Shown under the options: the photo could not be taken. */
  error?: string | null;
  /** Asks again (the lookup failed, or the connection is back). */
  onRetry: () => void;
  onLabelPhoto: () => void;
  onByHand: () => void;
  onQuickAdd: () => void;
  onScanAnother: () => void;
  onCancel: () => void;
}

/**
 * A scanned code without a product (spec 006 AC6, AC7): the user can add it themselves, from a photo of
 * its label or by hand (both keep the barcode, so the next scan finds it), add it quickly with its
 * calories, or scan another. When the lookup itself failed, "Reintentar" comes first.
 */
export function ProductNotFound({
  barcode,
  reason,
  busy,
  showNumbers,
  error,
  onRetry,
  onLabelPhoto,
  onByHand,
  onQuickAdd,
  onScanAnother,
  onCancel,
}: ProductNotFoundProps) {
  const { t, format } = useI18n();
  const p = t.food.product;
  const failed = reason === 'unavailable' || reason === 'rate_limited' || reason === 'offline';
  const text = {
    not_found: format(p.notFoundText, { barcode }),
    incomplete: format(p.incompleteText, { barcode }),
    unavailable: p.failedText,
    rate_limited: p.rateLimited,
    offline: t.food.scan.offline,
  }[reason];

  return (
    <Screen
      testID="product-not-found"
      footer={
        <Button
          variant="ghost"
          label={t.food.portion.cancel}
          onPress={onCancel}
          testID="product-cancel"
        />
      }
    >
      <AppText variant="title" testID="product-miss-title">
        {failed ? p.failedTitle : p.notFoundTitle}
      </AppText>
      <AppText tone="muted" testID={`product-miss-${reason}`}>
        {text}
      </AppText>
      {failed ? (
        <Button label={p.retry} onPress={onRetry} disabled={busy} testID="product-retry" />
      ) : null}
      {/* Without a connection the photo cannot be read: the form by hand still works (it syncs later). */}
      {reason === 'offline' || !showNumbers ? null : (
        <Button
          variant={failed ? 'secondary' : 'primary'}
          label={p.labelPhoto}
          onPress={onLabelPhoto}
          loading={busy}
          testID="product-label-photo"
        />
      )}
      <Button
        variant={!failed && !showNumbers ? 'primary' : 'secondary'}
        label={p.byHand}
        onPress={onByHand}
        disabled={busy}
        testID="product-by-hand"
      />
      <Button
        variant="secondary"
        label={p.quickAdd}
        onPress={onQuickAdd}
        disabled={busy}
        testID="product-quick-add"
      />
      <Button
        variant="ghost"
        label={p.scanAnother}
        onPress={onScanAnother}
        disabled={busy}
        testID="product-scan-another"
      />
      {error ? <Notice tone="warning" message={error} testID="product-photo-error" /> : null}
    </Screen>
  );
}
