import type { Units } from '@pt/contracts';
import { emptyProfileForm, type ProfileFormValues } from '@pt/core';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useState, type ReactNode } from 'react';

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
  const [form, setForm] = useState<ProfileFormValues>(() => emptyProfileForm(defaultUnits()));
  return (
    <OnboardingContext.Provider value={{ form, setForm }}>{children}</OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return value;
}
