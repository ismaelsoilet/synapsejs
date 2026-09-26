import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSliceMigrations } from '../src/compiler/migration-runner';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';

let sandbox: string;
let db: SqliteDatabaseClient;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-migrations-'));
  db = new SqliteDatabaseClient(':memory:');
});

afterEach(() => {
  db.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeSlice(appDir: string, name: string, ddl: string): void {
  const target = path.join(appDir, 'src', 'slices', 'billing', `${name}.slice.tsx`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      `export const sliceSchema = \`${ddl}\`;`,
      `export async function ${name.replace(/-/g, '')}Action() { return null; }`,
      ''
    ].join('\n'),
    'utf-8'
  );
}

const INVOICES_DDL = `
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    total_cents INTEGER NOT NULL
  );
`;

describe('runSliceMigrations', () => {
  it('applies a new slice schema and records it', async () => {
    writeSlice(sandbox, 'generate-invoice', INVOICES_DDL);

    const report = await runSliceMigrations(sandbox, db);

    expect(report.status).toBe('PASS');
    expect(report.appliedCount).toBe(1);
    expect(report.totalDiscovered).toBe(1);

    await db.query(`INSERT INTO invoices (id, total_cents) VALUES ($1, $2)`, ['inv-1', 5000]);
    expect(await db.query(`SELECT id FROM invoices`)).toEqual([{ id: 'inv-1' }]);
  });

  it('skips an unchanged schema on the second run', async () => {
    writeSlice(sandbox, 'generate-invoice', INVOICES_DDL);

    await runSliceMigrations(sandbox, db);
    const second = await runSliceMigrations(sandbox, db);

    expect(second.status).toBe('PASS');
    expect(second.skippedCount).toBe(1);
    expect(second.appliedCount).toBe(0);
  });

  it('re-applies when the schema hash changes', async () => {
    writeSlice(sandbox, 'generate-invoice', INVOICES_DDL);
    await runSliceMigrations(sandbox, db);

    writeSlice(
      sandbox,
      'generate-invoice',
      `${INVOICES_DDL}
       CREATE TABLE IF NOT EXISTS invoice_lines (id TEXT PRIMARY KEY);`
    );

    const third = await runSliceMigrations(sandbox, db);

    expect(third.appliedCount).toBe(1);
    expect(await db.query(`SELECT name FROM sqlite_master WHERE name = 'invoice_lines'`)).toEqual([
      { name: 'invoice_lines' }
    ]);
  });

  it('resolves interpolated template literals in sliceSchema', async () => {
    writeSlice(sandbox, 'create-product', `CREATE TABLE IF NOT EXISTS \${'products'} (id TEXT PRIMARY KEY);`);

    const report = await runSliceMigrations(sandbox, db);

    expect(report.status).toBe('PASS');
    expect(await db.query(`SELECT name FROM sqlite_master WHERE name = 'products'`)).toEqual([{ name: 'products' }]);
  });

  it('fails loudly when no slices directory exists instead of reporting PASS', async () => {
    const empty = path.join(sandbox, 'no-slices');
    fs.mkdirSync(empty, { recursive: true });

    const report = await runSliceMigrations(empty, db);

    expect(report.status).toBe('FAIL');
    expect(report.code).toBe('NO_SLICES_DIR');
    expect(report.totalDiscovered).toBe(0);
    expect(report.candidates?.length).toBeGreaterThan(0);
  });
});
