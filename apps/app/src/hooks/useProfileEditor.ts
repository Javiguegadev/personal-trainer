import { isApiError } from '@pt/api-client';
import type { ProfileInput } from '@pt/contracts';
import {
  formErrorFromApi,
  parseProfileForm,
  profileNotices,
  type ProfileFormErrors,
  type ProfileFormValues,
  type ProfileNotice,
} from '@pt/core';
import { useMemo, useState } from 'react';
import type { TargetsCardProps } from '@/components/TargetsCard';
import { useTargetsPreview, useUpdateProfile } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useDebouncedValue } from './useDebouncedValue';
import { useI18n } from './useI18n';
import { useToday } from './useToday';

const PREVIEW_DEBOUNCE_MS = 400;

function apiFieldErrors(error: unknown): ProfileFormErrors {
  if (!isApiError(error, 'validation_error')) return {};
  const errors: ProfileFormErrors = {};
  for (const [path, code] of Object.entries(error.fields)) {
    const mapped = formErrorFromApi(path, code);
    if (mapped) errors[mapped.field] ??= mapped.code;
  }
  return errors;
}

/**
 * Live targets preview + save for an editable profile (onboarding summary AC10, Settings AC16). The
 * preview runs the same @pt/core rules as the save, so what the user sees is what gets stored.
 */
export function useProfileEditor(values: ProfileFormValues) {
  const { t, locale } = useI18n();
  const today = useToday();
  const [showErrors, setShowErrors] = useState(false);

  const parsed = parseProfileForm(values, today, locale);
  // Debounce a string: a new input object on every render would never settle.
  const inputKey = parsed.ok ? JSON.stringify(parsed.input) : null;
  const debouncedKey = useDebouncedValue(inputKey, PREVIEW_DEBOUNCE_MS);
  const previewInput = useMemo(
    () => (debouncedKey ? (JSON.parse(debouncedKey) as ProfileInput) : null),
    [debouncedKey],
  );
  const preview = useTargetsPreview(previewInput);
  const update = useUpdateProfile();

  const ageBlocked =
    isApiError(preview.error, 'age_blocked') || isApiError(update.error, 'age_blocked');
  const errors: ProfileFormErrors = {
    ...(showErrors && !parsed.ok ? parsed.errors : {}),
    ...apiFieldErrors(preview.error),
    ...apiFieldErrors(update.error),
  };

  let targets: TargetsCardProps;
  if (!parsed.ok) targets = { status: 'incomplete' };
  else if (preview.data) {
    targets = {
      status: 'ready',
      targets: preview.data.targets,
      breakdown: preview.data.breakdown,
      refreshing: preview.isPlaceholderData || inputKey !== debouncedKey || preview.isFetching,
    };
  } else if (preview.isError && !ageBlocked) {
    targets = {
      status: 'error',
      message: errorMessage(preview.error, t),
      onRetry: () => void preview.refetch(),
    };
  } else targets = { status: 'loading' };

  const notices: ProfileNotice[] = preview.data
    ? profileNotices(preview.data.safety, preview.data.targets)
    : [];

  return {
    errors,
    targets,
    notices,
    floorKcal: preview.data?.breakdown?.floorKcal,
    ageBlocked,
    saving: update.isPending,
    saved: update.isSuccess,
    saveError:
      update.isError && !ageBlocked && !isApiError(update.error, 'validation_error')
        ? errorMessage(update.error, t)
        : null,
    /** Shows field errors; saves only when the form is valid. */
    save: (options?: { onSuccess?: () => void }) => {
      setShowErrors(true);
      if (parsed.ok) update.mutate(parsed.input, { onSuccess: options?.onSuccess });
    },
    hasErrors: Object.keys(errors).length > 0,
  };
}
