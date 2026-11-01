import { describe, expect, test } from 'bun:test';
import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  MockDatabaseClient,
  SqliteDatabaseClient
} from '../src/core';

describe('Query Builder - SQL Compilation', () => {
  test('compileSelect compiles basic SELECT without filters', () => {
    const { sql, params } = compileSelect('customers');
    expect(sql).toBe('SELECT * FROM customers');
    expect(params).toEqual([]);
  });

  test('compileSelect compiles specific columns', () => {
    const { sql, params } = compileSelect('customers', {
      select: ['id', 'name', 'email']
    });
    expect(sql).toBe('SELECT id, name, email FROM customers');
    expect(params).toEqual([]);
  });

  test('compileSelect compiles object where conditions with equality and IS NULL', () => {
    const { sql, params } = compileSelect('customers', {
      where: { tenant_id: 't_100', status: 'ACTIVE', deleted_at: null }
    });
    expect(sql).toBe('SELECT * FROM customers WHERE tenant_id = $1 AND status = $2 AND deleted_at IS NULL');
    expect(params).toEqual(['t_100', 'ACTIVE']);
  });

  test('compileSelect compiles array where conditions with advanced operators', () => {
    const { sql, params } = compileSelect('products', {
      where: [
        { column: 'category', op: '=', value: 'electronics' },
        { column: 'price', op: 'BETWEEN', value: [100, 500] },
        { column: 'name', op: 'LIKE', value: '%pro%' },
        { column: 'status', op: 'IN', value: ['PUBLISHED', 'FEATURED'] },
        { column: 'archived_at', op: 'IS NULL' }
      ],
      orderBy: { created_at: 'desc', price: 'asc' },
      limit: 25,
      offset: 50
    });

    expect(sql).toBe(
      'SELECT * FROM products WHERE category = $1 AND price BETWEEN $2 AND $3 AND name LIKE $4 AND status IN ($5, $6) AND archived_at IS NULL ORDER BY created_at DESC, price ASC LIMIT $7 OFFSET $8'
    );
    expect(params).toEqual(['electronics', 100, 500, '%pro%', 'PUBLISHED', 'FEATURED', 25, 50]);
  });

  test('compileInsert compiles parameterized INSERT with RETURNING *', () => {
    const { sql, params } = compileInsert('customers', {
      id: 'c_1',
      name: 'Acme Corp',
      email: 'contact@acme.com'
    });

    expect(sql).toBe('INSERT INTO customers (id, name, email) VALUES ($1, $2, $3) RETURNING *;');
    expect(params).toEqual(['c_1', 'Acme Corp', 'contact@acme.com']);
  });

  test('compileUpdate compiles parameterized UPDATE with RETURNING * and enforces WHERE', () => {
    const { sql, params } = compileUpdate('customers', { status: 'INACTIVE', notes: 'Suspended' }, { id: 'c_1' });

    expect(sql).toBe('UPDATE customers SET status = $1, notes = $2 WHERE id = $3 RETURNING *;');
    expect(params).toEqual(['INACTIVE', 'Suspended', 'c_1']);
  });

  test('compileUpdate throws when WHERE is empty (prevents accidental full table update)', () => {
    expect(() => {
      compileUpdate('customers', { status: 'INACTIVE' }, {});
    }).toThrow('blocked for safety');
  });

  test('compileDelete compiles parameterized DELETE with RETURNING * and enforces WHERE', () => {
    const { sql, params } = compileDelete('customers', { id: 'c_1' });
    expect(sql).toBe('DELETE FROM customers WHERE id = $1 RETURNING *;');
    expect(params).toEqual(['c_1']);
  });

  test('compileDelete throws when WHERE is empty (prevents accidental full table truncate)', () => {
    expect(() => {
      compileDelete('customers', {});
    }).toThrow('blocked for safety');
  });
});

describe('DatabaseClient - Isomorphic Query Execution', () => {
  test('SqliteDatabaseClient executes findMany, findOne, insert, update and delete seamlessly', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        age INTEGER NOT NULL,
        status TEXT NOT NULL
      );
    `);

    // 1. insert
    const inserted = await db.insert<{ id: string; name: string; email: string; age: number; status: string }>(
      'users',
      {
        id: 'u_1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        age: 36,
        status: 'ACTIVE'
      }
    );
    expect(inserted.id).toBe('u_1');
    expect(inserted.name).toBe('Ada Lovelace');

    await db.insert('users', {
      id: 'u_2',
      name: 'Alan Turing',
      email: 'alan@example.com',
      age: 41,
      status: 'ACTIVE'
    });

    // 2. findMany with filter and ordering
    const activeUsers = await db.findMany<{ id: string; name: string; age: number }>('users', {
      select: ['id', 'name', 'age'],
      where: { status: 'ACTIVE' },
      orderBy: { age: 'desc' }
    });
    expect(activeUsers.length).toBe(2);
    expect(activeUsers[0].name).toBe('Alan Turing');
    expect(activeUsers[1].name).toBe('Ada Lovelace');

    // 3. findOne
    const ada = await db.findOne<{ id: string; name: string }>('users', {
      where: { email: 'ada@example.com' }
    });
    expect(ada).not.toBeNull();
    expect(ada?.name).toBe('Ada Lovelace');

    // 4. update
    const updated = await db.update<{ id: string; status: string }>('users', { status: 'INACTIVE' }, { id: 'u_1' });
    expect(updated.length).toBe(1);
    expect(updated[0].status).toBe('INACTIVE');

    // 5. delete
    const deletedCount = await db.delete('users', { id: 'u_2' });
    expect(deletedCount).toBe(1);

    const remaining = await db.findMany('users');
    expect(remaining.length).toBe(1);
  });

  test('MockDatabaseClient supports declarative query methods and records calls', async () => {
    const mock = new MockDatabaseClient({
      customers: [
        { id: 'c_1', name: 'Alpha Corp' },
        { id: 'c_2', name: 'Beta Ltd' }
      ]
    });

    const customers = await mock.findMany<{ id: string; name: string }>('customers');
    expect(customers.length).toBe(2);
    expect(customers[0].name).toBe('Alpha Corp');

    // Insert into mock
    const newCustomer = await mock.insert<{ id: string; name: string }>('customers', {
      id: 'c_3',
      name: 'Gamma LLC'
    });
    expect(newCustomer.id).toBe('c_3');

    // Verify call tracking
    expect(mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mock.calls[0].sql).toContain('SELECT * FROM customers');
    expect(mock.calls[1].sql).toContain('INSERT INTO customers');
  });

  test('compileSelect supports distinct, aggregations, groupBy and having', () => {
    const { sql, params } = compileSelect('orders', {
      distinct: true,
      select: ['status'],
      aggregations: [
        { fn: 'COUNT', column: '*', as: 'total_orders' },
        { fn: 'SUM', column: 'amount', as: 'total_amount' }
      ],
      where: { active: 1 },
      groupBy: ['status'],
      having: [{ column: 'total_amount', op: '>', value: 1000 }]
    });

    expect(sql).toContain(
      'SELECT DISTINCT status, COUNT(*) AS "total_orders", SUM(amount) AS "total_amount" FROM orders'
    );
    expect(sql).toContain('WHERE active = $1');
    expect(sql).toContain('GROUP BY status');
    expect(sql).toContain('HAVING SUM(amount) > $2');
    expect(sql).not.toContain('HAVING total_amount');
    expect(params).toEqual([1, 1000]);
  });

  test('compileSelect accepts an explicit aggregate expression in having', () => {
    const { sql, params } = compileSelect('orders', {
      aggregations: [{ fn: 'SUM', column: 'amount', as: 'total_amount' }],
      groupBy: 'status',
      having: [{ fn: 'SUM', column: 'amount', op: '>', value: 500 }]
    });

    expect(sql).toContain('HAVING SUM(amount) > $1');
    expect(params).toEqual([500]);
  });

  test('rejects a HAVING column that is neither grouped nor aggregated', () => {
    expect(() =>
      compileSelect('orders', {
        aggregations: [{ fn: 'SUM', column: 'amount', as: 'total_amount' }],
        groupBy: 'status',
        having: [{ column: 'unmapped', op: '>', value: 1 }]
      })
    ).toThrow(/Invalid HAVING column/);
  });

  test('MockDatabaseClient.aggregate refuses aggregation it cannot model', async () => {
    const mock = new MockDatabaseClient();

    await expect(
      mock.aggregate('orders', {
        aggregations: [{ fn: 'COUNT', column: '*', as: 'total' }],
        groupBy: 'status'
      })
    ).rejects.toThrow(/UNSUPPORTED_OPERATION/);
  });

  test('SqliteDatabaseClient supports count, exists and aggregate', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    await db.query(`
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        price INTEGER NOT NULL
      );
    `);

    await db.insert('products', { id: 'p_1', category: 'ELEC', price: 100 });
    await db.insert('products', { id: 'p_2', category: 'ELEC', price: 200 });
    await db.insert('products', { id: 'p_3', category: 'BOOK', price: 50 });

    const totalCount = await db.count('products');
    expect(totalCount).toBe(3);

    const elecCount = await db.count('products', { category: 'ELEC' });
    expect(elecCount).toBe(2);

    const hasElec = await db.exists('products', { category: 'ELEC' });
    expect(hasElec).toBe(true);

    const hasToys = await db.exists('products', { category: 'TOYS' });
    expect(hasToys).toBe(false);

    const grouped = await db.aggregate<{ category: string; count: number }>('products', {
      select: ['category'],
      aggregations: [{ fn: 'COUNT', column: '*', as: 'count' }],
      groupBy: 'category',
      orderBy: { category: 'asc' }
    });

    expect(grouped.length).toBe(2);
    expect(grouped[0].category).toBe('BOOK');
    expect(Number(grouped[0].count)).toBe(1);
    expect(grouped[1].category).toBe('ELEC');
    expect(Number(grouped[1].count)).toBe(2);
  });
});
