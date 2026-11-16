import { describe, expect, it } from 'vitest';
import { isInStoreBarcode, normalizeBarcode } from './barcode';

describe('normalizeBarcode (spec 006 AC2)', () => {
  it('accepts an EAN-13 with a valid check digit', () => {
    expect(normalizeBarcode('3017620422003')).toBe('3017620422003');
    expect(normalizeBarcode('5449000000996', 'ean13')).toBe('5449000000996');
  });

  it('rejects a wrong check digit', () => {
    expect(normalizeBarcode('3017620422004')).toBeNull();
    expect(normalizeBarcode('96385075')).toBeNull();
  });

  it('keeps an EAN-8 as it is', () => {
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(normalizeBarcode('73513537', 'ean8')).toBe('73513537');
  });

  it('writes a UPC-A as an EAN-13 with a leading zero', () => {
    expect(normalizeBarcode('036000291452', 'upc_a')).toBe('0036000291452');
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
    expect(normalizeBarcode('036000291453')).toBeNull();
  });

  it('expands a UPC-E to the same EAN-13 as its UPC-A', () => {
    // 0 425261 4 → UPC-A 042100005264
    expect(normalizeBarcode('04252614', 'upc_e')).toBe('0042100005264');
    // 0 123456 5 → UPC-A 012345000065 (last digit 6: five digits, four zeros, the digit)
    expect(normalizeBarcode('01234565', 'upc_e')).toBe('0012345000065');
    expect(normalizeBarcode('04252615', 'upc_e')).toBeNull();
  });

  it('reads eight typed digits as an EAN-8 first, then as a UPC-E', () => {
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(normalizeBarcode('04252614')).toBe('0042100005264');
    // The camera said EAN-8, so a failed check digit is a bad read.
    expect(normalizeBarcode('04252614', 'ean8')).toBeNull();
  });

  it('drops the leading zero of a GTIN-14', () => {
    expect(normalizeBarcode('03017620422003')).toBe('3017620422003');
    expect(normalizeBarcode('13017620422000')).toBeNull();
  });

  it('ignores spaces and hyphens, and rejects anything else', () => {
    expect(normalizeBarcode(' 3 017620 422003 ')).toBe('3017620422003');
    expect(normalizeBarcode('3017620-422003')).toBe('3017620422003');
    expect(normalizeBarcode('30176204220o3')).toBeNull();
    expect(normalizeBarcode('')).toBeNull();
    expect(normalizeBarcode('12345')).toBeNull();
    expect(normalizeBarcode('123456789012345')).toBeNull();
  });
});

describe('isInStoreBarcode', () => {
  it('is true for EAN-13 codes that start with 2', () => {
    expect(isInStoreBarcode('2000000000008')).toBe(true);
    expect(isInStoreBarcode('3017620422003')).toBe(false);
    expect(isInStoreBarcode('20000004')).toBe(false);
  });
});
