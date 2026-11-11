import type { DeepStringRecord } from '../types';
import type { es } from './es';

export const en: DeepStringRecord<typeof es> = {
  app: {
    name: 'Personal Trainer',
    tagline: 'AI-powered nutrition and training',
  },
  nav: {
    dashboard: 'Dashboard',
    nutrition: 'Nutrition',
    training: 'Training',
    ranking: 'Ranking',
  },
  common: {
    continue: 'Continue',
    back: 'Back',
    retry: 'Try again',
    loading: 'Loading…',
    signOut: 'Sign out',
    notMedicalAdvice: 'This app does not replace advice from a healthcare professional.',
    demoMode: 'Demo mode: simulated data, stored only on this device.',
  },
  auth: {
    signIn: {
      title: 'Sign in or create your account',
      subtitle: "We'll email you a 6-digit code. No passwords.",
      emailLabel: 'Email',
      emailPlaceholder: 'you@email.com',
      sendCode: 'Send code',
      or: 'or',
      google: 'Continue with Google',
    },
    verify: {
      title: 'Enter the code',
      subtitle: 'We sent it to {email}. It expires in 10 minutes.',
      codeLabel: '6-digit code',
      submit: 'Verify',
      resend: 'Resend code',
      resendIn: 'You can request another code in {seconds} s',
      resent: 'We sent you a new code.',
      changeEmail: 'Use a different email',
      demoHint: 'Demo mode: the code is 123456 (000000 simulates an expired code).',
    },
    errors: {
      invalid_email: "That email doesn't look right. Please check it.",
      invalid_code: "That code isn't right. Check it or request a new one.",
      expired_code: 'The code has expired. Request a new one.',
      rate_limited: 'Too many attempts. Wait a minute and try again.',
      network: 'No connection. Check your network and try again.',
      cancelled: 'You cancelled signing in with Google.',
      not_configured:
        'Real sign-in is not connected yet. To try the app, start it in demo mode: pnpm --filter @pt/app web:mock',
      unknown: 'Something went wrong. Please try again.',
    },
  },
  consent: {
    title: 'Your health data',
    intro:
      'To calculate your targets we need some health data. Before you continue, this is what we do with it:',
    points: {
      what: 'We store your sex, date of birth, height, weight, activity level, goal, diet, allergies and injuries.',
      where: 'It is stored on servers in the European Union and only you can see it.',
      ai: 'If you use the chat, your messages are processed by an AI provider (Anthropic, in the EU or the US) under a data processing agreement. We do not store the conversations.',
      control: 'You can download or delete all your data at any time in Settings → Privacy.',
      advice: 'Recommendations are for guidance only and do not replace a healthcare professional.',
    },
    checkbox: 'I give my explicit consent to the processing of my health data for this purpose.',
    privacyPending: 'The full privacy policy will be available before launch.',
    accept: 'Accept and continue',
  },
  onboarding: {
    placeholder: 'The welcome chat comes in the next step.',
  },
  home: {
    title: 'Today',
    welcome: 'Your targets are ready. Soon you will be able to log meals and workouts.',
  },
  errors: {
    unauthorized: 'Your session has expired. Please sign in again.',
    consent_required: 'We need your consent to continue.',
    validation_error: 'Please check the highlighted fields.',
    age_blocked: 'This app is not available under 16.',
    rate_limited: "You've reached today's message limit.",
    ai_unavailable: 'The assistant is not available right now.',
    not_found: "We couldn't find what you were looking for.",
    internal_error: 'Something went wrong on the server. Please try again.',
    network: 'No connection to the server. Check your network.',
    unknown: 'Something went wrong. Please try again.',
    loadAccount: "We couldn't load your account.",
  },
};
