import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateDatabaseSchemaCatalog,
  mapSqlTypeToTs,
  parseDdlToCatalog,
  toPascalCase
} from '../src/compiler/db-schema-generator';

describe('Database Schema Generator', () => {
  test('toPascalCase converts identifiers correctly', () => {
    expect(toPascalCase('customers')).toBe('Customers');
    expect(toPascalCase('order_items')).toBe('OrderItems');
    expect(toPascalCase('support-tickets')).toBe('SupportTickets');
  });

  test('mapSqlTypeToTs maps SQL types to TypeScript types', () => {
    expect(mapSqlTypeToTs('TEXT')).toBe('string');
    expect(mapSqlTypeToTs('VARCHAR(255)')).toBe('string');
    expect(mapSqlTypeToTs('INTEGER')).toBe('number');
    expect(mapSqlTypeToTs('REAL')).toBe('number');
    expect(mapSqlTypeToTs('BOOLEAN')).toBe('boolean');
    expect(mapSqlTypeToTs('TIMESTAMP')).toBe('string');
    expect(mapSqlTypeToTs('JSONB')).toBe('Record<string, unknown> | unknown[]');
    expect(mapSqlTypeToTs('BYTEA')).toBe('Uint8Array');
  });

  test('parseDdlToCatalog parses table and column definitions with constraints', () => {
    const ddl = `
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        balance REAL DEFAULT 0.0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        total_amount REAL NOT NULL,
        status TEXT NOT NULL
      );
    `;

    const tables = parseDdlToCatalog(ddl, 'billing-slice');
    expect(tables.length).toBe(2);

    // Table 1: customers
    const customers = tables[0];
    expect(customers.name).toBe('customers');
    expect(customers.interfaceName).toBe('DbCustomers');
    expect(customers.columns.length).toBe(7);

    const idCol = customers.columns.find((c) => c.name === 'id');
    expect(idCol).toBeDefined();
    expect(idCol?.tsType).toBe('string');
    expect(idCol?.isPrimaryKey).toBe(true);
    expect(idCol?.isNullable).toBe(false);

    const balanceCol = customers.columns.find((c) => c.name === 'balance');
    expect(balanceCol).toBeDefined();
    expect(balanceCol?.tsType).toBe('number');
    expect(balanceCol?.isNullable).toBe(true);

    const boolCol = customers.columns.find((c) => c.name === 'is_active');
    expect(boolCol).toBeDefined();
    expect(boolCol?.tsType).toBe('boolean');

    // Table 2: orders
    const orders = tables[1];
    expect(orders.name).toBe('orders');
    expect(orders.interfaceName).toBe('DbOrders');
    const customerIdCol = orders.columns.find((c) => c.name === 'customer_id');
    expect(customerIdCol).toBeDefined();
    expect(customerIdCol?.references).toEqual({ table: 'customers', column: 'id' });
  });

  test('generateDatabaseSchemaCatalog generates compilable .d.ts from slices', () => {
    const tmpDir = path.join(process.cwd(), '.synapse/test-schema-catalog');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputFile = path.join(tmpDir, 'db-schema.d.ts');
    const catalog = generateDatabaseSchemaCatalog(path.join(process.cwd(), 'apps/crm'), outputFile);

    expect(catalog.totalTables).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(outputFile)).toBe(true);
    const content = fs.readFileSync(outputFile, 'utf-8');

    expect(content).toContain('[SYNAPSE-JS AUTO-GENERATED DATABASE SCHEMA CATALOG]');
    expect(content).toContain('export interface DatabaseSchema');
    expect(content).toContain('export type TableName = keyof DatabaseSchema;');
    expect(content).toContain('export type Row<T extends TableName> = DatabaseSchema[T];');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
