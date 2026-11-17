/** AC24: the user types DELETE or ELIMINAR (any case, surrounding spaces ignored) to delete the account. */
const WORDS = new Set(['DELETE', 'ELIMINAR']);

export function isDeleteConfirmation(text: string): boolean {
  return WORDS.has(text.trim().toUpperCase());
}
