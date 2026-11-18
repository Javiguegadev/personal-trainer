import { describe, expect, it } from 'vitest';
import { noteLanguage, wrongLanguage } from './language';

// Notes from the 2026-11-18 eval report.
describe('noteLanguage', () => {
  it('tells Spanish from English notes', () => {
    expect(
      noteLanguage(
        'Aún queda bastante proteína por cubrir: en la comida o la cena puedes añadir pechuga de pollo a la plancha o salmón a la plancha.',
      ),
    ).toBe('es');
    expect(
      noteLanguage(
        'There is still a good amount of protein to add at dinner. Grilled chicken breast or grilled salmon would fit well.',
      ),
    ).toBe('en');
    expect(
      noteLanguage('Most of the protein came in one meal. Try adding some protein to breakfast.'),
    ).toBe('en');
  });

  it('flags a Spanish sentence with English food names in an English day', () => {
    const note =
      'Para sumar fibra en la cena, unas Cooked lentils o Cooked chickpeas encajan muy bien con tu dieta.';
    expect(wrongLanguage(note, 'en')).toBe(true);
    expect(wrongLanguage(note, 'es')).toBe(false);
  });

  it('does not flag a note it cannot tell apart', () => {
    expect(noteLanguage('Tofu, quark.')).toBeNull();
    expect(wrongLanguage('Tofu, quark.', 'en')).toBe(false);
  });
});
