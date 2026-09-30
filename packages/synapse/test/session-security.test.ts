import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MockDatabaseClient } from '../src/core/database-client';
import {
  clearSessionTokenRevocations,
  DEFAULT_REVOCATION_MAX_ENTRIES,
  isSessionTokenRevoked,
  revokeSessionToken,
  revokeSessionTokenInDb,
  sessionTokenRevocationCount,
  signSessionToken,
  verifySessionToken
} from '../src/core/session-token';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { SynapseServer } from '../src/runtime/server';

describe('Production Session & Multi-Tenancy Security', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    clearSessionTokenRevocations();
  });

  it('signs and verifies session token including tenantId', () => {
    const secret = 'super-secret-key-12345678901234567890';
    const token = signSessionToken({ userId: 'user-42', roles: ['admin'], tenantId: 'tenant-acme' }, secret, 3600);

    const verified = verifySessionToken(token, secret);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.userId).toBe('user-42');
      expect(verified.value.roles).toEqual(['admin']);
      expect(verified.value.tenantId).toBe('tenant-acme');
    }
  });

  it('strictly rejects unauthenticated role/id headers in NODE_ENV=production when SYNAPSE_SESSION_SECRET is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SYNAPSE_SESSION_SECRET;
    delete process.env.SYNAPSE_DEV_HEADERS;

    const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
    const req = new Request('http://localhost:3000/api', {
      headers: {
        'x-user-id': 'hacker',
        'x-user-roles': 'admin,superadmin',
        'x-tenant-id': 'victim-org'
      }
    });

    const session = (server as any).sessionFrom(req);
    expect(session.userId).toBeUndefined();
    expect(session.isAuthenticated).toBe(false);
    expect(session.roles).toEqual([]);
    expect(session.tenantId).toBe('victim-org');
  });

  it('accepts signed token and preserves verified tenantId in SynapseServer session', () => {
    const secret = 'prod-secret-must-be-secure-32-chars!!';
    process.env.NODE_ENV = 'production';
    process.env.SYNAPSE_SESSION_SECRET = secret;

    const token = signSessionToken(
      { userId: 'authenticated-user', roles: ['support'], tenantId: 'secure-tenant' },
      secret,
      3600
    );

    const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
    const req = new Request('http://localhost:3000/api', {
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    const session = (server as any).sessionFrom(req);
    expect(session.userId).toBe('authenticated-user');
    expect(session.roles).toEqual(['support']);
    expect(session.tenantId).toBe('secure-tenant');
  });
});

describe('Tenant identity comes only from verified claims', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    clearSessionTokenRevocations();
  });

  it('ignores a tenant header when the verified claims name another tenant', () => {
    const secret = 'tenant-secret-32-chars-minimum-length';
    process.env.SYNAPSE_SESSION_SECRET = secret;

    const token = signSessionToken({ userId: 'u1', roles: ['user'], tenantId: 'acme' }, secret, 3600);
    const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
    const request = new Request('http://localhost/x', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': 'victim-org' }
    });

    const session = (server as any).sessionFrom(request);

    expect(session.tenantId).toBe('acme');
    expect(session.tenantId).not.toBe('victim-org');
  });

  it('does not fall back to the tenant header or the subdomain when the claim is absent', () => {
    const secret = 'tenant-secret-32-chars-minimum-length';
    process.env.SYNAPSE_SESSION_SECRET = secret;

    const token = signSessionToken({ userId: 'u1', roles: ['user'] }, secret, 3600);
    const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
    const request = new Request('https://acme.example.com/x', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': 'victim-org' }
    });

    const session = (server as any).sessionFrom(request);

    expect(session.isAuthenticated).toBe(true);
    expect(session.tenantId).toBeUndefined();
  });

  it('resolves a header-only request to an anonymous session with no tenant', () => {
    const secret = 'tenant-secret-32-chars-minimum-length';
    process.env.SYNAPSE_SESSION_SECRET = secret;

    const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
    const request = new Request('https://acme.example.com/x', {
      headers: { 'x-user-id': 'hacker', 'x-user-roles': 'admin', 'x-tenant-id': 'victim-org' }
    });

    const session = (server as any).sessionFrom(request);

    expect(session.isAuthenticated).toBe(false);
    expect(session.userId).toBeUndefined();
  });
});

describe('Request-time revocation', () => {
  const originalEnv = { ...process.env };
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-revocation-'));

  afterEach(() => {
    process.env = { ...originalEnv };
    clearSessionTokenRevocations();
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.mkdirSync(sandbox, { recursive: true });
  });

  it('rejects a token revoked through the database API, even without the in-process record', async () => {
    const secret = 'revocation-secret-32-chars-minimum';
    process.env.SYNAPSE_SESSION_SECRET = secret;

    const db = new SqliteDatabaseClient(path.join(sandbox, 'revocation.sqlite'));
    const server = new SynapseServer(sandbox, 0, db);
    const token = signSessionToken({ userId: 'u1', roles: ['user'] }, secret, 3600);
    const request = new Request('http://localhost/x', { headers: { authorization: `Bearer ${token}` } });

    // Before revocation the token authenticates.
    const before = await server.requestSession(request);
    expect(before.isAuthenticated).toBe(true);

    await revokeSessionTokenInDb(db, token);
    clearSessionTokenRevocations(); // simulate a restart: only the persisted record remains

    // A fresh process (new server, empty memo) consults the persisted store.
    const restarted = new SynapseServer(sandbox, 0, new SqliteDatabaseClient(path.join(sandbox, 'revocation.sqlite')));
    const after = await restarted.requestSession(request);
    expect(after.isAuthenticated).toBe(false);

    // The verification surface keeps its own machine-readable code.
    const verified = verifySessionToken(token, secret, { checkRevoked: false });
    expect(verified.ok).toBe(true);
  });
});

describe('Revocation storage is bounded', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    clearSessionTokenRevocations();
  });

  it('keeps the in-process set at or below the configured cap', () => {
    process.env.SYNAPSE_REVOCATION_MAX_ENTRIES = '5';
    process.env.SYNAPSE_REVOCATION_TTL_MS = '0';

    for (let index = 0; index < 50; index++) {
      revokeSessionToken(`payload-${index}.signature-${index}`);
    }

    expect(sessionTokenRevocationCount()).toBeLessThanOrEqual(5);
    expect(DEFAULT_REVOCATION_MAX_ENTRIES).toBeGreaterThan(5);
  });

  it('prunes entries older than the retention window', async () => {
    process.env.SYNAPSE_REVOCATION_TTL_MS = '5';

    revokeSessionToken('payload.signature');
    expect(isSessionTokenRevoked('payload.signature')).toBe(true);

    // Wait for the observable transition (the entry is gone), not for a fixed margin.
    const deadline = Date.now() + 2000;

    while (sessionTokenRevocationCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(sessionTokenRevocationCount()).toBe(0);
    expect(isSessionTokenRevoked('payload.signature')).toBe(false);
  });
});

describe('Caller-supplied identity requires an explicit development opt-in', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const cases: Array<{ mode: string | undefined; description: string }> = [
    { mode: undefined, description: 'unset' },
    { mode: 'staging', description: 'staging' },
    { mode: 'prod', description: 'a near-miss production spelling' }
  ];

  for (const { mode, description } of cases) {
    it(`ignores identity headers when the runtime mode is ${description} and no opt-in is present`, () => {
      delete process.env.SYNAPSE_DEV_HEADERS;
      delete process.env.SYNAPSE_SESSION_SECRET;

      if (mode === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = mode;
      }

      const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
      const request = new Request('http://localhost/x', {
        headers: { 'x-user-id': 'hacker', 'x-user-roles': 'admin' }
      });

      const session = (server as any).sessionFrom(request);

      expect(session.isAuthenticated).toBe(false);
      expect(session.roles).toEqual([]);
    });
  }

  it('honours the headers under the explicit development opt-in', () => {
    delete process.env.SYNAPSE_SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.SYNAPSE_DEV_HEADERS = 'true';

    const server = new SynapseServer(process.cwd(), 3000, new MockDatabaseClient());
    const request = new Request('http://localhost/x', {
      headers: { 'x-user-id': 'dev-user', 'x-user-roles': 'admin' }
    });

    const session = (server as any).sessionFrom(request);

    expect(session.isAuthenticated).toBe(true);
    expect(session.userId).toBe('dev-user');
  });
});
