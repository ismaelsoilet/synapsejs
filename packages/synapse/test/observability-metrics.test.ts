import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { formatLogLine, SynapseServer } from '../src/runtime/server';

const appDir = path.resolve(import.meta.dir, 'fixtures', 'runtime-app');

describe('Observability: Structured Logging (Fase 5)', () => {
  it('formats log lines with optional user identity and roles', () => {
    const lineAnon = formatLogLine({ method: 'GET', path: '/x', status: 200, ms: 5 });
    const parsedAnon = JSON.parse(lineAnon);
    expect(parsedAnon.method).toBe('GET');
    expect(parsedAnon.path).toBe('/x');
    expect(parsedAnon.status).toBe(200);
    expect(parsedAnon.ms).toBe(5);
    expect(typeof parsedAnon.ts).toBe('string');
    expect(parsedAnon.userId).toBeUndefined();

    const lineAuth = formatLogLine({
      method: 'POST',
      path: '/_synapse/rpc/tickets/create',
      status: 200,
      ms: 12,
      userId: 'usr_123',
      roles: ['admin', 'support']
    });
    const parsedAuth = JSON.parse(lineAuth);
    expect(parsedAuth.userId).toBe('usr_123');
    expect(parsedAuth.roles).toEqual(['admin', 'support']);
  });
});

describe('Observability: Server Metrics Endpoint (Fase 5)', () => {
  it('exposes JSON metrics at /_synapse/api/metrics and increments counters on requests', async () => {
    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const base = `http://localhost:${srv.port}`;

    try {
      // 1. Initial metrics call
      const res1 = await fetch(`${base}/_synapse/api/metrics`);
      expect(res1.status).toBe(200);
      const m1 = (await res1.json()) as {
        uptimeSeconds: number;
        totalRequests: number;
        statusCodes: Record<string, number>;
        rpcSuccessCount: number;
        rpcErrorCount: number;
        ssrRenderCount: number;
      };

      expect(typeof m1.uptimeSeconds).toBe('number');
      expect(m1.totalRequests).toBeGreaterThanOrEqual(1);

      // 2. Make an SSR render request
      const resSsr = await fetch(`${base}/tickets/view-tickets`);
      expect(resSsr.status).toBe(200);

      // 3. Make an RPC request
      const resRpc = await fetch(`${base}/_synapse/rpc/tickets/view-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(resRpc.status).toBe(200);

      // 4. Check metrics updated
      const res2 = await fetch(`${base}/_synapse/api/metrics`);
      const m2 = (await res2.json()) as {
        totalRequests: number;
        rpcSuccessCount: number;
        ssrRenderCount: number;
      };

      expect(m2.totalRequests).toBeGreaterThan(m1.totalRequests);
      expect(m2.ssrRenderCount).toBeGreaterThanOrEqual(1);
      expect(m2.rpcSuccessCount).toBeGreaterThanOrEqual(1);
    } finally {
      await synapse.stop();
    }
  });

  it('exposes Prometheus text format when requested via format=prometheus or Accept: text/plain', async () => {
    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const base = `http://localhost:${srv.port}`;

    try {
      // Via query param
      const resQuery = await fetch(`${base}/_synapse/api/metrics?format=prometheus`);
      expect(resQuery.status).toBe(200);
      expect(resQuery.headers.get('content-type')).toContain('text/plain');
      const textQuery = await resQuery.text();
      expect(textQuery).toContain('# HELP synapse_requests_total');
      expect(textQuery).toContain('synapse_requests_total');
      expect(textQuery).toContain('# HELP synapse_uptime_seconds');

      // Via Accept header
      const resHeader = await fetch(`${base}/_synapse/api/metrics`, {
        headers: { Accept: 'text/plain' }
      });
      expect(resHeader.status).toBe(200);
      const textHeader = await resHeader.text();
      expect(textHeader).toContain('synapse_requests_total');
    } finally {
      await synapse.stop();
    }
  });
});

describe('Static CSS & CDN Air-Gap Hardening (Fase 4)', () => {
  it('suppresses Tailwind CDN and Google Fonts when SYNAPSE_DISABLE_CDN is set', async () => {
    process.env.SYNAPSE_DISABLE_CDN = 'true';

    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const base = `http://localhost:${srv.port}`;

    try {
      const hubRes = await fetch(`${base}/`);
      const hubHtml = await hubRes.text();
      expect(hubHtml).not.toContain('cdn.tailwindcss.com');
      expect(hubHtml).not.toContain('fonts.googleapis.com');

      const sliceRes = await fetch(`${base}/tickets/view-tickets`);
      const sliceHtml = await sliceRes.text();
      expect(sliceHtml).not.toContain('cdn.tailwindcss.com');
      expect(sliceHtml).not.toContain('fonts.googleapis.com');
    } finally {
      delete process.env.SYNAPSE_DISABLE_CDN;
      await synapse.stop();
    }
  });

  it('injects /synapse.css when public/synapse.css exists on disk', async () => {
    const publicDir = path.join(appDir, 'public');
    const cssPath = path.join(publicDir, 'synapse.css');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(cssPath, '/* custom synapse css */');

    const synapse = new SynapseServer(appDir, 0);
    await synapse.discoverSlices();
    const srv = (await synapse.start()) as unknown as { port: number };
    const base = `http://localhost:${srv.port}`;

    try {
      const hubRes = await fetch(`${base}/`);
      const hubHtml = await hubRes.text();
      expect(hubHtml).toContain('<link rel="stylesheet" href="/synapse.css">');

      const sliceRes = await fetch(`${base}/tickets/view-tickets`);
      const sliceHtml = await sliceRes.text();
      expect(sliceHtml).toContain('<link rel="stylesheet" href="/synapse.css">');
    } finally {
      if (fs.existsSync(cssPath)) {
        fs.unlinkSync(cssPath);
      }
      await synapse.stop();
    }
  });
});
