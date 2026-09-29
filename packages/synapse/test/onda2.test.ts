import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { parseBidirectionalDdl, rollbackSliceMigrations, runSliceMigrations } from '../src/compiler/migration-runner';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { TokenBucketRateLimiter } from '../src/runtime/rate-limiter';
import { SynapseServer } from '../src/runtime/server';
import { saveUpload } from '../src/runtime/uploads';

const tempAppDir = path.join(import.meta.dir, 'fixtures', 'onda2-test-app');

describe('Onda 2: Database Resilience, Rollback, Rate Limiting & Network Defense', () => {
  let db: SqliteDatabaseClient;
  const dbFile = path.join(tempAppDir, '.synapse', 'test.sqlite');

  beforeAll(() => {
    fs.mkdirSync(path.join(tempAppDir, 'src', 'slices', 'billing'), { recursive: true });
    fs.mkdirSync(path.join(tempAppDir, 'src', 'slices', 'support'), { recursive: true });
    fs.mkdirSync(path.join(tempAppDir, '.synapse'), { recursive: true });

    db = new SqliteDatabaseClient(dbFile);

    // Billing slice with bidirectional DDL
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'billing', 'invoices.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';

export const InvoicesInputSchema = Type.Object({ amount: Type.Number() });

export const sliceSchema = \`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL
  );

  -- down:
  DROP TABLE IF EXISTS invoices;
\`;

export async function invoicesAction(payload: any): Promise<Result<{ id: string }, 'ERR'>> {
  return Ok({ id: 'inv-123' });
}

export function InvoicesView() {
  return <div>Faturas</div>;
}
`,
      'utf-8'
    );

    // Support slice WITHOUT down migration
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'support', 'faq.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';

export const FaqInputSchema = Type.Object({});
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS faq_items (id TEXT PRIMARY KEY, question TEXT);';

export async function faqAction(payload: any): Promise<Result<{ ok: boolean }, 'ERR'>> {
  return Ok({ ok: true });
}

export function FaqView() {
  return <div>FAQ</div>;
}
`,
      'utf-8'
    );
  });

  afterAll(async () => {
    await db.close?.();
    fs.rmSync(tempAppDir, { recursive: true, force: true });
  });

  describe('2.1 Bidirectional DDL Parser (parseBidirectionalDdl)', () => {
    it('parses UP and DOWN sections correctly', () => {
      const rawDdl = `
        CREATE TABLE users (id TEXT PRIMARY KEY);
        ALTER TABLE users ADD COLUMN email TEXT;

        -- down:
        ALTER TABLE users DROP COLUMN email;
        DROP TABLE users;
      `;

      const { upDdl, downDdl } = parseBidirectionalDdl(rawDdl);
      expect(upDdl).toContain('CREATE TABLE users');
      expect(upDdl).toContain('ALTER TABLE users ADD COLUMN email TEXT;');
      expect(upDdl).not.toContain('DROP TABLE');

      expect(downDdl).not.toBeNull();
      expect(downDdl).toContain('ALTER TABLE users DROP COLUMN email;');
      expect(downDdl).toContain('DROP TABLE users;');
    });

    it('returns null downDdl when no -- down: marker exists', () => {
      const rawDdl = 'CREATE TABLE logs (id TEXT PRIMARY KEY);';
      const { upDdl, downDdl } = parseBidirectionalDdl(rawDdl);
      expect(upDdl).toBe('CREATE TABLE logs (id TEXT PRIMARY KEY);');
      expect(downDdl).toBeNull();
    });

    it('handles variations like --down: and whitespace', () => {
      const rawDdl = `CREATE TABLE items (id TEXT);\n--   down\nDROP TABLE items;`;
      const { upDdl, downDdl } = parseBidirectionalDdl(rawDdl);
      expect(upDdl).toBe('CREATE TABLE items (id TEXT);');
      expect(downDdl).toBe('DROP TABLE items;');
    });
  });

  describe('2.2 Forward Migrations & Rollback Execution (rollbackSliceMigrations)', () => {
    it('applies forward migrations without executing down block', async () => {
      const report = await runSliceMigrations(tempAppDir, db);
      expect(report.status).toBe('PASS');
      expect(report.appliedCount).toBe(2);

      // Verify tables were created
      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('invoices', 'faq_items');"
      );
      const names = tables.map((t) => t.name);
      expect(names).toContain('invoices');
      expect(names).toContain('faq_items');

      // Verify down_ddl is saved in _synapse_migrations
      const migrationRecords = await db.query<{ slice_name: string; down_ddl: string | null }>(
        'SELECT slice_name, down_ddl FROM _synapse_migrations WHERE slice_name = $1;',
        ['invoices']
      );
      expect(migrationRecords.length).toBe(1);
      expect(migrationRecords[0].down_ddl).toContain('DROP TABLE IF EXISTS invoices;');
    });

    it('rolls back a slice with -- down: block and drops table', async () => {
      const rollback = await rollbackSliceMigrations(tempAppDir, db, { targetSlice: 'invoices' });
      expect(rollback.status).toBe('PASS');
      expect(rollback.totalRolledBack).toBe(1);
      expect(rollback.rollbacks[0].slice).toBe('invoices');
      expect(rollback.rollbacks[0].status).toBe('ROLLED_BACK');

      // Verify table was dropped
      const checkTable = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = 'invoices';");
      expect(checkTable.length).toBe(0);

      // Verify records removed from tracking tables
      const checkMigration = await db.query('SELECT slice_name FROM _synapse_migrations WHERE slice_name = $1;', [
        'invoices'
      ]);
      expect(checkMigration.length).toBe(0);

      const checkStatements = await db.query(
        'SELECT statement_hash FROM _synapse_migration_statements WHERE slice_name = $1;',
        ['invoices']
      );
      expect(checkStatements.length).toBe(0);
    });

    it('fails rollback gracefully when slice has no -- down: block', async () => {
      const rollback = await rollbackSliceMigrations(tempAppDir, db, { targetSlice: 'faq' });
      expect(rollback.status).toBe('FAIL');
      expect(rollback.rollbacks[0].status).toBe('FAILED');
      expect(rollback.rollbacks[0].error).toContain('-- down:');

      // Table should still exist
      const checkTable = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = 'faq_items';");
      expect(checkTable.length).toBe(1);
    });

    it('can re-apply a rolled back slice cleanly in next migrate', async () => {
      const report = await runSliceMigrations(tempAppDir, db);
      expect(report.status).toBe('PASS');
      expect(report.appliedCount).toBe(1); // Only invoices re-applied, faq is skipped

      const checkTable = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = 'invoices';");
      expect(checkTable.length).toBe(1);
    });
  });

  describe('2.3 Native Token Bucket Rate Limiter', () => {
    it('permits requests within capacity and tracks remaining tokens', () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 1 });

      const res1 = limiter.consume('client-a');
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);

      const res2 = limiter.consume('client-a');
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = limiter.consume('client-a');
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);

      // Fourth request exceeds burst limit
      const res4 = limiter.consume('client-a');
      expect(res4.allowed).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.resetMs).toBeGreaterThan(0);

      // Separate client has its own bucket
      const resOther = limiter.consume('client-b');
      expect(resOther.allowed).toBe(true);

      limiter.close();
    });

    it('refills tokens over time', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 20 }); // 20 tokens/sec = 1 token / 50ms

      limiter.consume('client-refill', 2);
      expect(limiter.consume('client-refill').allowed).toBe(false);

      // Wait 60ms for refill
      await new Promise((resolve) => setTimeout(resolve, 60));

      const refilled = limiter.consume('client-refill', 1);
      expect(refilled.allowed).toBe(true);

      limiter.close();
    });

    it('HTTP server enforces 429 Too Many Requests with RFC 6585 headers', async () => {
      const server = new SynapseServer(tempAppDir, 0, db);
      await server.discoverSlices();
      await server.start();

      // Configure a restrictive rate limit for this test
      const rateLimiter = server.rateLimitEngine;
      rateLimiter.reset();
      (rateLimiter as any).capacity = 5;
      (rateLimiter as any).refillRate = 0.001; // Avoid race condition under heavy CPU load

      try {
        const clientIpHeader = '198.51.100.42';

        // Drain bucket
        for (let i = 0; i < 5; i++) {
          rateLimiter.consume(clientIpHeader);
        }

        // The next HTTP request from this IP must trigger 429
        const res = await fetch(`http://localhost:${server.port}/_synapse/rpc/billing/invoices`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': clientIpHeader
          },
          body: JSON.stringify({ amount: 100 })
        });

        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).not.toBeNull();
        expect(res.headers.get('x-ratelimit-limit')).not.toBeNull();
        expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
        expect(res.headers.get('x-ratelimit-reset')).not.toBeNull();

        const json = await res.json();
        expect(json.error).toBe('RATE_LIMIT_EXCEEDED');
      } finally {
        await server.stop();
      }
    });
  });

  describe('2.4 Multipart Form-Data Upload with Size Validation', () => {
    it('accepts valid multipart/form-data upload', async () => {
      const formData = new FormData();
      const fileContent = new Blob(['relatorio-financeiro-2026.pdf content'], { type: 'application/pdf' });
      formData.append('file', fileContent, 'relatorio.pdf');

      const req = new Request('http://localhost:3000/_synapse/files/billing', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-test-token'
        },
        body: formData
      });

      const outcome = await saveUpload(req, {
        baseDir: tempAppDir,
        domain: 'billing',
        session: { isAuthenticated: true, userId: 'admin-1', roles: ['admin'], tenantId: 'tenant-1' }
      });

      expect(outcome.status).toBe(200);
      expect(outcome.body.ok).toBe(true);
      expect(typeof outcome.body.path).toBe('string');
      expect(outcome.body.path as string).toContain('.synapse/uploads/billing');
      expect(outcome.body.bytes).toBeGreaterThan(0);

      // Verify file exists on disk
      const filePath = path.join(tempAppDir, outcome.body.path as string);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('rejects multipart upload exceeding maxBytes with 413', async () => {
      const formData = new FormData();
      const largeContent = new Blob([new Uint8Array(1024 * 100)]); // 100KB
      formData.append('file', largeContent, 'large.bin');

      const req = new Request('http://localhost:3000/_synapse/files/billing', {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-test-token'
        },
        body: formData
      });

      const outcome = await saveUpload(req, {
        baseDir: tempAppDir,
        domain: 'billing',
        session: { isAuthenticated: true, userId: 'admin-1', roles: ['admin'] },
        maxBytes: 1024 * 10 // Max 10KB
      });

      expect(outcome.status).toBe(413);
      expect(outcome.body.error).toBe('TOO_LARGE');
    });

    it('rejects multipart request missing file field with 422', async () => {
      const formData = new FormData();
      formData.append('wrong_field', 'some text');

      const req = new Request('http://localhost:3000/_synapse/files/billing', {
        method: 'POST',
        body: formData
      });

      const outcome = await saveUpload(req, {
        baseDir: tempAppDir,
        domain: 'billing',
        session: { isAuthenticated: true, userId: 'admin-1', roles: ['admin'] }
      });

      expect(outcome.status).toBe(422);
      expect(outcome.body.error).toBe('NO_FILE_IN_FORM_DATA');
    });
  });
});
