/**
 * Barcodes of retail products (spec 006 AC2). One canonical form per product, the one Open Food Facts
 * uses: EAN-8 as it is, everything else as EAN-13 (a UPC gets leading zeros).
 */

/** The symbology the camera reports, when the code was scanned and not typed. */
export type BarcodeType = 'ean13' | 'ean8' | 'upc_a' | 'upc_e';

const DIGITS = /^\d+$/;

/** GS1 check digit: from the right, the digits before the last weigh 3, 1, 3… */
function hasValidCheckDigit(code: string): boolean {
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** UPC-E (number system, six digits, check digit) to the UPC-A it abbreviates. */
function expandUpcE(code: string): string | null {
  const system = code[0]!;
  if (system !== '0' && system !== '1') return null;
  const [a, b, c, d, e, last] = code.slice(1, 7).split('') as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  let body: string;
  if (last === '0' || last === '1' || last === '2') body = `${a}${b}${last}0000${c}${d}${e}`;
  else if (last === '3') body = `${a}${b}${c}00000${d}${e}`;
  else if (last === '4') body = `${a}${b}${c}${d}00000${e}`;
  else body = `${a}${b}${c}${d}${e}0000${last}`;
  return `${system}${body}${code[7]}`;
}

/**
 * The canonical barcode for what the camera read or the user typed, or null when it is not a valid
 * EAN-13, EAN-8, UPC-A or UPC-E (wrong length or check digit). Spaces and hyphens are ignored.
 */
export function normalizeBarcode(raw: string, type?: BarcodeType): string | null {
  const code = raw.replace(/[\s-]/g, '');
  if (!DIGITS.test(code)) return null;
  const upcE = () => {
    const upcA = expandUpcE(code);
    return upcA && hasValidCheckDigit(upcA) ? `0${upcA}` : null;
  };
  switch (code.length) {
    case 8:
      if (type === 'upc_e') return upcE();
      if (hasValidCheckDigit(code)) return code;
      // A typed code has no symbology: eight digits that are not an EAN-8 may still be a UPC-E.
      return type === undefined ? upcE() : null;
    case 12:
      return hasValidCheckDigit(code) ? `0${code}` : null;
    case 13:
      return hasValidCheckDigit(code) ? code : null;
    case 14:
      // GTIN-14 of a single unit: a zero in front of its EAN-13.
      return code.startsWith('0') && hasValidCheckDigit(code) ? code.slice(1) : null;
    default:
      return null;
  }
}

/**
 * Codes a shop prints itself (EAN-13 starting with 2: products weighed at the counter, coupons). They
 * mean something else in every shop, so no database can know them.
 */
export function isInStoreBarcode(barcode: string): boolean {
  return barcode.length === 13 && barcode.startsWith('2');
}
