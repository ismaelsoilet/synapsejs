import { afterEach, describe, expect, it } from 'bun:test';
import { MockDatabaseClient } from '../src/core/database-client';
import { signSessionToken, verifySessionToken } from '../src/core/session-token';
import { SynapseServer } from '../src/runtime/server';

describe('Production Session & Multi-Tenancy Security', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
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
