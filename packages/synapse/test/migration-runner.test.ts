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

  it('runs an ALTER TABLE once and never again', async () => {
    writeSlice(
      sandbox,
      'add-phone',
      `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY);
       ALTER TABLE contacts ADD COLUMN phone TEXT;`
    );

    const first = await runSliceMigrations(sandbox, db);
    expect(first.status).toBe('PASS');
    expect(first.statementsApplied).toBe(2);

    await db.query(`INSERT INTO contacts (id, phone) VALUES ($1, $2)`, ['c-1', '5555']);

    const second = await runSliceMigrations(sandbox, db);
    expect(second.status).toBe('PASS');
    expect(second.statementsApplied).toBe(0);
    expect(second.skippedCount).toBe(1);
  });

  it('applies only the new statement when the DDL grows', async () => {
    writeSlice(
      sandbox,
      'add-columns',
      `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY);
       ALTER TABLE clients ADD COLUMN phone TEXT;`
    );
    await runSliceMigrations(sandbox, db);

    // Segunda edição do DDL: o ALTER já aplicado não pode rodar de novo
    // ("duplicate column name"), só o novo.
    writeSlice(
      sandbox,
      'add-columns',
      `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY);
       ALTER TABLE clients ADD COLUMN phone TEXT;
       ALTER TABLE clients ADD COLUMN city TEXT;`
    );

    const report = await runSliceMigrations(sandbox, db);

    expect(report.status).toBe('PASS');
    expect(report.statementsApplied).toBe(1);
    expect(report.migrations[0].status).toBe('APPLIED');

    await db.query(`INSERT INTO clients (id, phone, city) VALUES ($1, $2, $3)`, ['cl-1', '5555', 'Recife']);
    expect(await db.query(`SELECT city FROM clients`)).toEqual([{ city: 'Recife' }]);
  });

  it('does not record a statement that failed, so a fix can run', async () => {
    writeSlice(sandbox, 'broken-ddl', `CREATE TABLE IF NOT EXISTS broken (id TEXT PRIMARY KEY);`);
    const first = await runSliceMigrations(sandbox, db);
    expect(first.status).toBe('PASS');

    writeSlice(
      sandbox,
      'broken-ddl',
      `CREATE TABLE IF NOT EXISTS broken (id TEXT PRIMARY KEY);
       ALTER TABLE tabela_que_nao_existe ADD COLUMN nope TEXT;`
    );
    const failed = await runSliceMigrations(sandbox, db);
    expect(failed.status).toBe('FAIL');
    expect(failed.migrations[0].statementsApplied).toBe(0);

    writeSlice(
      sandbox,
      'broken-ddl',
      `CREATE TABLE IF NOT EXISTS broken (id TEXT PRIMARY KEY);
       ALTER TABLE broken ADD COLUMN fixed TEXT;`
    );
    const fixed = await runSliceMigrations(sandbox, db);

    // Só o statement que falhou fica pendente: o CREATE já registrado não roda de novo.
    expect(fixed.status).toBe('PASS');
    expect(fixed.statementsApplied).toBe(1);
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
