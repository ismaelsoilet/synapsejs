/**
 * SynapseJS - Native SQLite Database Driver (bun:sqlite)
 *
 * Provides zero-configuration embedded persistence implementing the core
 * DatabaseClient contract, with an explicit prepared-statement cache and
 * correct read/write classification (including CTEs and RETURNING clauses).
 */

import { Database, type SQLQueryBindings, type Statement } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs';
import type { DatabaseClient } from './database-client';

const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA', 'VALUES']);

/**
 * First SQL keyword, ignoring leading whitespace and comments.
 */
function firstKeyword(sql: string): string {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');

  const match = withoutComments.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : '';
}

export class SqliteDatabaseClient implements DatabaseClient {
  private db: Database;
  private statements: Map<string, Statement<unknown, SQLQueryBindings[]>> = new Map();

  constructor(filePath?: string) {
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
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  private getStatement(sql: string): Statement<unknown, SQLQueryBindings[]> {
    const cached = this.statements.get(sql);
    if (cached) {
      return cached;
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

  async transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T> {
    this.db.run('BEGIN TRANSACTION;');
    try {
      const result = await operation(this);
      this.db.run('COMMIT;');
      return result;
    } catch (err) {
      this.db.run('ROLLBACK;');
      throw err;
    }
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
