/**
 * SynapseJS - Signed Session Tokens
 *
 * The framework does not ship a login screen; it ships the primitive that makes
 * one safe. A slice signs a session (user id plus roles) with a server secret, the
 * browser carries it in the `synapse_token` cookie, and the server derives the
 * session from the signature instead of trusting a header any client can write.
 *
 * Without `SYNAPSE_SESSION_SECRET` the server keeps its development behaviour
 * (roles from a header), which is convenient locally and unsafe in production —
 * that difference is deliberate and documented.
 */

import { Err, Ok, type Result } from './machine-types';

export interface SessionClaims {
  userId: string;
  roles: string[];
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

export type SessionTokenError = 'INVALID_TOKEN' | 'EXPIRED_TOKEN';

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function encodePayload(payload: string): string {
  return toBase64Url(new TextEncoder().encode(payload));
}

function sign(payload: string, secret: string): string {
  return toBase64Url(new Bun.CryptoHasher('sha256', secret).update(payload).digest());
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
}

export function signSessionToken(
  claims: { userId: string; roles: string[] },
  secret: string,
  maxAgeSeconds = 86_400
): string {
  const payload = encodePayload(
    JSON.stringify({
      userId: claims.userId,
      roles: claims.roles,
      exp: Math.floor(Date.now() / 1000) + maxAgeSeconds
    })
  );

  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string, secret: string): Result<SessionClaims, SessionTokenError> {
  const [payload, provided] = token.split('.');
  if (!payload || !provided) {
    return Err('INVALID_TOKEN');
  }

  if (!constantTimeEquals(sign(payload, secret), provided)) {
    return Err('INVALID_TOKEN');
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionClaims;
  } catch {
    return Err('INVALID_TOKEN');
  }

  if (typeof claims.userId !== 'string' || !Array.isArray(claims.roles) || typeof claims.exp !== 'number') {
    return Err('INVALID_TOKEN');
  }

  if (claims.exp * 1000 < Date.now()) {
    return Err('EXPIRED_TOKEN');
  }

  return Ok(claims);
}
