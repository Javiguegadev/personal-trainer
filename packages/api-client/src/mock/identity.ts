/**
 * Fake identities for the in-app mock backend (dev and E2E only). The same email always maps to the same
 * user id, like a real account, so signing out and in again keeps the mock profile.
 */
export interface MockUser {
  userId: string;
  email: string;
}

export const MOCK_TOKEN_PREFIX = 'mock.';

/** FNV-1a 32-bit hash with a seed, as 8 hex characters. */
function fnv1a(input: string, seed: number): string {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic RFC 9562-shaped UUID (version 4 nibble, variant 8) derived from the email. */
export function mockUserFromEmail(email: string): MockUser {
  const normalized = email.trim().toLowerCase();
  const hex = [1, 2, 3, 4].map((seed) => fnv1a(normalized, seed)).join('');
  const userId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
  return { userId, email: normalized };
}

export function mockAccessToken(user: MockUser): string {
  return `${MOCK_TOKEN_PREFIX}${encodeURIComponent(JSON.stringify(user))}`;
}

export function parseMockToken(token: string | null | undefined): MockUser | null {
  if (!token?.startsWith(MOCK_TOKEN_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(token.slice(MOCK_TOKEN_PREFIX.length)));
    if (
      typeof value === 'object' &&
      value !== null &&
      'userId' in value &&
      'email' in value &&
      typeof value.userId === 'string' &&
      typeof value.email === 'string'
    ) {
      return { userId: value.userId, email: value.email };
    }
  } catch {
    // Not a mock token.
  }
  return null;
}
