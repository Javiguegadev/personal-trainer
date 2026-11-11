import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type { Store, VerifyToken } from '../deps';
import { apiError, type AuthEnv } from '../http';

const Uuid = z.uuid();

/**
 * Verifies Supabase access tokens (asymmetric signing keys) against the project's JWKS (AC5).
 * `userId = sub`; only `authenticated` tokens are accepted (the anon key has no user).
 */
export function createJwtVerifier(options: { jwks: JWTVerifyGetKey; issuer: string }): VerifyToken {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, options.jwks, {
        issuer: options.issuer,
        audience: 'authenticated',
      });
      if (!Uuid.safeParse(payload.sub).success) return null;
      return {
        userId: payload.sub as string,
        email: typeof payload.email === 'string' ? payload.email : null,
      };
    } catch {
      return null;
    }
  };
}

/** JWKS + issuer of a Supabase project, e.g. `https://xyz.supabase.co`. */
export function supabaseJwtVerifier(supabaseUrl: string): VerifyToken {
  const base = supabaseUrl.replace(/\/+$/, '');
  return createJwtVerifier({
    jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`)),
    issuer: `${base}/auth/v1`,
  });
}

export function requireAuth(verifyToken: VerifyToken) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const user = match ? await verifyToken(match[1] as string) : null;
    if (!user) return apiError(c, 401, 'unauthorized');
    c.set('user', user);
    await next();
  });
}

/** Routes that store or process health data need the explicit consent (AC7). Use after `requireAuth`. */
export function requireConsent(store: Store) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    if (!(await store.hasConsent(c.var.user.userId, 'health_data'))) {
      return apiError(c, 403, 'consent_required');
    }
    await next();
  });
}
