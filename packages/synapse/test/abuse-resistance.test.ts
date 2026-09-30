import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseDdlToCatalog } from '../src/compiler/db-schema-generator';
import { SERVER_ONLY_PATTERNS } from '../src/compiler/slice-splitter';
import type { SynapseConfig } from '../src/core/config';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { fetchPinnedExternal, SynapseServer } from '../src/runtime/server';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-abuse-'));
const appDir = path.join(sandbox, 'app');

beforeAll(() => {
  // The fixture app lives outside the repo, so the workspace's node_modules is linked
  // in for the slice's `react` import to resolve.
  fs.symlinkSync(path.resolve(import.meta.dir, '../../../node_modules'), path.join(sandbox, 'node_modules'), 'dir');

  fs.mkdirSync(path.join(appDir, 'src', 'slices', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'public'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'public', 'hello.txt'), 'ok', 'utf-8');

  fs.writeFileSync(
    path.join(appDir, 'src', 'slices', 'demo', 'ping.slice.tsx'),
    `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';

export const PingInputSchema = Type.Object({ value: Type.Number() });

export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS pings (
    id TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
\`;

export async function pingAction(payload: { value: number }): Promise<Result<{ id: string }, 'ERR'>> {
  return Ok({ id: 'p-' + payload.value });
}

export function PingView() {
  return <p>pong</p>;
}
`,
    'utf-8'
  );
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

let bootCounter = 0;

async function bootServer(config?: SynapseConfig): Promise<SynapseServer> {
  bootCounter++;
  const db = new SqliteDatabaseClient(path.join(appDir, '.synapse', `abuse-${bootCounter}.sqlite`));
  const server = new SynapseServer(appDir, 0, db, config);

  await server.discoverSlices();
  await server.start();

  return server;
}

describe('process-level body ceiling', () => {
  it('refuses an oversized body through the running server and still serves a small one', async () => {
    const server = await bootServer({ maxRequestBodyBytes: 2048 });

    try {
      const rpc = `http://localhost:${server.port}/_synapse/rpc/demo/ping`;

      const oversized = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 1, pad: 'x'.repeat(8192) })
      });

      expect(oversized.status).toBe(413);

      const allowed = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 7 })
      });

      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ ok: true, value: { id: 'p-7' } });
    } finally {
      await server.stop();
    }
  });
});

describe('multipart upload ceiling', () => {
  it('refuses a chunked over-limit upload mid-stream without buffering it whole', async () => {
    const server = await bootServer();

    try {
      const limit = 4096;
      const totalChunks = 64;
      let sentChunks = 0;
      let cancelled = false;
      const chunk = new Uint8Array(1024).fill(65); // "A"
      const boundary = '----synapseAbuseBoundary';
      const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="grande.txt"\r\nContent-Type: text/plain\r\n\r\n`;

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(prefix));
        },
        pull(controller) {
          if (sentChunks >= totalChunks) {
            controller.close();
            return;
          }

          sentChunks++;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        }
      });

      const request = new Request(`http://localhost:${server.port}/_synapse/files/demo/ping`, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'x-user-id': 'abuse-tester'
        },
        body
      });

      const previousLimit = process.env.SYNAPSE_MAX_UPLOAD_BYTES;
      process.env.SYNAPSE_MAX_UPLOAD_BYTES = String(limit);

      try {
        const response = await fetch(request);

        expect(response.status).toBe(413);
        expect(((await response.json()) as { error: string }).error).toBe('TOO_LARGE');
      } finally {
        if (previousLimit === undefined) {
          delete process.env.SYNAPSE_MAX_UPLOAD_BYTES;
        } else {
          process.env.SYNAPSE_MAX_UPLOAD_BYTES = previousLimit;
        }
      }

      // The transfer was aborted at the ceiling instead of being read to the end.
      expect(sentChunks).toBeLessThan(totalChunks);
      expect(cancelled).toBe(true);

      const uploadDir = path.join(appDir, '.synapse', 'uploads', 'demo');
      const stored = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];
      expect(stored).toEqual([]);
    } finally {
      await server.stop();
    }
  });
});

describe('rate limiting every accepting surface', () => {
  it('answers 429 with the four RFC 6585 headers on the machine endpoints and the rendered page', async () => {
    const server = await bootServer();

    server.rateLimitEngine.reset();
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the limiter to tighten it for the test
    (server.rateLimitEngine as any).capacity = 1;
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the limiter to tighten it for the test
    (server.rateLimitEngine as any).refillRate = 0.001;

    try {
      const base = `http://localhost:${server.port}`;
      const targets = [
        '/_synapse/api/health',
        '/_synapse/api/metrics',
        '/_synapse/api/repo-map',
        '/_synapse/images/optimize?url=/hello.txt',
        '/demo/ping'
      ];

      for (const target of targets) {
        await fetch(`${base}${target}`);
        const refused = await fetch(`${base}${target}`);

        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).not.toBeNull();
        expect(refused.headers.get('x-ratelimit-limit')).not.toBeNull();
        expect(refused.headers.get('x-ratelimit-remaining')).toBe('0');
        expect(refused.headers.get('x-ratelimit-reset')).not.toBeNull();
        expect(((await refused.json()) as { error: string }).error).toBe('RATE_LIMIT_EXCEEDED');
      }
    } finally {
      await server.stop();
    }
  });
});

describe('remote-image endpoint', () => {
  it('refuses an anonymous caller', async () => {
    const server = await bootServer();

    try {
      const response = await fetch(`http://localhost:${server.port}/_synapse/images/optimize?url=/hello.txt&w=10`);

      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe('UNAUTHORIZED');
    } finally {
      await server.stop();
    }
  });

  it('refuses a host outside the configured allowlist', async () => {
    const server = await bootServer({ imageOptimizer: { allowedDomains: ['cdn.example.com'] } });

    try {
      const response = await fetch(
        `http://localhost:${server.port}/_synapse/images/optimize?url=https://evil.example.org/tracker.png`,
        { headers: { 'x-user-id': 'image-tester' } }
      );

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('DOMAIN_NOT_ALLOWED');
    } finally {
      await server.stop();
    }
  });

  it('always refuses the cloud metadata address, allowlist or not', async () => {
    const server = await bootServer();

    try {
      const response = await fetch(
        `http://localhost:${server.port}/_synapse/images/optimize?url=http://169.254.169.254/latest/meta-data/`,
        { headers: { 'x-user-id': 'image-tester' } }
      );

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('FORBIDDEN_TARGET_IP');
    } finally {
      await server.stop();
    }
  });
});

describe('outbound fetch pinning', () => {
  it('connects to the validated address while keeping the original host header', async () => {
    const seen: { host: string | null } = { host: null };
    const upstream = Bun.serve({
      port: 0,
      async fetch(req) {
        seen.host = req.headers.get('host');
        return new Response('image-bytes');
      }
    });

    try {
      const result = await fetchPinnedExternal(`http://rebind.test:${upstream.port}/asset.png`, '127.0.0.1', {
        maxBytes: 1024,
        timeoutMs: 2000
      });

      expect(result.ok).toBe(true);
      expect(new TextDecoder().decode(result.body)).toBe('image-bytes');
      // The connection went to the pinned address; the Host header is the original one.
      expect(seen.host).toBe(`rebind.test:${upstream.port}`);
    } finally {
      upstream.stop(true);
    }
  });

  it('refuses an upstream body larger than the ceiling', async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch() {
        return new Response(new Uint8Array(64 * 1024));
      }
    });

    try {
      const result = await fetchPinnedExternal(`http://rebind.test:${upstream.port}/big.png`, '127.0.0.1', {
        maxBytes: 1024,
        timeoutMs: 2000
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('UPSTREAM_RESPONSE_TOO_LARGE');
      expect(result.status).toBe(413);
    } finally {
      upstream.stop(true);
    }
  });

  it('cuts off a slow upstream at the timeout', async () => {
    const upstream = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return new Response('late');
      }
    });

    try {
      const result = await fetchPinnedExternal(`http://rebind.test:${upstream.port}/slow.png`, '127.0.0.1', {
        maxBytes: 1024,
        timeoutMs: 50
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('UPSTREAM_TIMEOUT');
      expect(result.status).toBe(504);
    } finally {
      upstream.stop(true);
    }
  });
});

describe('linear-time leak and DDL patterns', () => {
  it('completes every server-only pattern within a bound on a large synthetic input', () => {
    const hostile = `${'const leak = "SELECT a, b, c";\n'.repeat(4000)}${'CREATE TABLE t (a TEXT);\n'.repeat(4000)}`;
    const hostileDdl = `CREATE TABLE big (${'column_name TEXT NOT NULL, '.repeat(6000)}tail TEXT);`;
    const startedDdl = performance.now();
    const parsed = parseDdlToCatalog(hostileDdl);
    const ddlElapsed = performance.now() - startedDdl;

    for (const { label, pattern } of SERVER_ONLY_PATTERNS) {
      const started = performance.now();
      pattern.test(hostile);
      const elapsed = performance.now() - started;

      expect({ label, elapsed: elapsed < 250 }).toEqual({ label, elapsed: true });
    }

    expect(ddlElapsed).toBeLessThan(250);
    expect(parsed.length).toBe(1);
    expect(parsed[0].columns.length).toBe(6001);
  });
});
