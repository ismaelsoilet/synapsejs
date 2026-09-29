import { describe, expect, test } from 'bun:test';
import { expandNestedObject, getNestedProperty, setNestedProperty } from '../src/client/components';
import { parseBidirectionalDdl, splitStatements } from '../src/compiler/migration-runner';
import { verifySplit } from '../src/compiler/slice-splitter';
import {
  compileDelete,
  compileSelect,
  compileUpdate,
  createSession,
  requireTenant,
  SqliteDatabaseClient,
  serializeCookie
} from '../src/core';
import { EventHub } from '../src/runtime/event-hub';
import { QueueEngine } from '../src/runtime/queue-engine';
import { readBodyWithinLimit } from '../src/runtime/uploads';

describe('SureForge Adversarial Hardening Suite', () => {
  // CRIT-01: Prototype Pollution Protection
  test('CRIT-01: client components neutralize prototype pollution attempts', () => {
    const target: Record<string, unknown> = {};

    setNestedProperty(target, '__proto__.polluted', 'malicious');
    setNestedProperty(target, 'constructor.prototype.pwned', 'malicious');
    setNestedProperty(target, 'user.__proto__.admin', true);

    expect((target as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((Object.prototype as any).pwned).toBeUndefined();
    expect((Object.prototype as any).admin).toBeUndefined();

    const retrievedProto = getNestedProperty(target, '__proto__.polluted');
    expect(retrievedProto).toBeUndefined();

    const expanded = expandNestedObject({
      '__proto__.polluted': 'yes',
      'constructor.prototype.admin': 'yes',
      'user.name': 'Alice'
    });
    expect((expanded as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((expanded as any).user?.name).toBe('Alice');
  });

  // CRIT-02 & BUG-01: SQL Injection via Operator & Query Builder Security
  test('CRIT-02: query builder sanitizes operators against injection', () => {
    // Malicious operator injection attempt
    const maliciousWhere = {
      status: {
        op: "eq' OR 1=1 --",
        val: 'active'
      }
    };

    // Injected operator must be strictly rejected by sanitizeOperator
    expect(() => compileSelect('users', { where: maliciousWhere })).toThrow('Invalid SQL operator');

    // Complex operator IN in update/delete
    const updateResult = compileUpdate(
      'users',
      { status: 'archived' },
      {
        id: { op: 'in', val: ['1', '2', '3'] }
      }
    );
    expect(updateResult.sql).toContain('id IN ($2, $3, $4)');

    const deleteResult = compileDelete('users', {
      age: { op: 'between', val: [18, 65] }
    });
    expect(deleteResult.sql).toContain('age BETWEEN $1 AND $2');
  });

  // CRIT-03: requireTenant IDOR Barrier
  test('CRIT-03: requireTenant blocks authenticated sessions without matching tenant', () => {
    const sessionWithoutTenant = createSession({
      userId: 'user_attacker',
      roles: ['user']
    });

    const check = requireTenant(sessionWithoutTenant, 'tenant_acme');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toBe('FORBIDDEN');
    }

    const sessionWithMismatchTenant = createSession({
      userId: 'user_other',
      tenantId: 'tenant_other',
      roles: ['user']
    });

    const checkMismatch = requireTenant(sessionWithMismatchTenant, 'tenant_acme');
    expect(checkMismatch.ok).toBe(false);
    if (!checkMismatch.ok) {
      expect(checkMismatch.error).toBe('FORBIDDEN');
    }

    const sessionValid = createSession({
      userId: 'user_valid',
      tenantId: 'tenant_acme',
      roles: ['user']
    });

    const checkValid = requireTenant(sessionValid, 'tenant_acme');
    expect(checkValid.ok).toBe(true);
  });

  // CRIT-05: Reentrant SQLite Transactions with SAVEPOINT
  test('CRIT-05: SQLite client supports reentrant nested transactions without deadlock', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    await db.query('CREATE TABLE accounts (id TEXT PRIMARY KEY, balance INTEGER);');
    await db.query("INSERT INTO accounts VALUES ('acc-1', 100);");

    // Outer transaction containing an inner nested transaction
    await db.transaction(async (outerTx) => {
      await outerTx.query("UPDATE accounts SET balance = balance + 50 WHERE id = 'acc-1';");

      await outerTx.transaction(async (innerTx) => {
        await innerTx.query("UPDATE accounts SET balance = balance + 25 WHERE id = 'acc-1';");
      });
    });

    const rows = await db.query<{ balance: number }>("SELECT balance FROM accounts WHERE id = 'acc-1';");
    expect(rows[0].balance).toBe(175);

    // Test rollback inside nested savepoint
    try {
      await db.transaction(async (outerTx) => {
        await outerTx.query("UPDATE accounts SET balance = balance + 10 WHERE id = 'acc-1';");

        await outerTx.transaction(async (innerTx) => {
          await innerTx.query("UPDATE accounts SET balance = balance + 1000 WHERE id = 'acc-1';");
          throw new Error('Inner failure');
        });
      });
    } catch (err: any) {
      expect(err.message).toBe('Inner failure');
    }

    // Outer balance must remain rolled back from the failed transaction
    const finalRows = await db.query<{ balance: number }>("SELECT balance FROM accounts WHERE id = 'acc-1';");
    expect(finalRows[0].balance).toBe(175);

    db.close();
  });

  // CRIT-06: Queue Poison Pill Prevention
  test('CRIT-06: SQLite QueueEngine increments attempts atomically on claim', async () => {
    const queue = new QueueEngine({ dbPath: ':memory:', visibilityTimeoutSeconds: 0.1 });
    const db = (queue as any).database;

    db.run(`
      INSERT INTO _synapse_jobs (
        id, name, payload, status, priority, attempts, max_attempts, backoff_seconds, run_at, created_at, updated_at
      ) VALUES ('job_poison', 'test_poison', '{}', 'pending', 0, 0, 2, 1, 0, 0, 0)
    `);

    // First claim: attempts should be immediately updated to 1
    const claimed1 = queue.claimNextJob();
    expect(claimed1).not.toBeNull();
    expect(claimed1?.attempts).toBe(1);

    const inDb1 = db.query("SELECT attempts, status FROM _synapse_jobs WHERE id = 'job_poison'").get() as any;
    expect(inDb1.attempts).toBe(1);
    expect(inDb1.status).toBe('running');

    // Simulate worker crash: wait for visibility timeout to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Second claim: recovered from stale running, attempts incremented to 2
    const claimed2 = queue.claimNextJob();
    expect(claimed2).not.toBeNull();
    expect(claimed2?.attempts).toBe(2);

    const inDb2 = db.query("SELECT attempts, status FROM _synapse_jobs WHERE id = 'job_poison'").get() as any;
    expect(inDb2.attempts).toBe(2);

    // Wait for visibility timeout to expire again
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Third claim: attempts reached max_attempts (2). Must NOT be claimed, must be marked 'failed'
    const claimed3 = queue.claimNextJob();
    expect(claimed3).toBeNull();

    const inDb3 = db.query("SELECT status, last_error FROM _synapse_jobs WHERE id = 'job_poison'").get() as any;
    expect(inDb3.status).toBe('failed');
    expect(inDb3.last_error).toContain('Visibility timeout exceeded');

    queue.close();
  });

  // CRIT-07: EventHub Async Error Catching
  test('CRIT-07: EventHub handles async listener rejection gracefully without crashing', async () => {
    const hub = new EventHub();
    let handledSync = false;

    hub.subscribe('events', async () => {
      throw new Error('Async explosion in listener');
    });

    hub.subscribe('events', () => {
      handledSync = true;
    });

    const count = hub.publish('events', { foo: 'bar' });
    expect(count).toBe(2);
    expect(handledSync).toBe(true);
  });

  // HIGH-03: DDL Parser Resilience
  test('HIGH-03: parseBidirectionalDdl and splitStatements resist tricky strings and triggers', () => {
    const ddlWithDownInString = `
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        template TEXT DEFAULT 'Hello!
-- down:
You have an update.'
      );
      -- down:
      DROP TABLE notifications;
    `;

    const parsed = parseBidirectionalDdl(ddlWithDownInString);
    expect(parsed.upDdl).toContain('CREATE TABLE notifications');
    expect(parsed.upDdl).toContain('-- down:\nYou have an update.');
    expect(parsed.downDdl).toBe('DROP TABLE notifications;');

    // Trigger with compound BEGIN ... END;
    const triggerDdl = `
      CREATE TRIGGER update_timestamp AFTER UPDATE ON users
      BEGIN
        UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
      CREATE INDEX idx_users_email ON users(email);
    `;

    const stmts = splitStatements(triggerDdl);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain(
      "BEGIN\n        UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;\n      END"
    );
    expect(stmts[1]).toBe('CREATE INDEX idx_users_email ON users(email)');
  });

  // HIGH-06: Streaming Upload Guard (readBodyWithinLimit)
  test('HIGH-06: readBodyWithinLimit cancels stream when exceeding limit', async () => {
    const chunk1 = new Uint8Array(500).fill(65);
    const chunk2 = new Uint8Array(600).fill(66);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      }
    });

    const result = await readBodyWithinLimit(stream, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('TOO_LARGE');
    }
  });

  // HIGH-11: Cookie CRLF Sanitization
  test('HIGH-11: serializeCookie strips control characters and semicolons from domain and path', () => {
    const maliciousCookie = serializeCookie('session_id', 'valid_token_123', {
      domain: 'example.com\r\nInjected-Header: evil\r\nSet-Cookie: rogue=1',
      path: '/api;\r\nX-Pwned: true'
    });

    expect(maliciousCookie).not.toContain('\r');
    expect(maliciousCookie).not.toContain('\n');
    expect(maliciousCookie).not.toContain('Injected-Header');
    expect(maliciousCookie).not.toContain('X-Pwned');
  });

  // HIGH-02: Splitter AST Unicode Normalization
  test('HIGH-02: verifySplit detects unicode-escaped server leaks in client artifacts', () => {
    const virtualArtifacts = {
      artifacts: [
        {
          kind: 'client' as const,
          fileName: 'client.tsx',
          // \u0070rocess.env is 'process.env'
          code: 'export function View() { const secret = \\u0070rocess.env.SECRET; return <div>{secret}</div>; }'
        }
      ]
    };

    const verification = verifySplit(virtualArtifacts as any, '/tmp');
    expect(verification.status).toBe('FAIL');
    expect(verification.leaks).toContain('process.env access');
  });
});
