import {
  CUSTOM_FOOD_LIMITS,
  FOOD_LOG_LIMITS,
  type LabelDraft,
  type LabelReading,
  type LabelScanResponse,
  type QuantityUnit,
} from '@pt/contracts';
import { capEnergy, kcalFromKj } from './product';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Kcal and kJ of the same label within 5 % of each other (kJ are rounded on their own). */
const ENERGY_AGREEMENT = 0.05;
/** Room for a kJ conversion a hair above 900 kcal (see `capEnergy`). */
const KCAL_ROUNDING = 5;
const capped = (kcal: number | null) => (kcal === null ? null : capEnergy(kcal));

const cleanText = (value: string | null, max: number): string | null => {
  const trimmed = value?.replace(/\s+/g, ' ').trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, max).trim();
};

/**
 * The editable draft of a label reading (spec 006 AC15): values per 100 g or ml. Per-serving values
 * are converted with the serving size; kJ become kcal; a value outside its plausible range is dropped
 * (the user types it), never corrected. Nothing is estimated: what the model did not read stays null.
 *
 * The reading is `unreadable` when the model says so, or when it gave none of the four required values.
 */
export function labelDraft(reading: LabelReading): LabelScanResponse {
  if (reading.status !== 'ok') return { status: 'unreadable', reason: reading.status };

  const servingSize =
    reading.servingSize !== null &&
    reading.servingSize >= FOOD_LOG_LIMITS.gramsMin &&
    reading.servingSize <= FOOD_LOG_LIMITS.gramsMax
      ? reading.servingSize
      : null;

  // Values per serving need the size of the serving; without it they cannot be converted.
  const factor =
    reading.basis === 'per_serving'
      ? servingSize === null
        ? null
        : 100 / servingSize
      : reading.basis === null
        ? null
        : 1;
  const per100 = (value: number | null, max: number): number | null => {
    if (value === null || factor === null || !Number.isFinite(value)) return null;
    const scaled = round2(value * factor);
    return scaled >= 0 && scaled <= max ? scaled : null;
  };

  // A label prints the same energy twice. When both were read and they disagree, one of them was
  // misread and there is no telling which: the user types the energy.
  const fromKj = reading.energyKj === null ? null : kcalFromKj(reading.energyKj);
  const disagree =
    reading.energyKcal !== null &&
    fromKj !== null &&
    Math.abs(reading.energyKcal - fromKj) > Math.max(fromKj * ENERGY_AGREEMENT, 2);
  const energy = disagree ? null : (reading.energyKcal ?? fromKj);
  const unit: QuantityUnit =
    reading.basis === 'per_100ml'
      ? 'ml'
      : reading.basis === 'per_serving'
        ? (reading.servingUnit ?? 'g')
        : 'g';
  const draft: LabelDraft = {
    name: cleanText(reading.productName, CUSTOM_FOOD_LIMITS.nameMax),
    brand: cleanText(reading.brand, CUSTOM_FOOD_LIMITS.brandMax),
    unit,
    kcal: capped(per100(energy, CUSTOM_FOOD_LIMITS.kcalMax + KCAL_ROUNDING)),
    proteinG: per100(reading.proteinG, CUSTOM_FOOD_LIMITS.macroMax),
    carbsG: per100(reading.carbsG, CUSTOM_FOOD_LIMITS.macroMax),
    fatG: per100(reading.fatG, CUSTOM_FOOD_LIMITS.macroMax),
    fiberG: per100(reading.fiberG, CUSTOM_FOOD_LIMITS.macroMax),
    // A serving in another unit than the values (30 g of a drink labelled per 100 ml) is not usable.
    servingGrams:
      servingSize !== null && (reading.servingUnit === null || reading.servingUnit === unit)
        ? Math.round(servingSize * 10) / 10
        : null,
  };

  const required = [draft.kcal, draft.proteinG, draft.carbsG, draft.fatG];
  if (required.every((value) => value === null)) return { status: 'unreadable', reason: 'cut_off' };
  return { status: 'ok', draft };
}
