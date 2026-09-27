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

import type { DatabaseClient } from './database-client';
import { Err, Ok, type Result } from './machine-types';

export interface SessionClaims {
  userId: string;
  roles: string[];
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

export type SessionTokenError = 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'TOKEN_REVOKED';

const inMemoryRevokedSignatures = new Set<string>();

export function revokeSessionToken(token: string): boolean {
  const [, signature] = token.split('.');
  if (!signature) return false;
  inMemoryRevokedSignatures.add(signature);
  return true;
}

export function isSessionTokenRevoked(token: string): boolean {
  const [, signature] = token.split('.');
  if (!signature) return true;
  return inMemoryRevokedSignatures.has(signature);
}

export function clearSessionTokenRevocations(): void {
  inMemoryRevokedSignatures.clear();
}

/**
 * Persists a token revocation into the database blacklist table.
 */
export async function revokeSessionTokenInDb(db: DatabaseClient, token: string): Promise<boolean> {
  const [, signature] = token.split('.');
  if (!signature) return false;

  await db.query(`
    CREATE TABLE IF NOT EXISTS _synapse_session_blacklist (
      token_signature TEXT PRIMARY KEY,
      revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db
    .query('INSERT INTO _synapse_session_blacklist (token_signature) VALUES ($1) ON CONFLICT DO NOTHING;', [signature])
    .catch(async () => {
      // SQLite fallback without ON CONFLICT DO NOTHING if needed
      await db
        .query('INSERT OR IGNORE INTO _synapse_session_blacklist (token_signature) VALUES ($1);', [signature])
        .catch(() => {});
    });

  // Also sync in-memory for instant local lookup
  inMemoryRevokedSignatures.add(signature);
  return true;
}

/**
 * Checks whether a token signature exists in the database blacklist table.
 */
export async function isSessionTokenRevokedInDb(db: DatabaseClient, token: string): Promise<boolean> {
  const [, signature] = token.split('.');
  if (!signature) return true;

  if (inMemoryRevokedSignatures.has(signature)) return true;

  try {
    const rows = await db.query('SELECT token_signature FROM _synapse_session_blacklist WHERE token_signature = $1;', [
      signature
    ]);
    if (rows && rows.length > 0) {
      inMemoryRevokedSignatures.add(signature);
      return true;
    }
  } catch {
    // If table doesn't exist yet, it's not revoked
  }

  return false;
}

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

export function verifySessionToken(
  token: string,
  secret: string,
  options?: { checkRevoked?: boolean }
): Result<SessionClaims, SessionTokenError> {
  const [payload, provided] = token.split('.');
  if (!payload || !provided) {
    return Err('INVALID_TOKEN');
  }

  if (!constantTimeEquals(sign(payload, secret), provided)) {
    return Err('INVALID_TOKEN');
  }

  if (options?.checkRevoked !== false && isSessionTokenRevoked(token)) {
    return Err('TOKEN_REVOKED');
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
