/**
 * SynapseJS - PostgreSQL Database Driver (postgres.js)
 *
 * Provides production-ready, pooled, high-performance PostgreSQL persistence
 * implementing the core DatabaseClient contract.
 */

import postgres from 'postgres';
import { compileTaggedSql, type DatabaseClient } from './database-client';

export class PostgresDatabaseClient implements DatabaseClient {
  private client: postgres.Sql;

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

  async transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T> {
    const res = await this.client.begin(async (sqlTx) => {
      const txClient: DatabaseClient = {
        query: async <U = unknown>(q: string, p: unknown[] = []) => {
          const res = await sqlTx.unsafe(q, p as any[]);
          return res as unknown as U[];
        },
        queryOne: async <U = unknown>(q: string, p: unknown[] = []) => {
          const res = await sqlTx.unsafe(q, p as any[]);
          return (res[0] ?? null) as U | null;
        },
        sql: async <U = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
          const { text, params } = compileTaggedSql(strings, ...values);
          const res = await sqlTx.unsafe(text, params as any[]);
          return res as unknown as U[];
        },
        sqlOne: async <U = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
          const { text, params } = compileTaggedSql(strings, ...values);
          const res = await sqlTx.unsafe(text, params as any[]);
          return (res[0] ?? null) as U | null;
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
