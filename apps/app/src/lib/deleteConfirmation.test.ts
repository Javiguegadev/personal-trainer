import { describe, expect, it } from 'vitest';
import { isDeleteConfirmation } from './deleteConfirmation';

describe('isDeleteConfirmation (AC24)', () => {
  it('accepts DELETE or ELIMINAR in any case', () => {
    for (const text of ['ELIMINAR', 'eliminar', ' Delete ', 'DELETE']) {
      expect(isDeleteConfirmation(text), text).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const text of ['', 'ELIMINA', 'borrar', 'DELETE ME', 'yes']) {
      expect(isDeleteConfirmation(text), text).toBe(false);
    }
  });
});
