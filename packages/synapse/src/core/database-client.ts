/**
 * SynapseJS - Database Context & Query Builder Abstraction
 *
 * Provides a clean, type-safe persistence contract without reflection-based ORM bloat.
 * Compatible with raw parameterized SQL, Kysely, and Drizzle query builders.
 */

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseClient {
  /**
   * Execute parameterized SQL query with explicit generic return type.
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute single-row query, returning null if not found.
   */
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute command inside a database transaction boundary.
   */
  transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T>;
}

/**
 * In-memory Mock Database Client for deterministic testing and PBT (Fast-Check).
 */
export class MockDatabaseClient implements DatabaseClient {
  private tables: Map<string, Array<Record<string, unknown>>> = new Map();
  private queryHandlers: Array<{
    match: RegExp | string;
    handler: (params: unknown[]) => unknown[];
  }> = [];

  /** Every statement the client was asked to execute, in order. */
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  constructor(initialData?: Record<string, Array<Record<string, unknown>>>) {
    if (initialData) {
      for (const [table, rows] of Object.entries(initialData)) {
        this.tables.set(table, [...rows]);
      }
    }
  }

  onQuery(pattern: RegExp | string, handler: (params: unknown[]) => unknown[]): this {
    this.queryHandlers.push({ match: pattern, handler });
    return this;
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });

    for (const { match, handler } of this.queryHandlers) {
      const isMatch = typeof match === 'string' ? sql.includes(match) : match.test(sql);
      if (isMatch) {
        return handler(params) as T[];
      }
    }

    // Default mock response: empty set
    return [] as T[];
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  async transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T> {
    return operation(this);
  }
}
