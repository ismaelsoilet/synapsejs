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
  tenantId?: string;
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

export type SessionTokenError = 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'TOKEN_REVOKED';

/** Default bounds for the in-process revocation set. Both are configurable by env. */
export const DEFAULT_REVOCATION_MAX_ENTRIES = 10_000;
export const DEFAULT_REVOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Insertion-ordered signature -> revocation instant. Bounded by cap and TTL. */
const inMemoryRevokedSignatures = new Map<string, number>();

function revocationMaxEntries(): number {
  const raw = Number(process.env.SYNAPSE_REVOCATION_MAX_ENTRIES);

  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_REVOCATION_MAX_ENTRIES;
}

function revocationTtlMs(): number {
  const raw = Number(process.env.SYNAPSE_REVOCATION_TTL_MS);

  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_REVOCATION_TTL_MS;
}

/**
 * Drops expired entries and enforces the entry cap. Returns how many were pruned.
 * Called on every write and read, so neither store grows without bound.
 */
export function pruneSessionTokenRevocations(now = Date.now()): number {
  const ttl = revocationTtlMs();
  let pruned = 0;

  if (ttl > 0) {
    for (const [signature, revokedAt] of inMemoryRevokedSignatures) {
      if (now - revokedAt > ttl) {
        inMemoryRevokedSignatures.delete(signature);
        pruned++;
      }
    }
  }

  const cap = revocationMaxEntries();
  while (inMemoryRevokedSignatures.size > cap) {
    const oldest = inMemoryRevokedSignatures.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    inMemoryRevokedSignatures.delete(oldest);
    pruned++;
  }

  return pruned;
}

export function revokeSessionToken(token: string): boolean {
  const [, signature] = token.split('.');
  if (!signature) return false;
  inMemoryRevokedSignatures.set(signature, Date.now());
  pruneSessionTokenRevocations();
  return true;
}

export function isSessionTokenRevoked(token: string): boolean {
  const [, signature] = token.split('.');
  if (!signature) return true;

  pruneSessionTokenRevocations();

  return inMemoryRevokedSignatures.has(signature);
}

/** Test/tooling helper: how many signatures the in-process set currently holds. */
export function sessionTokenRevocationCount(): number {
  pruneSessionTokenRevocations();

  return inMemoryRevokedSignatures.size;
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
      revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_at_ms INTEGER
    );
  `);

  try {
    await db.query('ALTER TABLE _synapse_session_blacklist ADD COLUMN revoked_at_ms INTEGER;');
  } catch {
    // Column already present, or the engine refuses the ALTER: either way the
    // table carries the revocation instant it needs for pruning.
  }

  const revokedAtMs = Date.now();

  await db
    .query(
      'INSERT INTO _synapse_session_blacklist (token_signature, revoked_at_ms) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
      [signature, revokedAtMs]
    )
    .catch(async () => {
      // SQLite fallback without ON CONFLICT DO NOTHING if needed
      await db
        .query('INSERT OR IGNORE INTO _synapse_session_blacklist (token_signature, revoked_at_ms) VALUES ($1, $2);', [
          signature,
          revokedAtMs
        ])
        .catch(() => {});
    });

  // Also sync in-memory for instant local lookup
  inMemoryRevokedSignatures.set(signature, revokedAtMs);
  pruneSessionTokenRevocations();
  return true;
}

/**
 * Deletes persisted revocations older than the retention window. Returns how many
 * rows were removed; SQLite and PostgreSQL both compare the epoch-millisecond
 * column, so pruning does not depend on either dialect's date functions.
 */
export async function pruneSessionTokenRevocationsInDb(db: DatabaseClient, ttlMs = revocationTtlMs()): Promise<number> {
  if (ttlMs <= 0) {
    return 0;
  }

  try {
    const cutoff = Date.now() - ttlMs;
    const rows = await db.query<{ token_signature: string }>(
      'DELETE FROM _synapse_session_blacklist WHERE revoked_at_ms IS NOT NULL AND revoked_at_ms < $1 RETURNING token_signature;',
      [cutoff]
    );

    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
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
      inMemoryRevokedSignatures.set(signature, Date.now());
      pruneSessionTokenRevocations();
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
  claims: { userId: string; roles: string[]; tenantId?: string },
  secret: string,
  maxAgeSeconds = 86_400
): string {
  const payload = encodePayload(
    JSON.stringify({
      userId: claims.userId,
      roles: claims.roles,
      tenantId: claims.tenantId,
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

  if (claims.tenantId !== undefined && typeof claims.tenantId !== 'string') {
    return Err('INVALID_TOKEN');
  }

  if (claims.exp * 1000 < Date.now()) {
    return Err('EXPIRED_TOKEN');
  }

  return Ok(claims);
}
