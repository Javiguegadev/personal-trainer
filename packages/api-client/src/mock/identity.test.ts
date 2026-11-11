import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { mockAccessToken, mockUserFromEmail, parseMockToken } from './identity';

describe('mock identity', () => {
  it('maps the same email to the same valid UUID, ignoring case and spaces', () => {
    const a = mockUserFromEmail('Ana@Example.com ');
    const b = mockUserFromEmail('ana@example.com');
    expect(a).toEqual(b);
    expect(z.uuid().safeParse(a.userId).success).toBe(true);
    expect(mockUserFromEmail('bob@example.com').userId).not.toBe(a.userId);
  });

  it('round-trips a token and rejects anything else', () => {
    const user = mockUserFromEmail('ana@example.com');
    expect(parseMockToken(mockAccessToken(user))).toEqual(user);
    expect(parseMockToken('eyJhbGciOi.real.jwt')).toBeNull();
    expect(parseMockToken('mock.%7Bbroken')).toBeNull();
    expect(parseMockToken(null)).toBeNull();
  });
});
