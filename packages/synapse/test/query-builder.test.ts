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
});
