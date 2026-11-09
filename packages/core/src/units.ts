export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;

/** Round to a fixed number of decimals, avoiding binary float artifacts (e.g. 1.005). */
export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function inchToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

export function cmToInch(cm: number): number {
  return cm / CM_PER_INCH;
}
