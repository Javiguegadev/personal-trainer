import type { Units } from '@pt/contracts';
import { emptyProfileForm, profileFormFromProfile, type ProfileFormValues } from '@pt/core';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useMe } from '@/lib/api';
import { useI18n } from './useI18n';

/**
 * The onboarding form, shared by the form and the summary. It lives only in memory on the device until
 * the user confirms the summary.
 */
interface OnboardingContextValue {
  form: ProfileFormValues;
  setForm: (form: ProfileFormValues) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/** Imperial by default only where the device uses US units; metric everywhere else and on web. */
export function defaultUnits(): Units {
  return getLocales()[0]?.measurementSystem === 'us' ? 'imperial' : 'metric';
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const me = useMe();
  const profile = me.data?.profile ?? null;
  const prefs = me.data?.dietaryPrefs ?? null;
  // An account that must fill in the form again (spec 002 AC17) starts from its stored values.
  const initial = useMemo(
    () =>
      profile ? profileFormFromProfile(profile, prefs, locale) : emptyProfileForm(defaultUnits()),
    [profile, prefs, locale],
  );
  const [edited, setEdited] = useState<ProfileFormValues | null>(null);
  return (
    <OnboardingContext.Provider value={{ form: edited ?? initial, setForm: setEdited }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return value;
}
