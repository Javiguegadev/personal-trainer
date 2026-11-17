import type { ImageUpload } from '@pt/contracts';
import { useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import { pickPhoto } from '@/lib/photo';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { Screen } from './Screen';

interface PlatePhotoPickerProps {
  online: boolean;
  onPhoto: (image: ImageUpload) => void;
  onCancel: () => void;
}

/**
 * "Foto del plato" (spec 007 AC3): take a photo or pick one, resized on the device. Each button opens
 * the picker straight from its press, as browsers require.
 */
export function PlatePhotoPicker({ online, onPhoto, onCancel }: PlatePhotoPickerProps) {
  const { t } = useI18n();
  const p = t.food.platePhoto;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    setBusy(true);
    try {
      const photo = await pickPhoto(source);
      if (photo.status === 'ok') onPhoto(photo.image);
      if (photo.status === 'denied') setError(p.permission);
    } catch {
      setError(p.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="plate-photo"
      footer={<Button variant="ghost" label={t.food.portion.cancel} onPress={onCancel} />}
    >
      <AppText variant="title" accessibilityRole="header">
        {p.title}
      </AppText>
      <AppText tone="muted">{p.hint}</AppText>
      {online ? null : <Notice tone="info" message={t.food.shortcuts.offline} />}
      {error ? <Notice tone="warning" message={error} testID="plate-photo-error" /> : null}
      <Button
        label={p.take}
        onPress={() => void pick('camera')}
        disabled={busy || !online}
        testID="plate-photo-take"
      />
      <Button
        variant="secondary"
        label={p.pick}
        onPress={() => void pick('library')}
        disabled={busy || !online}
        testID="plate-photo-pick"
      />
    </Screen>
  );
}
