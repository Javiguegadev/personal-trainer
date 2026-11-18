import type { SafetyFlag } from '@pt/contracts';
import { useI18n } from '@/hooks/useI18n';
import { AppText } from './AppText';

/**
 * Quiet safety lines of the Training tab (spec 009 Safety): an injury in the profile, and pregnancy.
 * The app does not filter exercises (structured injuries come with programs in E7).
 */
export function TrainingNotes({ flags }: { flags: readonly SafetyFlag[] }) {
  const { t } = useI18n();
  return (
    <>
      {flags.includes('injury') ? (
        <AppText variant="caption" tone="muted" testID="training-injury-note">
          {t.training.injuryNote}
        </AppText>
      ) : null}
      {flags.includes('pregnancy') ? (
        <AppText variant="caption" tone="muted" testID="training-pregnancy-note">
          {t.training.pregnancyNote}
        </AppText>
      ) : null}
    </>
  );
}
