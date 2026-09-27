import { describe, expect, test } from 'bun:test';
import { compileTaggedSql, MockDatabaseClient, SqliteDatabaseClient } from '../src/core';

describe('Tagged SQL & Persistence Layer (Hybrid Solution 4)', () => {
  test('compileTaggedSql compiles template literal into parameterized query text and values array', () => {
    const id = 'cust-42';
    const active = true;
    const { text, params } = compileTaggedSql`SELECT * FROM customers WHERE id = ${id} AND is_active = ${active}`;

    expect(text).toBe('SELECT * FROM customers WHERE id = $1 AND is_active = $2');
    expect(params).toEqual(['cust-42', true]);
  });

  test('MockDatabaseClient supports .sql and .sqlOne with parameterized matching', async () => {
    const mock = new MockDatabaseClient();
    mock.onQuery('SELECT * FROM users WHERE email = $1', (params) => {
      if (params[0] === 'test@example.com') {
        return [{ id: 1, email: 'test@example.com' }];
      }
      return [];
    });

    const email = 'test@example.com';
    const rows = await mock.sql<{ id: number; email: string }>`SELECT * FROM users WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('test@example.com');

    const single = await mock.sqlOne<{ id: number; email: string }>`SELECT * FROM users WHERE email = ${email}`;
    expect(single?.id).toBe(1);

    const missing = await mock.sqlOne`SELECT * FROM users WHERE email = ${'other@example.com'}`;
    expect(missing).toBeNull();
  });

  test('SqliteDatabaseClient executes tagged queries safely with parameter substitution and transactions', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
      );
    `);

    // Insert using tagged SQL
    const name = 'Synapse Widget';
    const price = 49.99;
    await db.sql`INSERT INTO items (name, price) VALUES (${name}, ${price})`;

    // Query back
    interface Item {
      id: number;
      name: string;
      price: number;
    }
    const items = await db.sql<Item>`SELECT * FROM items WHERE price > ${40}`;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Synapse Widget');
    expect(items[0].price).toBe(49.99);

    const single = await db.sqlOne<Item>`SELECT * FROM items WHERE name = ${'Synapse Widget'}`;
    expect(single).not.toBeNull();
    expect(single?.name).toBe('Synapse Widget');

    // Transaction with tagged template
    await db.transaction(async (tx) => {
      await tx.sql`INSERT INTO items (name, price) VALUES (${'Gadget'}, ${19.99})`;
      const count = await tx.sqlOne<{ count: number }>`SELECT COUNT(*) as count FROM items`;
      expect(count?.count).toBe(2);
    });

    const finalCount = await db.sqlOne<{ count: number }>`SELECT COUNT(*) as count FROM items`;
    expect(finalCount?.count).toBe(2);

    db.close();
  });
});
