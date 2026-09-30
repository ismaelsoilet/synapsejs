import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SynapseConfig } from '../src/core/config';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { SynapseServer } from '../src/runtime/server';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-headers-'));
const appDir = path.join(sandbox, 'app');

beforeAll(() => {
  fs.symlinkSync(path.resolve(import.meta.dir, '../../../node_modules'), path.join(sandbox, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(appDir, 'src', 'slices', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'public'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'public', 'hello.txt'), 'ok', 'utf-8');
  fs.writeFileSync(
    path.join(appDir, 'src', 'slices', 'demo', 'ping.slice.tsx'),
    `export const PingInputSchema = {};
export async function pingAction(): Promise<never> {
  throw new Error('driver text with C:\\\\Users\\\\secret\\\\db.sqlite inside');
}
`,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(appDir, 'src', 'slices', 'demo', 'chat.slice.tsx'),
    `import { defineSocket } from 'synapsejs';

export const ChatInputSchema = {};
export const sliceSocket = defineSocket<{ text: string }>({
  onMessage(ws, message) {
    ws.send(JSON.stringify({ type: 'ECHO', received: message }));
  }
});
`,
    'utf-8'
  );
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

let boot = 0;

async function bootServer(config?: SynapseConfig): Promise<SynapseServer> {
  boot++;
  const db = new SqliteDatabaseClient(path.join(appDir, '.synapse', `headers-${boot}.sqlite`));
  const server = new SynapseServer(appDir, 0, db, config);
  await server.discoverSlices();
  await server.start();

  return server;
}

function assertBaseline(headers: Headers): void {
  expect(headers.get('x-content-type-options')).toBe('nosniff');
  expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('x-frame-options')).toBe('DENY');
  expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
}

describe('baseline security headers on every response', () => {
  it('carries the baseline on a rendered page, a static file, a 404, a 405 and a refusal', async () => {
    const server = await bootServer();
    const base = `http://localhost:${server.port}`;

    try {
      const page = await fetch(`${base}/demo/ping`);
      assertBaseline(page.headers);

      const staticFile = await fetch(`${base}/hello.txt`);
      expect(staticFile.status).toBe(200);
      assertBaseline(staticFile.headers);

      const missing = await fetch(`${base}/nao-existe`);
      expect(missing.status).toBe(404);
      assertBaseline(missing.headers);

      const wrongMethod = await fetch(`${base}/_synapse/rpc/demo/ping`);
      expect(wrongMethod.status).toBe(405);
      assertBaseline(wrongMethod.headers);

      const limiter = server.rateLimitEngine;
      limiter.reset();
      // biome-ignore lint/suspicious/noExplicitAny: tightening the limiter for the refusal case
      (limiter as any).capacity = 1;
      // biome-ignore lint/suspicious/noExplicitAny: tightening the limiter for the refusal case
      (limiter as any).refillRate = 0.001;

      await fetch(`${base}/_synapse/api/health`);
      const refused = await fetch(`${base}/_synapse/api/health`);
      expect(refused.status).toBe(429);
      assertBaseline(refused.headers);
    } finally {
      await server.stop();
    }
  });

  it('emits HSTS only on a TLS connection', async () => {
    const server = await bootServer({ trustProxy: true });
    const base = `http://localhost:${server.port}`;

    try {
      const plaintext = await fetch(`${base}/hello.txt`);
      expect(plaintext.headers.get('strict-transport-security')).toBeNull();

      const forwardedTls = await fetch(`${base}/hello.txt`, { headers: { 'x-forwarded-proto': 'https' } });
      expect(forwardedTls.headers.get('strict-transport-security')).toContain('max-age=');
    } finally {
      await server.stop();
    }
  });
});

describe('content-security policy and third-party origins', () => {
  it('references nothing third-party by default and emits a same-origin policy', async () => {
    const server = await bootServer();

    try {
      const response = await fetch(`http://localhost:${server.port}/demo/ping`);
      const html = await response.text();
      const policy = response.headers.get('content-security-policy') ?? '';

      expect(html).not.toContain('cdn.tailwindcss.com');
      expect(html).not.toContain('fonts.googleapis.com');
      expect(policy).toContain("default-src 'self'");
      expect(policy).not.toContain('cdn.tailwindcss.com');
      expect(policy).not.toContain('unsafe-eval');
    } finally {
      await server.stop();
    }
  });

  it('restores the origins only on opt-in, pinned by integrity, and never with blanket directives', async () => {
    const server = await bootServer({
      cdn: { enabled: true, scriptIntegrity: 'sha384-AAA', fontIntegrity: 'sha384-BBB' }
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/demo/ping`);
      const html = await response.text();
      const policy = response.headers.get('content-security-policy') ?? '';

      expect(html).toContain('cdn.tailwindcss.com');
      expect(html).toContain('integrity="sha384-AAA"');
      expect(html).toContain('fonts.googleapis.com');
      expect(policy).toContain('https://cdn.tailwindcss.com');
      expect(policy).toContain('https://fonts.googleapis.com');
      expect(policy).not.toContain('unsafe-eval');
      expect(policy).not.toContain('script-src *');
    } finally {
      await server.stop();
    }
  });

  it('emits an operator-supplied policy unchanged and never omits it', async () => {
    const server = await bootServer({ contentSecurityPolicy: "default-src 'none'" });

    try {
      const response = await fetch(`http://localhost:${server.port}/hello.txt`);

      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    } finally {
      await server.stop();
    }
  });
});

describe('internal failure masking', () => {
  it('masks the exception text in production mode and keeps it in the log with a correlation id', async () => {
    const previous = process.env.SYNAPSE_ENV;
    process.env.SYNAPSE_ENV = 'production';

    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };

    const server = await bootServer();

    try {
      const response = await fetch(`http://localhost:${server.port}/_synapse/rpc/demo/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string; correlationId: string; message?: string };

      expect(body.error).toBe('INTERNAL_ERROR');
      expect(body.correlationId).toBeDefined();
      expect(body.message).toBeUndefined();

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('driver text');
      expect(serialized).not.toContain('C:\\Users');

      // The full text, and the same correlation id, are on the log record.
      expect(logged.join('\n')).toContain(body.correlationId);
      expect(logged.join('\n')).toContain('driver text');
    } finally {
      await server.stop();
      console.error = originalError;
      if (previous === undefined) {
        delete process.env.SYNAPSE_ENV;
      } else {
        process.env.SYNAPSE_ENV = previous;
      }
    }
  });

  it('keeps the detail in development mode', async () => {
    const originalError = console.error;
    console.error = () => {};

    const server = await bootServer();

    try {
      const response = await fetch(`http://localhost:${server.port}/_synapse/rpc/demo/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const body = (await response.json()) as { error: string; message?: string };

      expect(body.error).toBe('INTERNAL_ERROR');
      expect(body.message).toContain('driver text');
    } finally {
      await server.stop();
      console.error = originalError;
    }
  });
});

describe('WebSocket upgrade origin posture', () => {
  const cases: Array<{ origin?: string; description: string; expected: number }> = [
    { origin: undefined, description: 'an absent origin', expected: 403 },
    { origin: 'null', description: 'an opaque origin', expected: 403 },
    { origin: 'https://evil.example.org', description: 'an unlisted origin', expected: 403 },
    // A loopback origin passes the check, so the request reaches the upgrade attempt.
    { origin: 'http://localhost:5173', description: 'a loopback origin', expected: 400 }
  ];

  for (const { origin, description, expected } of cases) {
    it(`handles ${description}`, async () => {
      const previous = process.env.SYNAPSE_ALLOWED_ORIGINS;
      delete process.env.SYNAPSE_ALLOWED_ORIGINS;

      const server = await bootServer();

      try {
        const response = await fetch(`http://localhost:${server.port}/_synapse/ws/demo/chat`, {
          headers: origin ? { origin } : {}
        });

        expect(response.status).toBe(expected);
      } finally {
        await server.stop();
        if (previous === undefined) {
          delete process.env.SYNAPSE_ALLOWED_ORIGINS;
        } else {
          process.env.SYNAPSE_ALLOWED_ORIGINS = previous;
        }
      }
    });
  }

  it('enforces a per-client cap on concurrent realtime connections', async () => {
    const server = await bootServer({ realtime: { maxConnectionsPerClient: 1 } });

    try {
      const url = `ws://localhost:${server.port}/_synapse/ws/demo/chat`;
      const first = new WebSocket(url, { headers: { origin: 'http://localhost:5173' } } as never);

      await new Promise<void>((resolve, reject) => {
        first.onopen = () => resolve();
        first.onerror = () => reject(new Error('first connection refused'));
        setTimeout(() => reject(new Error('timeout')), 2000);
      });

      const second = new WebSocket(url, { headers: { origin: 'http://localhost:5173' } } as never);
      const secondOutcome = await new Promise<string>((resolve) => {
        second.onopen = () => resolve('opened');
        second.onerror = () => resolve('refused');
        setTimeout(() => resolve('timeout'), 2000);
      });

      expect(secondOutcome).toBe('refused');

      first.close();
    } finally {
      await server.stop();
    }
  });
});
