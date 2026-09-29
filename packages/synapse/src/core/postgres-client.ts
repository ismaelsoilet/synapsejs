/**
 * SynapseJS - PostgreSQL Database Driver (postgres.js)
 *
 * Provides production-ready, pooled, high-performance PostgreSQL persistence
 * implementing the core DatabaseClient contract.
 */

import postgres from 'postgres';
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

export class PostgresDatabaseClient implements DatabaseClient {
  private client: postgres.Sql;

  // biome-ignore lint/suspicious/noExplicitAny: external postgres.js options boundary
  constructor(connectionString: string, options?: postgres.Options<any>) {
    this.client = postgres(connectionString, {
      max: options?.max || 10,
      idle_timeout: options?.idle_timeout || 30,
      // Notices are noise for a machine consumer: `stdout` must carry only the
      // command's JSON result.
      onnotice: () => {},
      ...options
    });
  }

  async query<T = unknown>(queryStr: string, params: unknown[] = []): Promise<T[]> {
    // postgres.js unsafe executes raw SQL with parameter bindings
    // biome-ignore lint/suspicious/noExplicitAny: external postgres.js unsafe bindings boundary
    const result = await this.client.unsafe(queryStr, params as any[]);
    return result as unknown as T[];
  }

  async queryOne<T = unknown>(queryStr: string, params: unknown[] = []): Promise<T | null> {
    const results = await this.query<T>(queryStr, params);
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
    const res = await this.client.begin(async (sqlTx) => {
      const txClient: DatabaseClient = {
        query: async <U = unknown>(q: string, p: unknown[] = []) => {
          // biome-ignore lint/suspicious/noExplicitAny: external postgres.js unsafe bindings boundary
          const res = await sqlTx.unsafe(q, p as any[]);
          return res as unknown as U[];
        },
        queryOne: async <U = unknown>(q: string, p: unknown[] = []) => {
          // biome-ignore lint/suspicious/noExplicitAny: external postgres.js unsafe bindings boundary
          const res = await sqlTx.unsafe(q, p as any[]);
          return (res[0] ?? null) as U | null;
        },
        sql: async <U = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
          const { text, params } = compileTaggedSql(strings, ...values);
          // biome-ignore lint/suspicious/noExplicitAny: external postgres.js unsafe bindings boundary
          const res = await sqlTx.unsafe(text, params as any[]);
          return res as unknown as U[];
        },
        sqlOne: async <U = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
          const { text, params } = compileTaggedSql(strings, ...values);
          // biome-ignore lint/suspicious/noExplicitAny: external postgres.js unsafe bindings boundary
          const res = await sqlTx.unsafe(text, params as any[]);
          return (res[0] ?? null) as U | null;
        },
        findMany: async <U = unknown>(table: string, options?: QueryOptions) => {
          const { sql, params } = compileSelect(table, options);
          const rows = await txClient.query<Record<string, unknown>>(sql, params);
          if (options?.join && options.join.length > 0) {
            return rows.map((r) => nestJoinedRow<U>(r, options.join));
          }
          return rows as unknown as U[];
        },
        findOne: async <U = unknown>(table: string, options?: QueryOptions) => {
          const opts = { ...options, limit: 1 };
          const { sql, params } = compileSelect(table, opts);
          const row = await txClient.queryOne<Record<string, unknown>>(sql, params);
          if (!row) return null;
          if (options?.join && options.join.length > 0) {
            return nestJoinedRow<U>(row, options.join);
          }
          return row as unknown as U;
        },
        insert: async <U = unknown>(table: string, data: Record<string, unknown>) => {
          const { sql, params } = compileInsert(table, data);
          const rows = await txClient.query<U>(sql, params);
          if (!rows || rows.length === 0) {
            throw new Error(`Failed to insert into ${table}: no row returned`);
          }
          return rows[0];
        },
        update: async <U = unknown>(table: string, data: Record<string, unknown>, where: WhereCondition) => {
          const { sql, params } = compileUpdate(table, data, where);
          return txClient.query<U>(sql, params);
        },
        delete: async (table: string, where: WhereCondition) => {
          const { sql, params } = compileDelete(table, where);
          const rows = await txClient.query(sql, params);
          return rows.length;
        },
        transaction: async <U>(subOp: (nestedTx: DatabaseClient) => Promise<U>) => {
          return await subOp(txClient);
        }
      };
      return await operation(txClient);
    });
    return res as T;
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
