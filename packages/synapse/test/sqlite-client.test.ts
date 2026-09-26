import { beforeEach, describe, expect, it } from 'bun:test';
import { getDatabase, resetDatabaseInstance } from '../src/core/database-factory';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';

describe('SqliteDatabaseClient', () => {
  let db: SqliteDatabaseClient;

  beforeEach(() => {
    db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL
      );
    `);
  });

  it('reads rows with SELECT', async () => {
    await db.query(`INSERT INTO items (id, label) VALUES ($1, $2)`, ['a', 'alpha']);

    const rows = await db.query<{ id: string; label: string }>(`SELECT id, label FROM items`);
    expect(rows).toEqual([{ id: 'a', label: 'alpha' }]);
  });

  it('surfaces rows from INSERT ... RETURNING', async () => {
    const rows = await db.query<{ id: string }>(`INSERT INTO items (id, label) VALUES ($1, $2) RETURNING id`, [
      'b',
      'beta'
    ]);

    expect(rows).toEqual([{ id: 'b' }]);
  });

  it('surfaces rows from a CTE (WITH ... SELECT)', async () => {
    await db.query(`INSERT INTO items (id, label) VALUES ($1, $2)`, ['c', 'gamma']);

    const rows = await db.query<{ label: string }>(
      `
      WITH matching AS (
        SELECT label FROM items WHERE id = $1
      )
      SELECT label FROM matching
    `,
      ['c']
    );

    expect(rows).toEqual([{ label: 'gamma' }]);
  });

  it('returns an empty array for writes without RETURNING', async () => {
    const rows = await db.query(`UPDATE items SET label = $1 WHERE id = $2`, ['x', 'missing']);
    expect(rows).toEqual([]);
  });

  it('is stable across repeated identical statements (cached statements stay correct)', async () => {
    await db.query(`INSERT INTO items (id, label) VALUES ($1, $2)`, ['d', 'delta']);

    for (let i = 0; i < 3; i++) {
      const rows = await db.query<{ label: string }>(`SELECT label FROM items WHERE id = $1`, ['d']);
      expect(rows).toEqual([{ label: 'delta' }]);
    }
  });

  it('returns a single row or null with queryOne', async () => {
    await db.query(`INSERT INTO items (id, label) VALUES ($1, $2)`, ['e', 'epsilon']);

    expect(await db.queryOne<{ label: string }>(`SELECT label FROM items WHERE id = $1`, ['e'])).toEqual({
      label: 'epsilon'
    });
    expect(await db.queryOne<{ label: string }>(`SELECT label FROM items WHERE id = $1`, ['nope'])).toBeNull();
  });

  it('commits and rolls back transactions', async () => {
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO items (id, label) VALUES ($1, $2)`, ['f', 'kept']);
    });

    expect(await db.query(`SELECT id FROM items WHERE id = $1`, ['f'])).toEqual([{ id: 'f' }]);

    await expect(
      db.transaction(async (tx) => {
        await tx.query(`INSERT INTO items (id, label) VALUES ($1, $2)`, ['g', 'dropped']);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(await db.query(`SELECT id FROM items WHERE id = $1`, ['g'])).toEqual([]);
  });
});

describe('getDatabase engine guard', () => {
  it('refuses an unsupported URL scheme instead of silently using SQLite', () => {
    resetDatabaseInstance();
    expect(() => getDatabase('mysql://user@host/db')).toThrow(/esquema não suportado/);
    resetDatabaseInstance();
  });

  it('still accepts a bare SQLite file path', () => {
    resetDatabaseInstance();
    expect(getDatabase(':memory:')).toBeInstanceOf(SqliteDatabaseClient);
    resetDatabaseInstance();
  });
});
