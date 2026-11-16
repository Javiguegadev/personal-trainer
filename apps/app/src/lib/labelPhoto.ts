import { LABEL_SCAN_LIMITS, type LabelImage } from '@pt/contracts';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type LabelPhoto =
  | { status: 'ok'; image: LabelImage }
  | { status: 'cancelled' }
  /** The user refused the camera permission. */
  | { status: 'denied' };

/** JPEG quality of the photo sent to the API: a label stays readable and the upload stays small. */
const JPEG_QUALITY = 0.8;

/** The base64 part of a `data:` URI, for platforms that return the image that way. */
function dataUriBase64(uri: string): string | null {
  const match = /^data:[^;]+;base64,(.+)$/.exec(uri);
  return match ? (match[1] ?? null) : null;
}

/**
 * A photo of a nutrition label for the label reader (spec 006 AC14): taken with the system camera or
 * picked from the library, resized on the device to 1568 px on its longest side and encoded as JPEG.
 * The photo goes to the API and is kept nowhere on the device.
 *
 * Call it straight from a button press: a browser only opens its picker during a user gesture.
 */
export async function pickLabelPhoto(source: 'camera' | 'library'): Promise<LabelPhoto> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return { status: 'cancelled' };

  const side = LABEL_SCAN_LIMITS.imageSideMax;
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > side) {
    context.resize(asset.width >= asset.height ? { width: side } : { height: side });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_QUALITY,
    base64: true,
  });
  const data = saved.base64 ?? dataUriBase64(saved.uri);
  if (!data) throw new Error('pickLabelPhoto: the image has no data');
  return { status: 'ok', image: { mediaType: 'image/jpeg', data } };
}
