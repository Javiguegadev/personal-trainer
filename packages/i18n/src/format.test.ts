import { describe, expect, it } from 'vitest';
import { format, resolveLocale } from './format';
import { messages } from './index';

describe('format', () => {
  it('replaces placeholders', () => {
    expect(format('Reenviar en {seconds} s', { seconds: 42 })).toBe('Reenviar en 42 s');
    expect(format('{a} y {b}', { a: 'x', b: 'y' })).toBe('x y y');
  });

  it('leaves unknown placeholders visible', () => {
    expect(format('Hola {name}', {})).toBe('Hola {name}');
  });
});

describe('resolveLocale', () => {
  it('picks the first supported language, ignoring the region', () => {
    expect(resolveLocale(['en-GB', 'es'])).toBe('en');
    expect(resolveLocale(['ca', 'es-ES'])).toBe('es');
    expect(resolveLocale(['EN_us'])).toBe('en');
  });

  it('falls back to Spanish', () => {
    expect(resolveLocale(['fr', null, undefined])).toBe('es');
    expect(resolveLocale([])).toBe('es');
  });
});

describe('messages', () => {
  /** Placeholders must match between locales, or a translation would drop a value. */
  function placeholders(record: unknown, path = ''): Record<string, string[]> {
    if (typeof record === 'string') {
      return { [path]: [...record.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort() };
    }
    return Object.entries(record as Record<string, unknown>).reduce<Record<string, string[]>>(
      (acc, [key, value]) => ({ ...acc, ...placeholders(value, path ? `${path}.${key}` : key) }),
      {},
    );
  }

  it('uses the same placeholders in every locale', () => {
    expect(placeholders(messages.en)).toEqual(placeholders(messages.es));
  });

  it('has no empty strings', () => {
    for (const locale of ['es', 'en'] as const) {
      const empty = Object.entries(placeholders(messages[locale])).filter(([path]) => {
        const value = path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], messages[locale]);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(empty, locale).toEqual([]);
    }
  });
});

describe('consent text', () => {
  /** Every input that reaches the AI provider is named (spec 006 AC21, spec 007 AC17). */
  it('names the label photo, the plate photo and the sentence in both locales', () => {
    expect(messages.es.consent.points.use).toMatch(/etiqueta.*plato.*frase.*Anthropic/);
    expect(messages.en.consent.points.use).toMatch(/label.*plate.*sentence.*Anthropic/);
  });
});
