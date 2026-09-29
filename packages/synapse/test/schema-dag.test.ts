import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { orderSlicesByDag, parseTableDependencies } from '../src/compiler/schema-dag';

describe('Schema DAG & Topological Migration Ordering (Fase F)', () => {
  test('parseTableDependencies identifies created tables and foreign key references', () => {
    const ddl = `
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        status TEXT NOT NULL
      );
      CREATE TABLE order_logs (
        id INTEGER PRIMARY KEY,
        order_id TEXT REFERENCES orders(id)
      );
    `;

    const { created, referenced } = parseTableDependencies(ddl);

    expect(created).toEqual(['orders', 'order_logs']);
    expect(referenced).toEqual(['customers']);
  });

  test('parseTableDependencies ignores commented REFERENCES and handles schema-qualified/quoted names', () => {
    const ddl = `
      -- Old reference that should be ignored: REFERENCES legacy_users(id)
      /* Multi-line comment:
         REFERENCES deprecated_table(id)
      */
      CREATE TABLE IF NOT EXISTS public."user_profiles" (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES auth."accounts"(id)
      );
    `;

    const { created, referenced } = parseTableDependencies(ddl);

    expect(created).toEqual(['user_profiles']);
    expect(referenced).toEqual(['accounts']);
    expect(referenced).not.toContain('legacy_users');
    expect(referenced).not.toContain('deprecated_table');
  });

  test('orderSlicesByDag orders parent slices before child slices referencing foreign keys', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-dag-'));

    // Slice 1: dependent child (references orders)
    const itemsSlice = path.join(tempDir, 'order-items.slice.tsx');
    fs.writeFileSync(
      itemsSlice,
      `
      export const sliceSchema = \`
        CREATE TABLE order_items (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES orders(id)
        );
      \`;
      `
    );

    // Slice 2: intermediate parent (references customers)
    const ordersSlice = path.join(tempDir, 'orders.slice.tsx');
    fs.writeFileSync(
      ordersSlice,
      `
      export const sliceSchema = \`
        CREATE TABLE orders (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL REFERENCES customers(id)
        );
      \`;
      `
    );

    // Slice 3: root parent (no references)
    const customersSlice = path.join(tempDir, 'customers.slice.tsx');
    fs.writeFileSync(
      customersSlice,
      `
      export const sliceSchema = \`
        CREATE TABLE customers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
      \`;
      `
    );

    // Inverted input order: items -> orders -> customers
    const inputOrder = [itemsSlice, ordersSlice, customersSlice];
    const sorted = orderSlicesByDag(inputOrder);

    // Expected topological order: customers -> orders -> order-items
    expect(sorted).toEqual([customersSlice, ordersSlice, itemsSlice]);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('orderSlicesByDag handles circular dependencies without infinite loop', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-dag-cycle-'));

    const sliceA = path.join(tempDir, 'slice-a.slice.tsx');
    fs.writeFileSync(
      sliceA,
      `export const sliceSchema = 'CREATE TABLE table_a (id TEXT PRIMARY KEY, b_id TEXT REFERENCES table_b(id));';`
    );

    const sliceB = path.join(tempDir, 'slice-b.slice.tsx');
    fs.writeFileSync(
      sliceB,
      `export const sliceSchema = 'CREATE TABLE table_b (id TEXT PRIMARY KEY, a_id TEXT REFERENCES table_a(id));';`
    );

    const sorted = orderSlicesByDag([sliceA, sliceB]);
    expect(sorted).toHaveLength(2);
    expect(sorted).toContain(sliceA);
    expect(sorted).toContain(sliceB);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
