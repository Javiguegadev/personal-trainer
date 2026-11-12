/**
 * The manual profile form (spec 001 AC10, AC11, AC16, AC22): values as typed, unit switching and
 * validation into a metric `ProfileInput`. Shared by onboarding (form + summary) and Settings.
 */
import {
  PROFILE_LIMITS,
  type ActivityLevel,
  type DietaryPrefs,
  type DietType,
  type Goal,
  type Locale,
  type Profile,
  type ProfileInput,
  type ReportedHealthFlag,
  type Sex,
  type Units,
} from '@pt/contracts';
import { formatDecimal, parseDecimal } from '../format';
import { cmToFeetInches, kgToLb, lbToKg, roundTo, toCm } from '../units';

export interface ProfileFormValues {
  units: Units;
  sex: Sex | null;
  birthDay: string;
  birthMonth: string;
  birthYear: string;
  /** Metric height, in centimetres. */
  heightCm: string;
  /** Imperial height, in feet and inches. */
  heightFt: string;
  heightIn: string;
  /** Kilograms (metric) or pounds (imperial). */
  weight: string;
  /** Optional, same unit as `weight`. */
  targetWeight: string;
  activityLevel: ActivityLevel | null;
  goal: Goal | null;
  dietType: DietType | null;
  /** Comma-separated lists. */
  allergies: string;
  dislikes: string;
  restrictions: string;
  injuries: string;
  pregnancy: boolean;
  /** Reported flags without a form control (e.g. a stored `ed_soft_stop`). Never dropped. */
  otherHealthFlags: ReportedHealthFlag[];
}

export type ProfileFormField =
  | 'sex'
  | 'birthDate'
  | 'height'
  | 'weight'
  | 'targetWeight'
  | 'activityLevel'
  | 'goal'
  | 'dietType'
  | 'allergies'
  | 'dislikes'
  | 'restrictions'
  | 'injuries';

/** Each code maps to the i18n key `onboarding.form.errors.<code>`. */
export type FormErrorCode =
  | 'required'
  | 'invalid_number'
  | 'too_small'
  | 'too_big'
  | 'invalid_date'
  | 'in_future'
  | 'too_long'
  | 'invalid';

export type ProfileFormErrors = Partial<Record<ProfileFormField, FormErrorCode>>;

export type ParsedProfileForm =
  { ok: true; input: ProfileInput } | { ok: false; errors: ProfileFormErrors };

export function emptyProfileForm(units: Units): ProfileFormValues {
  return {
    units,
    sex: null,
    birthDay: '',
    birthMonth: '',
    birthYear: '',
    heightCm: '',
    heightFt: '',
    heightIn: '',
    weight: '',
    targetWeight: '',
    activityLevel: null,
    goal: null,
    dietType: null,
    allergies: '',
    dislikes: '',
    restrictions: '',
    injuries: '',
    pregnancy: false,
    otherHealthFlags: [],
  };
}

function heightFields(cm: number | undefined, units: Units, locale: Locale) {
  if (cm === undefined) return { heightCm: '', heightFt: '', heightIn: '' };
  if (units === 'metric')
    return { heightCm: formatDecimal(cm, locale), heightFt: '', heightIn: '' };
  const { feet, inches } = cmToFeetInches(cm);
  return { heightCm: '', heightFt: String(feet), heightIn: String(inches) };
}

function weightField(kg: number | null | undefined, units: Units, locale: Locale): string {
  if (kg === undefined || kg === null) return '';
  return units === 'metric' ? formatDecimal(kg, locale) : formatDecimal(kgToLb(kg), locale, 0);
}

function birthFields(isoDate: string | undefined) {
  if (!isoDate) return { birthDay: '', birthMonth: '', birthYear: '' };
  const [year = '', month = '', day = ''] = isoDate.split('-');
  return { birthDay: String(Number(day)), birthMonth: String(Number(month)), birthYear: year };
}

function healthFields(flags: readonly ReportedHealthFlag[] | undefined) {
  const all = flags ?? [];
  return {
    pregnancy: all.includes('pregnancy'),
    otherHealthFlags: all.filter((flag) => flag !== 'pregnancy'),
  };
}

const joinList = (items: readonly string[] | undefined) => (items ?? []).join(', ');

/** Prefills the form with a stored profile (Settings, AC16). */
export function profileFormFromProfile(
  profile: Profile,
  prefs: DietaryPrefs | null,
  locale: Locale,
): ProfileFormValues {
  const reported = profile.safetyFlags.filter(
    (flag): flag is ReportedHealthFlag =>
      flag === 'pregnancy' || flag === 'ed_soft_stop' || flag === 'medical_condition',
  );
  return {
    ...emptyProfileForm(profile.units),
    sex: profile.sex,
    ...birthFields(profile.birthDate),
    ...heightFields(profile.heightCm, profile.units, locale),
    weight: weightField(profile.weightKg, profile.units, locale),
    targetWeight: weightField(profile.targetWeightKg, profile.units, locale),
    activityLevel: profile.activityLevel,
    // The goal the user asked for: safety rules re-apply on every save.
    goal: profile.requestedGoal,
    dietType: prefs?.dietType ?? null,
    allergies: joinList(prefs?.allergies),
    dislikes: joinList(prefs?.dislikes),
    restrictions: joinList(prefs?.restrictions),
    injuries: profile.injuries ?? '',
    ...healthFields(reported),
  };
}

type Parsed<T> = { value: T } | { error: FormErrorCode };

function parseRange(
  text: string,
  min: number,
  max: number,
  decimals: number,
): Parsed<number> | null {
  if (text.trim() === '') return null;
  const parsed = parseDecimal(text);
  if (parsed === null) return { error: 'invalid_number' };
  const value = roundTo(parsed, decimals);
  if (value < min) return { error: 'too_small' };
  if (value > max) return { error: 'too_big' };
  return { value };
}

function parseHeightCm(values: ProfileFormValues): Parsed<number> | null {
  const { min, max } = PROFILE_LIMITS.heightCm;
  if (values.units === 'metric') return parseRange(values.heightCm, min, max, 1);
  if (values.heightFt.trim() === '' && values.heightIn.trim() === '') return null;
  const feet = parseDecimal(values.heightFt.trim() === '' ? '0' : values.heightFt);
  const inches = parseDecimal(values.heightIn.trim() === '' ? '0' : values.heightIn);
  if (feet === null || inches === null || !Number.isInteger(feet) || inches >= 12) {
    return { error: 'invalid_number' };
  }
  const cm = roundTo(toCm({ unit: 'ft_in', feet, inches }), 1);
  if (cm < min) return { error: 'too_small' };
  if (cm > max) return { error: 'too_big' };
  return { value: cm };
}

function parseWeightKg(text: string, units: Units): Parsed<number> | null {
  if (text.trim() === '') return null;
  const parsed = parseDecimal(text);
  if (parsed === null) return { error: 'invalid_number' };
  const kg = roundTo(units === 'metric' ? parsed : lbToKg(parsed), 1);
  if (kg < PROFILE_LIMITS.weightKg.min) return { error: 'too_small' };
  if (kg > PROFILE_LIMITS.weightKg.max) return { error: 'too_big' };
  return { value: kg };
}

function parseBirthDate(values: ProfileFormValues, today: string): Parsed<string> | null {
  const parts = [values.birthDay, values.birthMonth, values.birthYear].map((p) => p.trim());
  if (parts.every((p) => p === '')) return null;
  const [day, month, year] = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN)) as [
    number,
    number,
    number,
  ];
  if (!Number.isInteger(day) || !Number.isInteger(month) || !/^\d{4}$/.test(parts[2] ?? '')) {
    return { error: 'invalid_date' };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < 1900
  ) {
    return { error: 'invalid_date' };
  }
  const iso = date.toISOString().slice(0, 10);
  if (iso > today) return { error: 'in_future' };
  return { value: iso };
}

/** Splits a typed list on commas, semicolons or new lines. */
export function splitList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseList(text: string): Parsed<string[]> {
  const items = splitList(text);
  if (
    items.length > PROFILE_LIMITS.listMax ||
    items.some((item) => item.length > PROFILE_LIMITS.listItemMax)
  ) {
    return { error: 'too_long' };
  }
  return { value: items };
}

/**
 * Validates the form and builds the metric `ProfileInput` sent to the API (which runs the same checks
 * again, plus the safety rules). `today` is the user's local date.
 */
export function parseProfileForm(
  values: ProfileFormValues,
  today: string,
  locale: Locale,
): ParsedProfileForm {
  const errors: ProfileFormErrors = {};
  const required = <T>(field: ProfileFormField, parsed: Parsed<T> | null): T | undefined => {
    if (parsed === null) {
      errors[field] = 'required';
      return undefined;
    }
    if ('error' in parsed) {
      errors[field] = parsed.error;
      return undefined;
    }
    return parsed.value;
  };
  const optional = <T>(field: ProfileFormField, parsed: Parsed<T> | null): T | null => {
    if (parsed === null) return null;
    if ('error' in parsed) {
      errors[field] = parsed.error;
      return null;
    }
    return parsed.value;
  };
  const choice = <T>(field: ProfileFormField, value: T | null): T | undefined => {
    if (value === null) errors[field] = 'required';
    return value ?? undefined;
  };

  const sex = choice('sex', values.sex);
  const birthDate = required('birthDate', parseBirthDate(values, today));
  const heightCm = required('height', parseHeightCm(values));
  const weightKg = required('weight', parseWeightKg(values.weight, values.units));
  const targetWeightKg = optional('targetWeight', parseWeightKg(values.targetWeight, values.units));
  const activityLevel = choice('activityLevel', values.activityLevel);
  const goal = choice('goal', values.goal);
  const dietType = choice('dietType', values.dietType);
  const allergies = optional('allergies', parseList(values.allergies)) ?? [];
  const dislikes = optional('dislikes', parseList(values.dislikes)) ?? [];
  const restrictions = optional('restrictions', parseList(values.restrictions)) ?? [];
  const injuriesText = values.injuries.trim();
  if (injuriesText.length > PROFILE_LIMITS.textMax) errors.injuries = 'too_long';

  if (
    Object.keys(errors).length > 0 ||
    sex === undefined ||
    birthDate === undefined ||
    heightCm === undefined ||
    weightKg === undefined ||
    activityLevel === undefined ||
    goal === undefined ||
    dietType === undefined
  ) {
    return { ok: false, errors };
  }

  const healthFlags = [
    ...new Set<ReportedHealthFlag>([
      ...(values.pregnancy ? (['pregnancy'] as const) : []),
      ...values.otherHealthFlags.filter((flag) => flag !== 'pregnancy'),
    ]),
  ];

  return {
    ok: true,
    input: {
      sex,
      birthDate,
      heightCm,
      weightKg,
      targetWeightKg,
      activityLevel,
      goal,
      injuries: injuriesText === '' ? null : injuriesText,
      healthFlags,
      units: values.units,
      locale,
      dietaryPrefs: { dietType, allergies, dislikes, restrictions },
      today,
    },
  };
}

/** Switches metric ↔ imperial, converting the height and weights already typed (AC9, AC11). */
export function convertFormUnits(
  values: ProfileFormValues,
  to: Units,
  locale: Locale,
): ProfileFormValues {
  if (values.units === to) return values;
  const height = parseHeightCm(values);
  const weight = parseWeightKg(values.weight, values.units);
  const target = parseWeightKg(values.targetWeight, values.units);
  const valueOf = (parsed: Parsed<number> | null) =>
    parsed && 'value' in parsed ? parsed.value : undefined;
  return {
    ...values,
    units: to,
    ...heightFields(valueOf(height), to, locale),
    weight: weightField(valueOf(weight), to, locale),
    targetWeight: weightField(valueOf(target), to, locale),
  };
}

/**
 * Maps an API field path (e.g. `heightCm`, `dietaryPrefs.allergies.0`) and Zod/API error code to the
 * form field and error code shown under it (AC22).
 */
export function formErrorFromApi(
  path: string,
  code: string,
): { field: ProfileFormField; code: FormErrorCode } | null {
  const [first = '', second = ''] = path.split('.');
  const field = API_FIELDS[first === 'dietaryPrefs' ? `${first}.${second}` : first];
  if (!field) return null;
  return { field, code: PASSTHROUGH_CODES.has(code) ? (code as FormErrorCode) : 'invalid' };
}

const API_FIELDS: Partial<Record<string, ProfileFormField>> = {
  sex: 'sex',
  birthDate: 'birthDate',
  heightCm: 'height',
  weightKg: 'weight',
  targetWeightKg: 'targetWeight',
  activityLevel: 'activityLevel',
  goal: 'goal',
  injuries: 'injuries',
  'dietaryPrefs.dietType': 'dietType',
  'dietaryPrefs.allergies': 'allergies',
  'dietaryPrefs.dislikes': 'dislikes',
  'dietaryPrefs.restrictions': 'restrictions',
};

const PASSTHROUGH_CODES: ReadonlySet<string> = new Set<FormErrorCode>([
  'too_small',
  'too_big',
  'in_future',
]);
