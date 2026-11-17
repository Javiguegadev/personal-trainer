import { useI18n } from '@/hooks/useI18n';
import { useOnline } from '@/hooks/useOnline';
import { Notice } from './Notice';

/** Without a connection the screen shows the last data received, not an error (spec 003 AC5). */
export function OfflineBanner() {
  const { t } = useI18n();
  const online = useOnline();
  if (online) return null;
  return <Notice tone="info" message={`⚠ ${t.offline.banner}`} testID="offline-banner" />;
}
