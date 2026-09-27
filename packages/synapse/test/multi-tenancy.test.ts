import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnonymousSession, createSession, requireTenant } from '../src/core';
import { SynapseServer } from '../src/runtime/server';

describe('B2B Multi-Tenancy & IDOR Prevention (Fase E)', () => {
  test('requireTenant validates tenant access deterministically', () => {
    // 1. Anonymous session is rejected as UNAUTHORIZED
    const anon = AnonymousSession('org-123');
    const authCheckAnon = requireTenant(anon, 'org-123');
    expect(authCheckAnon.ok).toBe(false);
    if (!authCheckAnon.ok) {
      expect(authCheckAnon.error).toBe('UNAUTHORIZED');
    }

    // 2. Authenticated session with matching tenant is OK
    const validSession = createSession({
      userId: 'user-1',
      tenantId: 'org-acme',
      roles: ['member']
    });
    const authCheckValid = requireTenant(validSession, 'org-acme');
    expect(authCheckValid.ok).toBe(true);

    // 3. Authenticated session attempting to access a different tenant is FORBIDDEN (anti-IDOR)
    const authCheckIdor = requireTenant(validSession, 'org-competitor');
    expect(authCheckIdor.ok).toBe(false);
    if (!authCheckIdor.ok) {
      expect(authCheckIdor.error).toBe('FORBIDDEN');
    }
  });

  test('SynapseServer resolves tenantId from x-tenant-id header and subdomain', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-tenant-'));
    const sliceDir = path.join(appDir, 'src', 'slices', 'crm');
    fs.mkdirSync(sliceDir, { recursive: true });

    // Create a slice action that echoes tenantId back
    fs.writeFileSync(
      path.join(sliceDir, 'check-tenant.slice.tsx'),
      `
      export const checkTenantAction = async (payload, ctx) => {
        return { ok: true, tenantId: ctx.tenantId, sessionTenantId: ctx.session.tenantId };
      };
      `
    );

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    const port = (server as any).httpServer.port;
    const rpcUrl = `http://localhost:${port}/_synapse/rpc/crm/check-tenant`;

    // 1. Via x-tenant-id header
    const resHeader = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'tenant-header-corp',
        'x-user-id': 'user-1'
      },
      body: JSON.stringify({})
    });

    expect(resHeader.status).toBe(200);
    const bodyHeader = await resHeader.json();
    expect(bodyHeader.tenantId).toBe('tenant-header-corp');
    expect(bodyHeader.sessionTenantId).toBe('tenant-header-corp');

    // 2. Via Host subdomain (acme.crm.example.com)
    const resSubdomain = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'acme.crm.example.com',
        'x-user-id': 'user-2'
      },
      body: JSON.stringify({})
    });

    expect(resSubdomain.status).toBe(200);
    const bodySubdomain = await resSubdomain.json();
    expect(bodySubdomain.tenantId).toBe('acme');
    expect(bodySubdomain.sessionTenantId).toBe('acme');

    await server.stop();
    fs.rmSync(appDir, { recursive: true, force: true });
  });
});
