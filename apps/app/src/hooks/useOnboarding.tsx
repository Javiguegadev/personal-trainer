import type { ChatMessage, OnboardingDraft, Units } from '@pt/contracts';
import { profileFormFromDraft, type ProfileFormValues } from '@pt/core';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useI18n } from './useI18n';

/**
 * Onboarding state shared by chat, form and summary. It lives only in memory on the device: the
 * transcript is sent with each chat turn and never stored (AC25).
 */
interface OnboardingState {
  messages: ChatMessage[];
  draft: OnboardingDraft;
  /** The AI raised the eating-disorder soft stop (AC20). */
  softStop: boolean;
  /** The editable form (manual path, summary). Built from the draft when the user leaves the chat. */
  form: ProfileFormValues;
}

interface OnboardingContextValue extends OnboardingState {
  setChat: (chat: Pick<OnboardingState, 'messages' | 'draft' | 'softStop'>) => void;
  setForm: (form: ProfileFormValues) => void;
  /** Rebuilds the form from what the chat collected (before opening the form or the summary). */
  formFromDraft: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/** Imperial by default only where the device uses US units; metric everywhere else and on web. */
export function defaultUnits(): Units {
  return getLocales()[0]?.measurementSystem === 'us' ? 'imperial' : 'metric';
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [state, setState] = useState<OnboardingState>(() => ({
    messages: [],
    draft: {},
    softStop: false,
    form: profileFormFromDraft({}, defaultUnits(), locale),
  }));

  const value: OnboardingContextValue = {
    ...state,
    setChat: (chat) => setState((s) => ({ ...s, ...chat })),
    setForm: (form) => setState((s) => ({ ...s, form })),
    formFromDraft: () =>
      setState((s) => ({ ...s, form: profileFormFromDraft(s.draft, s.form.units, locale) })),
  };
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return value;
}
