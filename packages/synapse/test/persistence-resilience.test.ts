import { describe, expect, it } from 'bun:test';
import { splitStatements } from '../src/compiler/migration-runner';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';

describe('SQLite Transaction Mutex & Concurrency (G-06)', () => {
  it('serializes concurrent transactions without collision', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      CREATE TABLE counter (
        id TEXT PRIMARY KEY,
        val INTEGER NOT NULL
      );
      INSERT INTO counter (id, val) VALUES ('global', 0);
    `);

    // Dispara 20 transações concorrentes simultâneas com assincronismo deliberado
    const concurrency = 20;
    const tasks = Array.from({ length: concurrency }).map(async () => {
      return db.transaction(async (tx) => {
        const row = await tx.queryOne<{ val: number }>(`SELECT val FROM counter WHERE id = 'global';`);
        expect(row).not.toBeNull();
        const next = (row?.val ?? 0) + 1;
        // Simula I/O assíncrono durante a transação
        await new Promise((resolve) => setTimeout(resolve, 2));
        await tx.query(`UPDATE counter SET val = $1 WHERE id = 'global';`, [next]);
        return next;
      });
    });

    const results = await Promise.all(tasks);
    expect(results.length).toBe(concurrency);

    const finalRow = await db.queryOne<{ val: number }>(`SELECT val FROM counter WHERE id = 'global';`);
    expect(finalRow?.val).toBe(concurrency);

    db.close();
  });

  it('rolls back on failure and preserves queue liveness for subsequent transactions', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      CREATE TABLE items (id TEXT PRIMARY KEY);
    `);

    // Transação 1: Falha propositalmente
    let tx1Failed = false;
    try {
      await db.transaction(async (tx) => {
        await tx.query(`INSERT INTO items (id) VALUES ('item-1');`);
        throw new Error('Falha proposital dentro da transação');
      });
    } catch {
      tx1Failed = true;
    }
    expect(tx1Failed).toBe(true);

    // Transação 2: Deve executar normalmente sem travar o mutex
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO items (id) VALUES ('item-2');`);
    });

    const items = await db.query<{ id: string }>(`SELECT id FROM items;`);
    // 'item-1' deve ter sofrido rollback, apenas 'item-2' deve existir
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('item-2');

    db.close();
  });
});

describe('SQLite LRU Statement Cache (G-07)', () => {
  it('bounds statement cache size to maxStatements capacity', async () => {
    const maxCapacity = 3;
    const db = new SqliteDatabaseClient(':memory:', maxCapacity);

    // Executa 6 queries distintas
    for (let i = 1; i <= 6; i++) {
      await db.query(`SELECT ${i} as num;`);
    }

    expect(db.statementCacheSize).toBe(maxCapacity);

    db.close();
  });

  it('refreshes LRU order when existing statement is re-queried', async () => {
    const db = new SqliteDatabaseClient(':memory:', 3);

    await db.query('SELECT 10;'); // item A
    await db.query('SELECT 20;'); // item B
    await db.query('SELECT 30;'); // item C

    // Re-acessa item A (move para o topo do LRU)
    await db.query('SELECT 10;');

    // Adiciona novo item D (deve desalojar item B, que virou o mais antigo)
    await db.query('SELECT 40;');

    expect(db.hasCachedStatement('SELECT 10;')).toBe(true); // Ainda presente
    expect(db.hasCachedStatement('SELECT 30;')).toBe(true); // Ainda presente
    expect(db.hasCachedStatement('SELECT 40;')).toBe(true); // Recém inserido
    expect(db.hasCachedStatement('SELECT 20;')).toBe(false); // Desalojado!

    db.close();
  });
});

describe('DDL Tokenizer / splitStatements (G-09)', () => {
  it('splits standard statements separated by semicolons', () => {
    const ddl = `
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT);
    `;
    const stmts = splitStatements(ddl);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain('CREATE TABLE users');
    expect(stmts[1]).toContain('CREATE TABLE posts');
  });

  it('does not split on semicolons inside single-quoted string literals', () => {
    const ddl = `
      CREATE TABLE settings (
        id TEXT PRIMARY KEY,
        default_config TEXT DEFAULT 'user=none;role=guest;active=true',
        notes TEXT DEFAULT 'hello; world'
      );
    `;
    const stmts = splitStatements(ddl);
    expect(stmts.length).toBe(1);
    expect(stmts[0]).toContain("'user=none;role=guest;active=true'");
  });

  it('does not split on semicolons inside line and block comments', () => {
    const ddl = `
      -- Set configuration; this should not split;
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY /* comment; here; too */,
        created_at TIMESTAMP
      );
      -- Another comment; ending here
      CREATE TABLE metrics (id TEXT PRIMARY KEY);
    `;
    const stmts = splitStatements(ddl);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain('CREATE TABLE audit_log');
    expect(stmts[1]).toContain('CREATE TABLE metrics');
  });

  it('does not split on semicolons inside PostgreSQL dollar-quoted blocks ($$ ... $$)', () => {
    const ddl = `
      CREATE OR REPLACE FUNCTION trigger_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TABLE accounts (id TEXT PRIMARY KEY);
    `;
    const stmts = splitStatements(ddl);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain('NEW.updated_at = NOW();');
    expect(stmts[1]).toContain('CREATE TABLE accounts');
  });

  it('handles trailing statements without ending semicolons', () => {
    const ddl = `CREATE TABLE a (id INT); CREATE TABLE b (id INT)`;
    const stmts = splitStatements(ddl);
    expect(stmts.length).toBe(2);
  });
});
