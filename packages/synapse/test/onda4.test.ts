import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { expandNestedObject, getNestedProperty, setNestedProperty } from '../src/client/components';
import { MockDatabaseClient } from '../src/core/database-client';
import { optimizeImage } from '../src/core/image-optimizer';
import {
  clearSessionTokenRevocations,
  isSessionTokenRevoked,
  isSessionTokenRevokedInDb,
  revokeSessionToken,
  revokeSessionTokenInDb,
  signSessionToken,
  verifySessionToken
} from '../src/core/session-token';
import { SynapseServer } from '../src/runtime/server';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/runtime-app');

describe('Onda 4: DataForm Nested Fields & Dot-Notation (DEF-09)', () => {
  it('navigates and sets nested object properties correctly', () => {
    const target: Record<string, any> = {};
    setNestedProperty(target, 'user.profile.bio', 'Fullstack Engineer');
    setNestedProperty(target, 'user.profile.age', 30);
    setNestedProperty(target, 'settings.theme', 'dark');

    expect(target).toEqual({
      user: {
        profile: {
          bio: 'Fullstack Engineer',
          age: 30
        }
      },
      settings: {
        theme: 'dark'
      }
    });

    expect(getNestedProperty(target, 'user.profile.bio')).toBe('Fullstack Engineer');
    expect(getNestedProperty(target, 'user.profile.age')).toBe(30);
    expect(getNestedProperty(target, 'user.nonexistent')).toBeUndefined();
  });

  it('expands flat dot-notation keys into structured nested object', () => {
    const flat = {
      'user.name': 'Alice',
      'user.address.city': 'Florianópolis',
      role: 'admin'
    };

    const expanded = expandNestedObject(flat);
    expect(expanded).toEqual({
      user: {
        name: 'Alice',
        address: {
          city: 'Florianópolis'
        }
      },
      role: 'admin'
    });
  });
});

describe('Onda 4: Session Revocation & Blacklist (DEF-11)', () => {
  const secret = 'test-secret-key-32-chars-minimum-length';

  beforeAll(() => {
    clearSessionTokenRevocations();
  });

  it('verifies a valid token and rejects after revocation', () => {
    const token = signSessionToken({ userId: 'usr_1', roles: ['admin'] }, secret);
    const verified = verifySessionToken(token, secret);
    expect(verified.ok).toBe(true);

    expect(isSessionTokenRevoked(token)).toBe(false);
    expect(revokeSessionToken(token)).toBe(true);
    expect(isSessionTokenRevoked(token)).toBe(true);

    const afterRevocation = verifySessionToken(token, secret);
    expect(afterRevocation.ok).toBe(false);
    if (!afterRevocation.ok) {
      expect(afterRevocation.error).toBe('TOKEN_REVOKED');
    }
  });

  it('persists and checks session revocation in database', async () => {
    const db = new MockDatabaseClient();
    const token = signSessionToken({ userId: 'usr_2', roles: ['user'] }, secret);

    const revokedBefore = await isSessionTokenRevokedInDb(db, token);
    expect(revokedBefore).toBe(false);

    await revokeSessionTokenInDb(db, token);
    const revokedAfter = await isSessionTokenRevokedInDb(db, token);
    expect(revokedAfter).toBe(true);
  });
});

describe('Onda 4: On-Demand Image Optimizer (DEF-02)', () => {
  it('processes raw image buffer and falls back gracefully to passthrough when sharp is absent', async () => {
    const dummyImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const result = await optimizeImage(dummyImage, 'image/png', { width: 100, height: 100 });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.contentType).toBeDefined();
    expect(typeof result.isOptimized).toBe('boolean');
    expect(['sharp', 'passthrough']).toContain(result.engine);
  });
});

describe('Onda 4: 2FA Auth Template Scaffolding (DEF-11)', () => {
  it('scaffolds auth-2fa template with 6-digit TOTP verification contract', () => {
    const { generateOperationTemplate } = require('../src/compiler/slice-templates');
    const source = generateOperationTemplate('auth', 'verify-code', 'auth-2fa');

    expect(source).toContain('CREATE TABLE IF NOT EXISTS');
    expect(source).toContain('totp_secret');
    expect(source).toContain('minLength: 6');
    expect(source).toContain('maxLength: 6');
    expect(source).toContain('verifyCodeAction');
    expect(source).toContain('signSessionToken');
  });
});

describe('Onda 4: Plugin Infrastructure Lifecycle Hooks (DEF-12)', () => {
  let synapse: SynapseServer;
  let server: { port: number; stop: () => void };
  let baseUrl: string;
  let bootstrapCalled = false;
  let migrateCalled = false;

  beforeAll(async () => {
    synapse = new SynapseServer(FIXTURE_DIR, 0);

    // Register test plugin directly on server config
    synapse.config = {
      plugins: [
        {
          name: 'test-audit-plugin',
          onBootstrap: () => {
            bootstrapCalled = true;
          },
          onMigrate: () => {
            migrateCalled = true;
          },
          onRequest: (req) => {
            if (req.url.includes('/_test_plugin_intercept')) {
              return new Response('INTERCEPTED_BY_PLUGIN', { status: 200 });
            }
            return null;
          },
          onResponse: (res) => {
            const clone = new Response(res.body, res);
            clone.headers.set('X-Synapse-Plugin', 'verified');
            return clone;
          }
        }
      ]
    };

    await synapse.discoverSlices();
    server = (await synapse.start()) as unknown as { port: number; stop: () => void };
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server?.stop();
  });

  it('invokes onBootstrap and onMigrate lifecycle hooks', () => {
    expect(bootstrapCalled).toBe(true);
    expect(migrateCalled).toBe(true);
  });

  it('intercepts request early via onRequest hook', async () => {
    const res = await fetch(`${baseUrl}/_test_plugin_intercept`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('INTERCEPTED_BY_PLUGIN');
  });

  it('modifies response headers via onResponse hook', async () => {
    const res = await fetch(`${baseUrl}/tickets/view-tickets`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Synapse-Plugin')).toBe('verified');
  });

  it('handles image optimization endpoint with error guards', async () => {
    const missingUrlRes = await fetch(`${baseUrl}/_synapse/images/optimize`);
    expect(missingUrlRes.status).toBe(400);
    const missingJson = await missingUrlRes.json();
    expect(missingJson.error).toBe('MISSING_URL_PARAM');

    const notFoundRes = await fetch(`${baseUrl}/_synapse/images/optimize?url=nonexistent-img.png`);
    expect(notFoundRes.status).toBe(404);
    const notFoundJson = await notFoundRes.json();
    expect(notFoundJson.error).toBe('IMAGE_NOT_FOUND');
  });
});
