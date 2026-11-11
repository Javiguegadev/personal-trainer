/**
 * Scripted stand-in for the onboarding AI (dev and E2E only; the real one is Claude Haiku 5.5 in
 * apps/api). It extracts simple patterns from the last user message and otherwise fills the next missing
 * fields with demo values, so any conversation reaches the summary in a few turns.
 *
 * Test hooks: a message containing `#503` fails with ai_unavailable and `#429` with rate_limited.
 */
import {
  HeightCmSchema,
  WeightKgSchema,
  type Locale,
  type OnboardingChatRequest,
  type OnboardingDraft,
  type RequiredDraftField,
} from '@pt/contracts';
import { birthDateFromAge, missingDraftFields, roundTo, toCm, toKg } from '@pt/core';

export type MockChatTurn =
  | { kind: 'ok'; reply: string; draft: OnboardingDraft; softStop: boolean }
  | { kind: 'ai_unavailable' }
  | { kind: 'rate_limited' };

const GROUPS: RequiredDraftField[][] = [
  ['sex', 'birthDate'],
  ['heightCm', 'weightKg'],
  ['activityLevel'],
  ['goal'],
  ['dietType'],
];

const COPY: Record<
  Locale,
  {
    greeting: string;
    noted: string;
    demo: string;
    done: string;
    softStop: string;
    pregnancy: string;
    questions: Record<string, string>;
  }
> = {
  es: {
    greeting: '¡Hola! Soy tu asistente (modo demo). Te haré unas preguntas rápidas.',
    noted: 'Anotado.',
    demo: '(Demo) No he entendido el dato, así que uso un valor de ejemplo que podrás cambiar.',
    done: '¡Perfecto, ya lo tengo todo! Revisa el resumen y corrige lo que haga falta.',
    softStop:
      'Gracias por contármelo. Lo que describes es importante y mereces apoyo profesional. No vamos a fijar objetivos de pérdida de peso; si quieres, puedes seguir con objetivos de mantenimiento.',
    pregnancy:
      'Gracias por decírmelo. Durante el embarazo o la lactancia no calcularemos objetivos numéricos: tu matrona o tu médico son quienes mejor pueden orientarte.',
    questions: {
      'sex,birthDate': '¿Cuál es tu sexo y cuántos años tienes?',
      'heightCm,weightKg': '¿Cuánto mides y cuánto pesas?',
      activityLevel:
        '¿Cómo de activo eres en un día normal: sedentario, ligero, moderado, activo o muy activo?',
      goal: '¿Qué quieres conseguir: perder peso, mantenerte o ganar masa muscular?',
      dietType:
        '¿Sigues algún tipo de dieta (omnívora, vegetariana, vegana o pescetariana)? ¿Tienes alguna alergia?',
    },
  },
  en: {
    greeting: "Hi! I'm your assistant (demo mode). I'll ask you a few quick questions.",
    noted: 'Got it.',
    demo: "(Demo) I didn't catch that, so I'm using an example value you can change later.",
    done: "Great, I have everything! Check the summary and fix anything that's off.",
    softStop:
      "Thank you for telling me. What you describe matters and you deserve professional support. We won't set weight-loss targets; if you like, you can continue with maintenance targets.",
    pregnancy:
      "Thanks for letting me know. During pregnancy or breastfeeding we won't calculate numeric targets: your midwife or doctor can guide you best.",
    questions: {
      'sex,birthDate': "What's your sex, and how old are you?",
      'heightCm,weightKg': 'How tall are you, and how much do you weigh?',
      activityLevel:
        'How active are you on a normal day: sedentary, light, moderate, active or very active?',
      goal: 'What do you want to achieve: lose weight, maintain, or build muscle?',
      dietType: 'Do you follow a diet (omnivore, vegetarian, vegan or pescatarian)? Any allergies?',
    },
  },
};

const ED_PATTERN =
  /anorexi|bulimi|atrac[oó]n|binge|purg|vomit|v[oó]mit|laxant|starv|no como nada|self-harm|autolesi|hacerme da[ñn]o/;
const PREGNANCY_PATTERN = /embaraz|pregnan|lactan|breastfeed|amamant/;

const number = (raw: string) => Number(raw.replace(',', '.'));

/** Pulls whatever the mock understands out of one message. */
export function extractFromMessage(text: string, today: string): Partial<OnboardingDraft> {
  const t = text.toLowerCase();
  const out: Partial<OnboardingDraft> = {};

  if (/\b(mujer|female|woman|chica)\b/.test(t)) out.sex = 'female';
  else if (/\b(hombre|male|man|chico|var[oó]n)\b/.test(t)) out.sex = 'male';
  else if (/prefiero no decir|prefer not|no binari|non-binary/.test(t)) out.sex = 'other';

  const iso = /\b((?:19|20)\d{2}-\d{2}-\d{2})\b/.exec(t);
  const age = /\b(\d{1,3})\s*(?:años|anos|years?|yo)\b/.exec(t);
  if (iso?.[1]) out.birthDate = iso[1];
  else if (age?.[1] && number(age[1]) >= 10 && number(age[1]) <= 100) {
    out.birthDate = birthDateFromAge(number(age[1]), today);
  }

  const cm = /\b(\d{3})\s*cm\b/.exec(t);
  const metres = /\b([12][.,]\d{1,2})\s*(?:m|metros?)\b/.exec(t);
  const feet = /\b(\d)\s*(?:ft|feet|')\s*(\d{1,2})\s*(?:in|"|inches)?/.exec(t);
  let heightCm: number | undefined;
  if (cm?.[1]) heightCm = number(cm[1]);
  else if (metres?.[1]) heightCm = toCm({ value: number(metres[1]), unit: 'm' });
  else if (feet?.[1] && feet[2]) {
    heightCm = toCm({ unit: 'ft_in', feet: number(feet[1]), inches: number(feet[2]) });
  }
  if (heightCm !== undefined && HeightCmSchema.safeParse(roundTo(heightCm)).success) {
    out.heightCm = roundTo(heightCm);
  }

  const kg = /\b(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?)\b/.exec(t);
  const lb = /\b(\d{2,3}(?:[.,]\d)?)\s*(?:lb|lbs|libras?|pounds?)\b/.exec(t);
  let weightKg: number | undefined;
  if (kg?.[1]) weightKg = number(kg[1]);
  else if (lb?.[1]) weightKg = toKg({ value: number(lb[1]), unit: 'lb' });
  if (weightKg !== undefined && WeightKgSchema.safeParse(roundTo(weightKg)).success) {
    out.weightKg = roundTo(weightKg);
  }

  if (/muy activ|very active/.test(t)) out.activityLevel = 'very_active';
  else if (/sedentari|sedentary/.test(t)) out.activityLevel = 'sedentary';
  else if (/\bliger[oa]\b|\blight\b/.test(t)) out.activityLevel = 'light';
  else if (/moderad|moderate/.test(t)) out.activityLevel = 'moderate';
  else if (/\bactiv[oa]\b|\bactive\b/.test(t)) out.activityLevel = 'active';

  if (/perder|adelgaz|\blose\b/.test(t)) out.goal = 'lose';
  else if (/ganar|\bgain\b|m[uú]sculo|muscle/.test(t)) out.goal = 'gain';
  else if (/mantener|mantenerme|maintain/.test(t)) out.goal = 'maintain';

  if (/vegetarian/.test(t)) out.dietType = 'vegetarian';
  else if (/vegan/.test(t)) out.dietType = 'vegan';
  else if (/pescetarian|pescatarian/.test(t)) out.dietType = 'pescatarian';
  else if (/omn[ií]vor|como de todo|eat everything|anything/.test(t)) out.dietType = 'omnivore';

  const allergy =
    /(?:al[ée]rgic[oa]s?|alergia)\s+(?:a los|a las|a la|al|a)\s+([^.;]+)|allergic to\s+([^.;]+)/.exec(
      t,
    );
  const allergyList = allergy?.[1] ?? allergy?.[2];
  if (allergyList) {
    out.allergies = allergyList
      .split(/,|\by\b|\band\b/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (/lesi[oó]n|injur|me duele|dolor|\bpain\b/.test(t)) out.injuries = text.trim().slice(0, 500);
  return out;
}

const DEMO_VALUES = (today: string): Partial<Record<RequiredDraftField, unknown>> => ({
  sex: 'female',
  birthDate: birthDateFromAge(34, today),
  heightCm: 165,
  weightKg: 62,
  activityLevel: 'moderate',
  goal: 'maintain',
  dietType: 'omnivore',
});

function union(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  const seen = new Map<string, string>();
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    const key = item.toLowerCase();
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function nextQuestion(draft: OnboardingDraft, locale: Locale): string | null {
  const missing = new Set(missingDraftFields(draft));
  const group = GROUPS.find((fields) => fields.some((field) => missing.has(field)));
  return group ? (COPY[locale].questions[group.join(',')] ?? null) : null;
}

export function mockOnboardingTurn(request: OnboardingChatRequest): MockChatTurn {
  const copy = COPY[request.locale];
  const userMessages = request.messages.filter((m) => m.role === 'user');
  const last = userMessages.at(-1)?.content ?? '';
  const lower = last.toLowerCase();

  if (lower.includes('#503')) return { kind: 'ai_unavailable' };
  if (lower.includes('#429')) return { kind: 'rate_limited' };

  const draft: OnboardingDraft = { ...request.draft };
  const flags = new Set(draft.healthFlags ?? []);

  if (ED_PATTERN.test(lower)) {
    flags.add('ed_soft_stop');
    return {
      kind: 'ok',
      reply: copy.softStop,
      draft: { ...draft, healthFlags: [...flags] },
      softStop: true,
    };
  }

  const parts: string[] = [];
  if (PREGNANCY_PATTERN.test(lower)) {
    flags.add('pregnancy');
    parts.push(copy.pregnancy);
  }

  const extracted = extractFromMessage(last, request.today);
  const { allergies, ...rest } = extracted;
  Object.assign(draft, rest);
  if (allergies) draft.allergies = union(draft.allergies, allergies);
  if (extracted.injuries) flags.add('medical_condition');
  if (flags.size > 0) draft.healthFlags = [...flags];

  const understood = Object.keys(extracted).length > 0 || parts.length > 0;
  if (understood) {
    parts.unshift(copy.noted);
  } else if (userMessages.length <= 1) {
    parts.push(copy.greeting);
  } else {
    // Nothing understood: fill the next missing group with demo values so the flow keeps moving.
    const missing = new Set(missingDraftFields(draft));
    const group = GROUPS.find((fields) => fields.some((field) => missing.has(field))) ?? [];
    const demo = DEMO_VALUES(request.today);
    for (const field of group) {
      if (missing.has(field)) Object.assign(draft, { [field]: demo[field] });
    }
    parts.push(copy.demo);
  }

  parts.push(nextQuestion(draft, request.locale) ?? copy.done);
  return { kind: 'ok', reply: parts.join(' '), draft, softStop: false };
}
