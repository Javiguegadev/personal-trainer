import { CONSENT_VERSION, type MeResponse, type ProfileInput } from '@pt/contracts';

export const meBody: MeResponse = {
  userId: '6f1c2a9e-5b7d-4c3e-9a1f-2d8b7e6c5a40',
  consent: { healthData: true, version: CONSENT_VERSION },
  onboardingCompleted: false,
  profile: null,
  dietaryPrefs: null,
  targets: null,
};

export const profileInput: ProfileInput = {
  sex: 'female',
  birthDate: '1990-05-01',
  heightCm: 165,
  weightKg: 60,
  targetWeightKg: null,
  jobActivity: 'sedentary',
  plannedActivities: [],
  goal: 'maintain',
  trainingFocus: 'general_fitness',
  injuries: null,
  healthFlags: [],
  units: 'metric',
  locale: 'es',
  dietaryPrefs: { dietType: 'omnivore', allergies: [], dislikes: [], restrictions: [] },
  today: '2026-11-11',
};
