/**
 * Scripted stand-in for the onboarding AI (dev and E2E only; the real one is Claude Haiku 5.5 in
 * apps/api). It extracts simple patterns from the last user message and reads an answer without a unit
 * in the context of the question it just asked ("30" after asking the age). It never invents a value:
 * when it understands nothing, it asks again with an example.
 *
 * Test hooks: a message containing `#503` fails with ai_unavailable, `#429` fails with rate_limited, and
 * `#demo` fills every missing field with example values.
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

interface Copy {
  greeting: string;
  noted: string;
  retry: string;
  demo: string;
  done: string;
  softStop: string;
  pregnancy: string;
  /** Keyed by the fields still missing in a group: `sex,birthDate`, or `birthDate` alone. */
  questions: Record<string, string>;
  /** Keyed by the whole group. */
  examples: Record<string, string>;
}

const COPY: Record<Locale, Copy> = {
  es: {
    greeting: '¡Hola! Soy tu asistente (modo demo). Te haré unas preguntas rápidas.',
    noted: 'Anotado.',
    retry: 'No lo he entendido.',
    demo: '(Demo) He rellenado lo que faltaba con valores de ejemplo que podrás cambiar.',
    done: '¡Perfecto, ya lo tengo todo! Revisa el resumen y corrige lo que haga falta.',
    softStop:
      'Gracias por contármelo. Lo que describes es importante y mereces apoyo profesional. No vamos a fijar objetivos de pérdida de peso; si quieres, puedes seguir con objetivos de mantenimiento.',
    pregnancy:
      'Gracias por decírmelo. Durante el embarazo o la lactancia no calcularemos objetivos numéricos: tu matrona o tu médico son quienes mejor pueden orientarte.',
    questions: {
      'sex,birthDate': '¿Cuál es tu sexo y cuántos años tienes?',
      sex: '¿Cuál es tu sexo: mujer, hombre u otro?',
      birthDate: '¿Cuántos años tienes?',
      'heightCm,weightKg': '¿Cuánto mides y cuánto pesas?',
      heightCm: '¿Cuánto mides?',
      weightKg: '¿Cuánto pesas?',
      activityLevel:
        '¿Cómo de activo eres en un día normal: sedentario, ligero, moderado, activo o muy activo?',
      goal: '¿Qué quieres conseguir: perder peso, mantenerte o ganar masa muscular?',
      dietType:
        '¿Sigues algún tipo de dieta (omnívora, vegetariana, vegana o pescetariana)? ¿Tienes alguna alergia?',
    },
    examples: {
      'sex,birthDate': 'Por ejemplo: «hombre, 30 años».',
      'heightCm,weightKg': 'Por ejemplo: «1,75 y 80 kilos».',
      activityLevel: 'Por ejemplo: «sedentario» o «entreno 3 días a la semana».',
      goal: 'Por ejemplo: «perder peso».',
      dietType: 'Por ejemplo: «como de todo» o «vegetariana, alérgica a los frutos secos».',
    },
  },
  en: {
    greeting: "Hi! I'm your assistant (demo mode). I'll ask you a few quick questions.",
    noted: 'Got it.',
    retry: "I didn't catch that.",
    demo: '(Demo) I filled in what was missing with example values you can change later.',
    done: "Great, I have everything! Check the summary and fix anything that's off.",
    softStop:
      "Thank you for telling me. What you describe matters and you deserve professional support. We won't set weight-loss targets; if you like, you can continue with maintenance targets.",
    pregnancy:
      "Thanks for letting me know. During pregnancy or breastfeeding we won't calculate numeric targets: your midwife or doctor can guide you best.",
    questions: {
      'sex,birthDate': "What's your sex, and how old are you?",
      sex: "What's your sex: female, male or other?",
      birthDate: 'How old are you?',
      'heightCm,weightKg': 'How tall are you, and how much do you weigh?',
      heightCm: 'How tall are you?',
      weightKg: 'How much do you weigh?',
      activityLevel:
        'How active are you on a normal day: sedentary, light, moderate, active or very active?',
      goal: 'What do you want to achieve: lose weight, maintain, or build muscle?',
      dietType: 'Do you follow a diet (omnivore, vegetarian, vegan or pescatarian)? Any allergies?',
    },
    examples: {
      'sex,birthDate': 'For example: "male, 30 years old".',
      'heightCm,weightKg': 'For example: "5 ft 10 and 180 lb".',
      activityLevel: 'For example: "sedentary" or "I train 3 days a week".',
      goal: 'For example: "lose weight".',
      dietType: 'For example: "I eat everything" or "vegetarian, allergic to nuts".',
    },
  },
};

const ED_PATTERN =
  /anorexi|bulimi|atrac[oó]n|binge|purg|vomit|v[oó]mit|laxant|starv|no como nada(?! de)|self-harm|autolesi|hacerme da[ñn]o/;
const PREGNANCY_PATTERN = /embaraz|pregnan|lactan|breastfeed|amamant/;
const INJURY_PATTERN = /lesi[oó]n|injur|me duele|dolor|\bpain\b/;
// "no estoy embarazada", "no tengo ninguna lesión": removed before looking for the affirmative patterns.
const DENIED_PREGNANCY =
  /\b(?:no|ni|not)\s+(?:\w+\s+){0,2}?(?:embaraz|pregnan|lactan|breastfeed|amamant)|n't\s+(?:\w+\s+)?(?:pregnan|breastfeed)/g;
const DENIED_INJURY =
  /\b(?:no|sin|ni|ning[uú]n[ao]?s?|not|without|any)\s+(?:\w+\s+){0,2}?(?:lesi[oó]n|injur|dolor|pain|duele)/g;

const number = (raw: string) => Number(raw.replace(',', '.'));

/** Numbers written without a unit, in order: "1,75 y 80" → [1.75, 80]. */
function bareNumbers(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? [])
    .filter((token) => /^\d{1,3}(?:[.,]\d{1,2})?$/.test(token))
    .map(number);
}

/**
 * Pulls whatever the mock understands out of one message. `asked` lists the fields of the question the
 * user is answering: only those may be read from a number without a unit or from a bare "no".
 */
export function extractFromMessage(
  text: string,
  today: string,
  asked: readonly RequiredDraftField[] = [],
): Partial<OnboardingDraft> {
  const t = text.toLowerCase();
  const out: Partial<OnboardingDraft> = {};
  // What is left of the message once the values that carry a unit are taken out.
  let rest = t;
  const take = (pattern: RegExp) => {
    const match = pattern.exec(rest);
    if (match) rest = rest.replace(match[0], ' ');
    return match;
  };
  const wants = (field: RequiredDraftField) => asked.includes(field) && out[field] === undefined;

  if (/\b(mujer|femenin[oa]|female|woman|chica)\b/.test(t)) out.sex = 'female';
  else if (/\b(hombre|masculin[oa]|male|man|chico|var[oó]n)\b/.test(t)) out.sex = 'male';
  else if (/prefiero no decir|prefer not|no binari|non-binary/.test(t)) out.sex = 'other';

  const iso = take(/\b((?:19|20)\d{2}-\d{2}-\d{2})\b/);
  const age = take(/\b(\d{1,3})\s*(?:años|anos|years?|yo)\b/);
  if (iso?.[1]) out.birthDate = iso[1];
  else if (age?.[1] && number(age[1]) >= 10 && number(age[1]) <= 100) {
    out.birthDate = birthDateFromAge(number(age[1]), today);
  }

  const cm = take(/\b(\d{3})\s*cm\b/);
  const metres = take(/\b([12][.,]\d{1,2})\s*(?:m|metros?)\b/);
  const feet = take(/\b(\d)\s*(?:ft|feet|')\s*(\d{1,2})\s*(?:in|"|inches)?/);
  let heightCm: number | undefined;
  if (cm?.[1]) heightCm = number(cm[1]);
  else if (metres?.[1]) heightCm = toCm({ value: number(metres[1]), unit: 'm' });
  else if (feet?.[1] && feet[2]) {
    heightCm = toCm({ unit: 'ft_in', feet: number(feet[1]), inches: number(feet[2]) });
  }
  if (heightCm !== undefined && HeightCmSchema.safeParse(roundTo(heightCm)).success) {
    out.heightCm = roundTo(heightCm);
  }

  const kg = take(/\b(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?)\b/);
  const lb = take(/\b(\d{2,3}(?:[.,]\d)?)\s*(?:lb|lbs|libras?|pounds?)\b/);
  let weightKg: number | undefined;
  if (kg?.[1]) weightKg = number(kg[1]);
  else if (lb?.[1]) weightKg = toKg({ value: number(lb[1]), unit: 'lb' });
  if (weightKg !== undefined && WeightKgSchema.safeParse(roundTo(weightKg)).success) {
    out.weightKg = roundTo(weightKg);
  }

  // Answers without a unit ("30", "1,75 y 80"), read only for the fields that were asked.
  const bare = bareNumbers(rest);
  const pick = (matches: (n: number) => boolean): number | undefined => {
    const index = bare.findIndex(matches);
    return index < 0 ? undefined : bare.splice(index, 1)[0];
  };
  if (wants('birthDate')) {
    const years = pick((n) => Number.isInteger(n) && n >= 10 && n <= 100);
    if (years !== undefined) out.birthDate = birthDateFromAge(years, today);
  }
  const onlyWeight = /\bpes[oa]\b|weigh/.test(t) && !/\bmid[oe]\b|altura|tall|height/.test(t);
  if (wants('heightCm') && !onlyWeight) {
    const inMetres = pick((n) => n >= 1.2 && n <= 2.3);
    const value =
      inMetres !== undefined
        ? toCm({ value: inMetres, unit: 'm' })
        : pick((n) => Number.isInteger(n) && n >= 120 && n <= 230);
    if (value !== undefined) out.heightCm = roundTo(value);
  }
  if (wants('weightKg')) {
    const kilos = pick((n) => n >= 30 && n <= 300);
    if (kilos !== undefined) out.weightKg = roundTo(kilos);
  }

  const sessions = /\b(\d)\s*(?:d[ií]as?|veces|days?|times)\b/.exec(t);
  if (/\b(?:poco|no muy|no soy muy|not very|not really)\s+activ/.test(t)) {
    out.activityLevel = 'light';
  } else if (/muy activ|very active/.test(t)) out.activityLevel = 'very_active';
  else if (/sedentari|sedentary|nada activ/.test(t)) out.activityLevel = 'sedentary';
  else if (/\bliger[oa]\b|\blight\b/.test(t)) out.activityLevel = 'light';
  else if (/moderad|moderate/.test(t)) out.activityLevel = 'moderate';
  else if (/\bactiv[oa]\b|\bactive\b/.test(t)) out.activityLevel = 'active';
  else if (sessions?.[1] && (asked.includes('activityLevel') || /semana|week/.test(t))) {
    const perWeek = number(sessions[1]);
    out.activityLevel =
      perWeek === 0 ? 'sedentary' : perWeek <= 2 ? 'light' : perWeek <= 5 ? 'moderate' : 'active';
  } else if (/oficina|sentad[oa]|\bdesk\b|\boffice\b/.test(t)) out.activityLevel = 'sedentary';

  if (/perder|adelgaz|\bbajar\b|grasa|definir|\blose\b|\bfat\b/.test(t)) out.goal = 'lose';
  else if (/ganar|\bsubir\b|volumen|\bmasa\b|\bgain\b|m[uú]sculo|muscle/.test(t)) out.goal = 'gain';
  else if (/mantener|mantenimiento|maintain/.test(t)) out.goal = 'maintain';

  if (/vegetarian/.test(t)) out.dietType = 'vegetarian';
  else if (/vegan/.test(t)) out.dietType = 'vegan';
  else if (/pescetarian|pescatarian/.test(t)) out.dietType = 'pescatarian';
  else if (/omn[ií]vor|como de todo|eat everything|anything/.test(t)) out.dietType = 'omnivore';
  else if (wants('dietType') && /\b(?:no|ningun[ao]|normal|nada|none)\b/.test(t)) {
    out.dietType = 'omnivore';
  }

  const allergy =
    /(?:al[ée]rgic[oa]s?|alergia)\s+(?:a los|a las|a la|al|a)\s+([^.;]+)|allergic to\s+([^.;]+)/.exec(
      t,
    );
  const allergyList = (allergy?.[1] ?? allergy?.[2])?.trim();
  if (allergyList && !/^(?:nada|ning[uú]n|nothing|none|anything)/.test(allergyList)) {
    out.allergies = allergyList
      .split(/,|\by\b|\band\b/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (INJURY_PATTERN.test(t.replace(DENIED_INJURY, ' '))) out.injuries = text.trim().slice(0, 500);
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

/** What the next question is about: the fields still missing in the first incomplete group. */
function pending(draft: OnboardingDraft): { group: string; fields: RequiredDraftField[] } | null {
  const missing = new Set(missingDraftFields(draft));
  const group = GROUPS.find((fields) => fields.some((field) => missing.has(field)));
  if (!group) return null;
  return { group: group.join(','), fields: group.filter((field) => missing.has(field)) };
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
  if (PREGNANCY_PATTERN.test(lower.replace(DENIED_PREGNANCY, ' '))) {
    flags.add('pregnancy');
    parts.push(copy.pregnancy);
  }

  // The user is answering the question about the fields that were pending before this message.
  const extracted = extractFromMessage(last, request.today, pending(draft)?.fields);
  const { allergies, ...rest } = extracted;
  Object.assign(draft, rest);
  if (allergies) draft.allergies = union(draft.allergies, allergies);
  if (extracted.injuries) flags.add('medical_condition');
  if (flags.size > 0) draft.healthFlags = [...flags];

  const understood = Object.keys(extracted).length > 0 || parts.length > 0;
  let askAgain = false;
  if (lower.includes('#demo')) {
    const demo = DEMO_VALUES(request.today);
    for (const field of missingDraftFields(draft)) Object.assign(draft, { [field]: demo[field] });
    parts.push(copy.demo);
  } else if (understood) {
    parts.unshift(copy.noted);
  } else if (userMessages.length <= 1) {
    parts.push(copy.greeting);
  } else {
    // Nothing understood: the draft stays as it was and the question comes back with an example.
    askAgain = true;
    parts.push(copy.retry);
  }

  const next = pending(draft);
  parts.push(next ? (copy.questions[next.fields.join(',')] ?? '') : copy.done);
  if (next && askAgain) parts.push(copy.examples[next.group] ?? '');
  return { kind: 'ok', reply: parts.filter(Boolean).join(' '), draft, softStop: false };
}
