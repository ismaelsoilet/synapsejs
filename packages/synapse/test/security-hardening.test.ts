import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as path from 'path';
import { signSessionToken } from '../src/core/session-token';
import { escapeHtml, parseCookies, SynapseServer } from '../src/runtime/server';

const appDir = path.resolve(import.meta.dir, 'fixtures', 'runtime-app');

let server: { port: number; stop: () => void };
let base: string;

beforeAll(async () => {
  const synapse = new SynapseServer(appDir, 0);
  await synapse.discoverSlices();
  server = (await synapse.start()) as unknown as { port: number; stop: () => void };
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop();
});

describe('Zero-Day Auth Bypass Prevention (V-01)', () => {
  const testSecret = 'production-grade-session-secret-123';

  it('strictly rejects unauthenticated x-user-roles headers when SYNAPSE_SESSION_SECRET is set', async () => {
    process.env.SYNAPSE_SESSION_SECRET = testSecret;

    // Atacante omite o header Authorization e tenta forjar privilégios de admin
    const response = await fetch(`${base}/tickets/view-tickets`, {
      headers: {
        'x-user-roles': 'admin,superuser',
        'x-user-id': 'attacker'
      }
    });

    delete process.env.SYNAPSE_SESSION_SECRET;

    const html = await response.text();
    expect(response.status).toBe(200);
    // Deve ser tratado terminantemente como anônimo
    expect(html).toContain('LOADER-TICKETS-default-anonimo');
    expect(html).not.toContain('admin');
    expect(html).not.toContain('superuser');
  });

  it('rejects tampered Bearer tokens even when combined with role headers', async () => {
    process.env.SYNAPSE_SESSION_SECRET = testSecret;

    const response = await fetch(`${base}/tickets/view-tickets`, {
      headers: {
        Authorization: 'Bearer invalid.forged.signature',
        'x-user-roles': 'admin'
      }
    });

    delete process.env.SYNAPSE_SESSION_SECRET;

    const html = await response.text();
    expect(html).toContain('LOADER-TICKETS-default-anonimo');
    expect(html).not.toContain('admin');
  });

  it('accepts authentic signed Bearer token and uses its claims', async () => {
    process.env.SYNAPSE_SESSION_SECRET = testSecret;
    const token = signSessionToken({ userId: 'authorized-user', roles: ['financeiro', 'auditor'] }, testSecret);

    const response = await fetch(`${base}/tickets/view-tickets`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-user-roles': 'hacker' // Deve ser ignorado em favor dos papéis assinados
      }
    });

    delete process.env.SYNAPSE_SESSION_SECRET;

    const html = await response.text();
    expect(html).toContain('LOADER-TICKETS-default-financeiro,auditor');
    expect(html).not.toContain('hacker');
  });
});

describe('SSR Cookie Session Authentication (V-03)', () => {
  const testSecret = 'production-grade-cookie-secret-456';

  it('authenticates SSR requests via signed synapse_token cookie in production', async () => {
    process.env.SYNAPSE_SESSION_SECRET = testSecret;
    const token = signSessionToken({ userId: 'cookie-user', roles: ['gestor'] }, testSecret);

    const response = await fetch(`${base}/tickets/view-tickets`, {
      headers: {
        Cookie: `synapse_token=${token}`
      }
    });

    delete process.env.SYNAPSE_SESSION_SECRET;

    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('LOADER-TICKETS-default-gestor');
  });

  it('rejects forged synapse_token cookies in production mode', async () => {
    process.env.SYNAPSE_SESSION_SECRET = testSecret;

    const response = await fetch(`${base}/tickets/view-tickets`, {
      headers: {
        Cookie: 'synapse_token=malicious.token.signature'
      }
    });

    delete process.env.SYNAPSE_SESSION_SECRET;

    const html = await response.text();
    expect(html).toContain('LOADER-TICKETS-default-anonimo');
  });

  it('accepts synapse_roles cookie in local dev mode when no secret is set', async () => {
    const previous = process.env.SYNAPSE_SESSION_SECRET;
    delete process.env.SYNAPSE_SESSION_SECRET;

    const response = await fetch(`${base}/tickets/view-tickets`, {
      headers: {
        Cookie: 'synapse_roles=dev_admin,analyst'
      }
    });

    if (previous !== undefined) {
      process.env.SYNAPSE_SESSION_SECRET = previous;
    }

    const html = await response.text();
    expect(html).toContain('LOADER-TICKETS-default-dev_admin,analyst');
  });
});

describe('Path Traversal Prevention in Static Files (V-02)', () => {
  it('serves legitimate files from the public directory', async () => {
    const response = await fetch(`${base}/hello.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ola do public');
  });

  it('refuses path traversal attempts trying to escape public directory', async () => {
    const traversalAttempts = [
      '/..%2Fpackage.json',
      '/../../package.json',
      '/..%2f..%2fpackage.json',
      '/../src/index.ts',
      '/public/../src/index.ts'
    ];

    for (const urlPath of traversalAttempts) {
      const response = await fetch(`${base}${urlPath}`);
      expect(response.status).toBe(404);
    }
  });
});

describe('Reflected XSS Sanitization (V-04)', () => {
  it('correctly escapes all HTML special characters in escapeHtml', () => {
    const malicious = `<script>alert('XSS & "fun"')</script>`;
    const escaped = escapeHtml(malicious);

    expect(escaped).toBe('&lt;script&gt;alert(&#39;XSS &amp; &quot;fun&quot;&#39;)&lt;/script&gt;');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('escapes loader error messages reflected on SSR error pages', async () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    // Faz o loader falhar com fail=1 e tenta injetar XSS
    const response = await fetch(`${base}/tickets/view-tickets?fail=1&marker=${encodeURIComponent(xssPayload)}`);
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain('Falha no loader de tickets/view-tickets');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });
});

describe('parseCookies utility', () => {
  it('parses single and multiple cookies correctly', () => {
    const cookies = parseCookies('synapse_token=abc123xyz; synapse_roles=sales%2Cadmin; other=val');
    expect(cookies.synapse_token).toBe('abc123xyz');
    expect(cookies.synapse_roles).toBe('sales,admin');
    expect(cookies.other).toBe('val');
  });

  it('handles empty or malformed cookie headers gracefully', () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies(';   ; ;')).toEqual({});
  });
});
