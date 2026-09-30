import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnonymousSession,
  BoundedLruCache,
  createActionContext,
  normalizeCacheKey,
  type SliceCacheConfig,
  serializeCookie
} from '../src/core';
import { isPrivateOrReservedIp, validateExternalUrl } from '../src/runtime/network-guard';
import { QueueEngine } from '../src/runtime/queue-engine';
import { TokenBucketRateLimiter } from '../src/runtime/rate-limiter';
import { SynapseServer } from '../src/runtime/server';

describe('Production Hardening & Reliability (Wave 8)', () => {
  describe('1. SSRF & Network Guard', () => {
    it('detects private, loopback, and cloud metadata IPv4 addresses', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.0.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('10.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);

      // Public IPs
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
    });

    it('detects private, loopback, and unique-local IPv6 addresses', () => {
      expect(isPrivateOrReservedIp('::1')).toBe(true);
      expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
      expect(isPrivateOrReservedIp('fd12:3456:789a::1')).toBe(true);
      expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:192.168.1.1')).toBe(true);

      // Public IPv6
      expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    });

    it('rejects forbidden metadata hostnames and loopbacks via validateExternalUrl', async () => {
      const gcpMetadata = await validateExternalUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(gcpMetadata.ok).toBe(false);
      expect(gcpMetadata.error).toBe('FORBIDDEN_METADATA_HOST');

      const loopback = await validateExternalUrl('http://127.0.0.1:8080/secret');
      expect(loopback.ok).toBe(false);
      expect(loopback.error).toBe('LOOPBACK_FORBIDDEN');

      const awsMetadata = await validateExternalUrl('http://169.254.169.254/latest/meta-data/');
      expect(awsMetadata.ok).toBe(false);
      expect(awsMetadata.error).toBe('FORBIDDEN_TARGET_IP');

      const invalidProtocol = await validateExternalUrl('file:///etc/passwd');
      expect(invalidProtocol.ok).toBe(false);
      expect(invalidProtocol.error).toBe('INVALID_PROTOCOL');
    });

    it('enforces allowedDomains when specified', async () => {
      const allowed = ['cdn.example.com', 'images.unsplash.com'];

      const rejected = await validateExternalUrl('https://evil.com/img.png', { allowedDomains: allowed });
      expect(rejected.ok).toBe(false);
      expect(rejected.error).toBe('DOMAIN_NOT_ALLOWED');
    });
  });

  describe('2. Bounded LRU Cache & Cache Key Normalization', () => {
    it('evicts least recently used items when exceeding maxEntries', () => {
      const cache = new BoundedLruCache<string>(3);
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBe('1');

      // Inserting 'd' should evict 'b' since 'a' was recently accessed
      cache.set('d', '4');
      expect(cache.size).toBe(3);
      expect(cache.has('b')).toBe(false);
      expect(cache.get('a')).toBe('1');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });

    it('normalizes cache keys by stripping tracking parameters and sorting', () => {
      const url1 = new URL('https://example.com/tickets?utm_source=twitter&category=billing&v=123');
      const url2 = new URL('https://example.com/tickets?category=billing&utm_campaign=summer&fbclid=xyz');

      const key1 = normalizeCacheKey(url1);
      const key2 = normalizeCacheKey(url2);

      expect(key1).toBe('/tickets?category=billing');
      expect(key2).toBe('/tickets?category=billing');
      expect(key1).toBe(key2);
    });

    it('respects allowedParams in normalizeCacheKey', () => {
      const url = new URL('https://example.com/products?page=2&color=blue&sort=price&token=abc');
      const key = normalizeCacheKey(url, ['page', 'sort']);

      expect(key).toBe('/products?page=2&sort=price');
    });
  });

  describe('3. Rate Limiter Boundedness & Saturation', () => {
    it('keeps the registry bounded and never evicts a live counter to admit a new identity', () => {
      const limiter = new TokenBucketRateLimiter({
        maxBuckets: 5,
        capacity: 10,
        refillRate: 10
      });

      const real = limiter.consume('real-client');
      expect(real.allowed).toBe(true);

      for (let i = 1; i <= 20; i++) {
        limiter.consume(`synthetic_${i}`);
      }

      // Memory bound holds, and the real client still has its allowance.
      expect(limiter.activeKeysCount).toBeLessThanOrEqual(5);
      expect(limiter.consume('real-client').allowed).toBe(true);

      limiter.close();
    });

    it('does not forgive a client that is over its allowance when the registry saturates', () => {
      const limiter = new TokenBucketRateLimiter({
        maxBuckets: 3,
        capacity: 1,
        refillRate: 0.001
      });

      limiter.consume('abuser');
      expect(limiter.consume('abuser').allowed).toBe(false);

      for (let i = 0; i < 50; i++) {
        limiter.consume(`flood_${i}`);
      }

      const stillRefused = limiter.consume('abuser');
      expect(stillRefused.allowed).toBe(false);
      expect(limiter.activeKeysCount).toBeLessThanOrEqual(3);

      limiter.close();
    });
  });

  describe('4. SQLite Queue Engine Recovery & Visibility Timeout', () => {
    let queue: QueueEngine;
    const testDbPath = path.join(process.cwd(), '.synapse/test-hardening-queue.sqlite');

    beforeEach(() => {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      queue = new QueueEngine({ dbPath: testDbPath, visibilityTimeoutMs: 1000 });
    });

    afterEach(() => {
      queue.close();
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('recovers zombie jobs whose worker died and visibility timeout expired', async () => {
      const jobId = await queue.enqueue('process-invoice', { invoiceId: 'inv_123' });

      // First claim: sets status to 'running' with locked_at = now
      const claimed1 = queue.claimNextJob();
      expect(claimed1).not.toBeNull();
      expect(claimed1?.id).toBe(jobId);
      expect(claimed1?.status).toBe('running');

      // Immediate second claim should find nothing because job is currently locked
      const claimedImmediate = queue.claimNextJob();
      expect(claimedImmediate).toBeNull();

      // Simulate visibility timeout expiry (1000ms in past)
      queue.database.run('UPDATE _synapse_jobs SET locked_at = ? WHERE id = ?', [Date.now() - 2000, jobId]);

      // Third claim should successfully recover the zombie job!
      const recovered = queue.claimNextJob();
      expect(recovered).not.toBeNull();
      expect(recovered?.id).toBe(jobId);
      expect(recovered?.status).toBe('running');
    });
  });

  describe('5. Secure-by-default cookie serialization', () => {
    it('applies HttpOnly, Secure and SameSite=Lax without being asked', () => {
      // The assertion must not supply the attributes it is testing: a serializer that
      // only honours explicit flags is not secure by default.
      const cookieStr = serializeCookie('synapse_token', 'jwt_secret_token_123');

      expect(cookieStr).toContain('synapse_token=jwt_secret_token_123');
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toContain('Secure');
      expect(cookieStr).toContain('SameSite=Lax');
      expect(cookieStr).toContain('Path=/');
    });

    it('honours an explicit stricter policy and an explicit opt-out', () => {
      const strict = serializeCookie('synapse_token', 'v', { sameSite: 'strict', maxAge: 60 });

      expect(strict).toContain('SameSite=Strict');
      expect(strict).toContain('HttpOnly');
      expect(strict).toContain('Secure');
      expect(strict).toContain('Max-Age=60');

      const optedOut = serializeCookie('theme', 'dark', { httpOnly: false, secure: false });

      expect(optedOut).not.toContain('HttpOnly');
      expect(optedOut).not.toContain('Secure');
      expect(optedOut).toContain('SameSite=Lax');
    });

    it('records pending cookies in ActionContext and propagates them', () => {
      const mockDb: any = {
        query: async () => [],
        queryOne: async () => null,
        transaction: async (fn: any) => fn(mockDb)
      };

      const ctx = createActionContext({
        db: mockDb,
        session: AnonymousSession()
      });

      ctx.setCookie('synapse_token', 'token_val', { httpOnly: true, secure: true });

      expect(ctx._pendingCookies).toBeDefined();
      expect(ctx._pendingCookies?.length).toBe(1);
      expect(ctx._pendingCookies?.[0]).toEqual({
        name: 'synapse_token',
        value: 'token_val',
        options: { httpOnly: true, secure: true }
      });
    });
  });

  describe('6. SynapseServer Production Hardening Integration', () => {
    const testAppDir = path.join(process.cwd(), 'examples/enterprise-crm');
    let server: SynapseServer;

    beforeEach(async () => {
      server = new SynapseServer(testAppDir, 0, undefined, {
        maxRpcPayloadBytes: 1024 * 1024, // 1 MB for testing
        maxWebhookPayloadBytes: 2 * 1024 * 1024
      });
      await server.discoverSlices();
      await server.start();
    });

    afterEach(async () => {
      await server.stop(50);
    });

    it('blocks SSRF attempts in Image Optimizer with 403', async () => {
      const port = server.port;
      const res = await fetch(
        `http://localhost:${port}/_synapse/images/optimize?url=http://169.254.169.254/latest/meta-data`,
        { headers: { 'x-user-id': 'image-auditor' } }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('FORBIDDEN_TARGET_IP');
    });

    it('blocks local path traversal in Image Optimizer with 403', async () => {
      const port = server.port;
      const res = await fetch(`http://localhost:${port}/_synapse/images/optimize?url=../../package.json`, {
        headers: { 'x-user-id': 'image-auditor' }
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('FORBIDDEN_FILE_PATH');
    });

    it('returns 413 Payload Too Large when RPC payload exceeds limit', async () => {
      const port = server.port;
      const largeContent = 'a'.repeat(2 * 1024 * 1024); // 2 MB > 1 MB limit

      const res = await fetch(`http://localhost:${port}/_synapse/rpc/create-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(largeContent.length + 50)
        },
        body: JSON.stringify({ name: largeContent, email: 'large@example.com' })
      });

      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('returns 400 Bad Request on malformed JSON in RPC', async () => {
      const port = server.port;

      const res = await fetch(`http://localhost:${port}/_synapse/rpc/create-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: '{ "invalid json payload: '
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('INVALID_JSON_PAYLOAD');
    });

    it('returns HTTP 500 with X-Robots-Tag noindex and suppresses client bundle on SSR loader failure', async () => {
      server.registerSlice({
        key: 'testing/failing-loader',
        domain: 'testing',
        name: 'failing-loader',
        routePath: '/testing/failing-loader',
        rpcPath: '/_synapse/rpc/testing/failing-loader',
        webhookPath: '/_synapse/webhooks/testing/failing-loader',
        wsPath: '/_synapse/ws/testing/failing-loader',
        filePath: 'test.slice.tsx',
        loaderFn: async () => {
          throw new Error('Database connection broke during loader');
        },
        componentFn: () => null
      });

      const port = server.port;
      const res = await fetch(`http://localhost:${port}/testing/failing-loader`);
      expect(res.status).toBe(500);
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      const html = await res.text();
      expect(html).toContain('Falha no loader');
      expect(html).toContain('Database connection broke during loader');
      // Client hydration script should be suppressed to avoid hydration mismatches
      expect(html).not.toContain('data-synapse-client');
      expect(html).toContain('<!-- sem componente hidratavel -->');
    });

    it('propagates Set-Cookie headers in RPC responses when action calls ctx.setCookie', async () => {
      server.registerSlice({
        key: 'testing/cookie-setter',
        domain: 'testing',
        name: 'cookie-setter',
        routePath: '/testing/cookie-setter',
        rpcPath: '/_synapse/rpc/testing/cookie-setter',
        webhookPath: '/_synapse/webhooks/testing/cookie-setter',
        wsPath: '/_synapse/ws/testing/cookie-setter',
        filePath: 'test.slice.tsx',
        actionFn: async (_payload: any, ctx: any) => {
          ctx.setCookie('synapse_session', 'super_secret_jwt', {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 7200
          });
          return { ok: true, value: { success: true } };
        }
      });

      const port = server.port;
      const res = await fetch(`http://localhost:${port}/_synapse/rpc/cookie-setter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain('synapse_session=super_secret_jwt');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Max-Age=7200');
    });

    it('hardens the documented no-option call: the wire cookie carries the defaults', async () => {
      server.registerSlice({
        key: 'testing/cookie-defaults',
        domain: 'testing',
        name: 'cookie-defaults',
        routePath: '/testing/cookie-defaults',
        rpcPath: '/_synapse/rpc/testing/cookie-defaults',
        webhookPath: '/_synapse/webhooks/testing/cookie-defaults',
        wsPath: '/_synapse/ws/testing/cookie-defaults',
        filePath: 'test.slice.tsx',
        actionFn: async (_payload: any, ctx: any) => {
          ctx.setCookie('synapse_session', 'sem_opcoes');
          return { ok: true, value: { success: true } };
        }
      });

      const res = await fetch(`http://localhost:${server.port}/_synapse/rpc/cookie-defaults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('synapse_session=sem_opcoes');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
    });
  });
});
