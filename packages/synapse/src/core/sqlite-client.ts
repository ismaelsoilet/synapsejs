/**
 * SynapseJS - Native SQLite Database Driver (bun:sqlite)
 *
 * Provides zero-configuration embedded persistence implementing the core
 * DatabaseClient contract, with an explicit prepared-statement cache and
 * correct read/write classification (including CTEs and RETURNING clauses).
 */

import { Database, type SQLQueryBindings, type Statement } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileTaggedSql,
  compileUpdate,
  type DatabaseClient,
  nestJoinedRow,
  type QueryOptions,
  type WhereCondition
} from './database-client';

const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA', 'VALUES']);

/**
 * First SQL keyword, ignoring leading whitespace and comments.
 */
function firstKeyword(sql: string): string {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

  const match = withoutComments.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : '';
}

export class SqliteDatabaseClient implements DatabaseClient {
  private db: Database;
  private statements: Map<string, Statement<unknown, SQLQueryBindings[]>> = new Map();
  private maxStatements: number;
  private txLock: Promise<void> = Promise.resolve();

  constructor(filePath?: string, maxStatements = 500) {
    this.maxStatements = maxStatements;

    if (filePath && filePath !== ':memory:') {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(filePath);
    } else {
      this.db = new Database(':memory:');
    }

    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    this.db.run('PRAGMA busy_timeout = 5000;');
    this.db.run('PRAGMA temp_store = MEMORY;');
    this.db.run('PRAGMA cache_size = -64000;');
    this.db.run('PRAGMA mmap_size = 268435456;');
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  private getStatement(sql: string): Statement<unknown, SQLQueryBindings[]> {
    const cached = this.statements.get(sql);
    if (cached) {
      // Re-insert to refresh LRU eviction order
      this.statements.delete(sql);
      this.statements.set(sql, cached);
      return cached;
    }

    if (this.statements.size >= this.maxStatements) {
      const oldestKey = this.statements.keys().next().value;
      if (oldestKey !== undefined) {
        this.statements.delete(oldestKey);
      }
    }

    const statement = this.db.query<unknown, SQLQueryBindings[]>(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  private isReadQuery(sql: string): boolean {
    if (READ_KEYWORDS.has(firstKeyword(sql))) {
      return true;
    }

    // INSERT/UPDATE/DELETE ... RETURNING must surface the returned rows
    return /\bRETURNING\b/i.test(sql);
  }

  initSchema(ddl: string): this {
    this.db.run(ddl);
    return this;
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    // Normalise Postgres $1, $2, $3 parameter notation to SQLite ?1, ?2, ?3 notation
    const sqliteSql = sql.replace(/\$(\d+)/g, '?$1');
    const statement = this.getStatement(sqliteSql);
    const bindings = params as SQLQueryBindings[];

    if (this.isReadQuery(sqliteSql)) {
      return statement.all(...bindings) as T[];
    }

    statement.run(...bindings);
    return [] as T[];
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  async sql<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const { text, params } = compileTaggedSql(strings, ...values);
    return this.query<T>(text, params);
  }

  async sqlOne<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | null> {
    const { text, params } = compileTaggedSql(strings, ...values);
    return this.queryOne<T>(text, params);
  }

  async findMany<T = unknown>(table: string, options?: QueryOptions): Promise<T[]> {
    const { sql, params } = compileSelect(table, options);
    const rows = await this.query<Record<string, unknown>>(sql, params);
    if (options?.join && options.join.length > 0) {
      return rows.map((r) => nestJoinedRow<T>(r, options.join));
    }
    return rows as unknown as T[];
  }

  async findOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    const opts = { ...options, limit: 1 };
    const { sql, params } = compileSelect(table, opts);
    const row = await this.queryOne<Record<string, unknown>>(sql, params);
    if (!row) return null;
    if (options?.join && options.join.length > 0) {
      return nestJoinedRow<T>(row, options.join);
    }
    return row as unknown as T;
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    const { sql, params } = compileInsert(table, data);
    const rows = await this.query<T>(sql, params);
    if (!rows || rows.length === 0) {
      throw new Error(`Failed to insert into ${table}: no row returned`);
    }
    return rows[0];
  }

  async update<T = unknown>(table: string, data: Record<string, unknown>, where: WhereCondition): Promise<T[]> {
    const { sql, params } = compileUpdate(table, data, where);
    return this.query<T>(sql, params);
  }

  async delete(table: string, where: WhereCondition): Promise<number> {
    const { sql, params } = compileDelete(table, where);
    const rows = await this.query(sql, params);
    return rows.length;
  }

  async transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T> {
    let releaseLock: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.txLock;
    this.txLock = lockAcquired;

    await previousLock;

    try {
      this.db.run('BEGIN TRANSACTION;');
      try {
        const result = await operation(this);
        this.db.run('COMMIT;');
        return result;
      } catch (err) {
        this.db.run('ROLLBACK;');
        throw err;
      }
    } finally {
      releaseLock();
    }
  }

  get statementCacheSize(): number {
    return this.statements.size;
  }

  hasCachedStatement(sql: string): boolean {
    return this.statements.has(sql);
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
