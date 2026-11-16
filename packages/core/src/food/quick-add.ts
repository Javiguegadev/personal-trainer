import { FOOD_LOG_LIMITS } from '@pt/contracts';
import { parseDecimal } from '../format';
import type { FormErrorCode } from '../profile/form';

export interface QuickAddValues {
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/**
 * True when the energy of the macros (4·P + 4·C + 9·F) exceeds the kcal by more than 20 %: the form asks
 * for confirmation before saving, to catch a typing mistake (spec 005 AC10).
 */
export function quickAddEnergyMismatch(values: QuickAddValues): boolean {
  const macroKcal = 4 * (values.proteinG ?? 0) + 4 * (values.carbsG ?? 0) + 9 * (values.fatG ?? 0);
  return macroKcal > values.kcal * (1 + FOOD_LOG_LIMITS.quickAddEnergyTolerance) + 1e-9;
}

/** The quick-add form as typed: every field is text. */
export interface QuickAddFields {
  label: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

export type QuickAddFieldErrors = Partial<Record<keyof QuickAddFields, FormErrorCode>>;

export type ParsedQuickAdd =
  | { ok: true; values: QuickAddValues & { label: string } }
  | { ok: false; errors: QuickAddFieldErrors };

function numberField(
  text: string,
  max: number,
  required: boolean,
): { value: number | null; error?: FormErrorCode } {
  if (text.trim() === '') return required ? { value: null, error: 'required' } : { value: null };
  const value = parseDecimal(text);
  if (value === null) return { value: null, error: 'invalid_number' };
  if (value > max) return { value: null, error: 'too_big' };
  return { value };
}

/**
 * The quick-add form (AC10): a name of 1–80 characters, kcal 0–5000 and optional macros of 0–500 g. An
 * empty macro is null (not entered).
 */
export function parseQuickAddFields(fields: QuickAddFields): ParsedQuickAdd {
  const errors: QuickAddFieldErrors = {};
  const label = fields.label.trim();
  if (label === '') errors.label = 'required';
  else if (label.length > FOOD_LOG_LIMITS.labelMax) errors.label = 'too_long';

  const kcal = numberField(fields.kcal, FOOD_LOG_LIMITS.quickAddKcalMax, true);
  if (kcal.error) errors.kcal = kcal.error;
  const macros = (['protein', 'carbs', 'fat'] as const).map((field) => {
    const parsed = numberField(fields[field], FOOD_LOG_LIMITS.quickAddMacroMax, false);
    if (parsed.error) errors[field] = parsed.error;
    return parsed.value;
  });

  if (Object.keys(errors).length > 0 || kcal.value === null) return { ok: false, errors };
  const [proteinG = null, carbsG = null, fatG = null] = macros;
  return { ok: true, values: { label, kcal: kcal.value, proteinG, carbsG, fatG } };
}
