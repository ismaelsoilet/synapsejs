/**
 * PostgreSQL parity check.
 *
 * Verifies the pieces the framework owns against a real PostgreSQL server:
 * the migration runner's tracking table, a slice's DDL, migration idempotency
 * and one server action round-trip.
 *
 * Runs against TEST_DATABASE_URL, connects with PostgresDatabaseClient directly
 * (never getDatabase, whose fallback could silently hand back SQLite) and asserts
 * the server really is PostgreSQL. Missing configuration is FAIL, not a skip.
 *
 * Usage: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db bun run test:postgres
 */

import * as path from 'path';
import { createTicketAction } from '../../../examples/helpdesk-slices/src/slices/tickets/create-ticket.slice.tsx';
import { runSliceMigrations } from '../src/compiler/migration-runner';
import { PostgresDatabaseClient } from '../src/core/postgres-client';
import { createSession } from '../src/core/session-context';

function emit(payload: Record<string, unknown>, ok: boolean): never {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  emit(
    {
      status: 'FAIL',
      operation: 'POSTGRES_PARITY',
      code: 'MISSING_TEST_DATABASE_URL',
      message: 'Defina TEST_DATABASE_URL=postgres://... para verificar a paridade.'
    },
    false
  );
}

const appDir = path.resolve(import.meta.dir, '..', '..', '..', 'examples', 'helpdesk-slices');
const db = new PostgresDatabaseClient(url as string);

try {
  const version = await db.query<{ version: string }>(`SELECT version() AS version`);
  if (!version[0]?.version.toLowerCase().includes('postgresql')) {
    emit(
      {
        status: 'FAIL',
        operation: 'POSTGRES_PARITY',
        code: 'WRONG_ENGINE',
        message: 'A conexão não respondeu como PostgreSQL.',
        version: version[0]?.version ?? null
      },
      false
    );
  }

  await db.query(`DROP TABLE IF EXISTS tickets`);
  await db.query(`DROP TABLE IF EXISTS _synapse_migrations`);

  const first = await runSliceMigrations(appDir, db);
  const second = await runSliceMigrations(appDir, db);

  const created = await createTicketAction(
    { subject: 'Impressora sem papel', priority: 3, requesterEmail: 'a@b.com' },
    db,
    createSession({ userId: 'pg-verifier', roles: ['support'] })
  );

  const rows = await db.query<{ id: string; status: string }>(`SELECT id, status FROM tickets`);
  const idempotent = await createTicketAction(
    { subject: 'Segundo chamado', priority: 1, requesterEmail: 'c@d.com' },
    db,
    createSession({ userId: 'pg-verifier', roles: ['support'] })
  );

  const checks = {
    migrationsFirstRunApplied: first.status === 'PASS' && first.appliedCount === 1,
    migrationsSecondRunSkipped: second.status === 'PASS' && second.skippedCount === 1,
    actionReturnedOk: created.ok === true,
    rowPersisted: rows.length === 1 && rows[0]?.status === 'OPEN',
    secondActionAlsoOk: idempotent.ok === true
  };

  const passed = Object.values(checks).every(Boolean);

  emit(
    {
      status: passed ? 'PASS' : 'FAIL',
      operation: 'POSTGRES_PARITY',
      target: 'examples/helpdesk-slices',
      checks,
      migrations: {
        first: { status: first.status, applied: first.appliedCount },
        second: { status: second.status, skipped: second.skippedCount }
      }
    },
    passed
  );
} catch (error) {
  emit(
    {
      status: 'FAIL',
      operation: 'POSTGRES_PARITY',
      code: 'PARITY_ERROR',
      message: error instanceof Error ? error.message : String(error)
    },
    false
  );
} finally {
  await db.close();
}
