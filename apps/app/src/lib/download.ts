/**
 * Saves a JSON file and lets the user keep it (AC23). Native (iOS/Android): a file in the cache
 * directory opened in the system share sheet. Web: see download.web.ts.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function saveJsonFile(
  fileName: string,
  data: unknown,
  dialogTitle: string,
): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(JSON.stringify(data, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle,
  });
}
