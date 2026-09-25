/**
 * SynapseJS - Native SQLite Database Driver (bun:sqlite)
 * 
 * Provides zero-configuration, blazingly fast embedded persistence
 * implementing the core DatabaseClient contract.
 */

import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs';
import type { DatabaseClient } from './database-client';

export class SqliteDatabaseClient implements DatabaseClient {
  private db: Database;

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

    // Enable WAL mode for high concurrency & performance
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  /**
   * Helper to initialize schema tables if they don't exist.
   */
  initSchema(ddl: string): this {
    this.db.run(ddl);
    return this;
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    // Normalise Postgres $1, $2, $3 parameter notation to SQLite ?1, ?2, ?3 notation
    const sqliteSql = sql.replace(/\$(\d+)/g, '?$1');
    
    // Check if query is a mutation with RETURNING or just a SELECT
    const trimmed = sqliteSql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.includes('RETURNING')) {
      const stmt = this.db.query<T, any>(sqliteSql);
      return stmt.all(...(params as any[])) as T[];
    } else {
      const stmt = this.db.prepare(sqliteSql);
      stmt.run(...(params as any[]));
      return [] as T[];
    }
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
    this.db.close();
  }
}

/**
 * Default shared database provider for SynapseJS.
 */
let defaultInstance: SqliteDatabaseClient | null = null;

export function getSqliteDatabase(dbPath?: string): SqliteDatabaseClient {
  if (!defaultInstance) {
    const targetPath = dbPath || path.join(process.cwd(), '.synapse/synapse.sqlite');
    defaultInstance = new SqliteDatabaseClient(targetPath);
  }
  return defaultInstance;
}
