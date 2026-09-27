import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { checkSchemaDrift } from '../src/compiler/schema-drift';
import { SqliteDatabaseClient } from '../src/core';

describe('Schema Drift Detection', () => {
  const exampleCrmDir = path.resolve(__dirname, '../../../examples/enterprise-crm');

  const validCrmDdl = `
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      base_cents INTEGER NOT NULL,
      tax_rate REAL NOT NULL,
      total_cents INTEGER NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
  `;

  test('reports missing tables when database is empty', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    const report = await checkSchemaDrift(exampleCrmDir, db);

    expect(report.status).toBe('DRIFT_DETECTED');
    expect(report.totalDeclaredTables).toBe(3);
    expect(report.totalLiveTables).toBe(0);
    expect(report.drift.missingTables).toHaveLength(3);
    expect(report.drift.missingTables.some((t) => t.table === 'customers')).toBe(true);
  });

  test('reports PASS when all declared tables and columns exist in database', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(validCrmDdl);

    const report = await checkSchemaDrift(exampleCrmDir, db);
    expect(report.status).toBe('PASS');
    expect(report.drift.missingTables).toHaveLength(0);
    expect(report.drift.missingColumns).toHaveLength(0);
    expect(report.drift.orphanTables).toHaveLength(0);
  });

  test('reports missingColumns when a column is missing from a table', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    // customers missing tax_id
    db.initSchema(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        base_cents INTEGER NOT NULL,
        tax_rate REAL NOT NULL,
        total_cents INTEGER NOT NULL,
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL
      );
    `);

    const report = await checkSchemaDrift(exampleCrmDir, db);
    expect(report.status).toBe('DRIFT_DETECTED');
    expect(report.drift.missingTables).toHaveLength(0);
    expect(report.drift.missingColumns).toHaveLength(1);
    expect(report.drift.missingColumns[0]).toEqual({
      table: 'customers',
      column: 'tax_id',
      expectedType: 'TEXT'
    });
  });

  test('reports orphanTables when an undeclared table exists in database', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      ${validCrmDdl}

      CREATE TABLE legacy_audit_log (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
    `);

    const report = await checkSchemaDrift(exampleCrmDir, db);
    expect(report.status).toBe('DRIFT_DETECTED');
    expect(report.drift.orphanTables).toContain('legacy_audit_log');
  });
});
