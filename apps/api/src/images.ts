import { LABEL_SCAN_LIMITS, type ImageUpload } from '@pt/contracts';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a base64 string decodes to. */
function decodedBytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * The whole JSON body of a photo for the AI (label, plate): the image in base64 (4/3 of its bytes)
 * plus the rest of the request.
 */
export const IMAGE_BODY_MAX = Math.ceil((LABEL_SCAN_LIMITS.imageBytesMax * 4) / 3) + 16 * 1024;

/** Why an uploaded photo cannot go to the model, or null when it can (spec 006 AC14, spec 007 AC3). */
export function checkImage(image: ImageUpload): 'invalid' | 'too_large' | null {
  if (!BASE64.test(image.data)) return 'invalid';
  if (decodedBytes(image.data) > LABEL_SCAN_LIMITS.imageBytesMax) return 'too_large';
  return null;
}

/** Start of the current UTC day: the AI caps count calls from here (spec 006 AC18, spec 007 AC12). */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
