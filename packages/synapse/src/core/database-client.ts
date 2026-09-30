/**
 * SynapseJS - Database Context & Query Builder Abstraction
 *
 * Provides a clean, type-safe persistence contract without reflection-based ORM bloat:
 * raw parameterized SQL plus a relational query builder, with no adapter for any other
 * query builder.
 */

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export function compileTaggedSql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): { text: string; params: unknown[] } {
  let text = '';
  const params: unknown[] = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }

  return { text, params };
}

import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  type JoinClause,
  nestJoinedRow,
  type QueryOptions,
  type WhereCondition,
  type WhereOperator
} from './query-builder';

export {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
  type JoinClause,
  nestJoinedRow,
  type QueryOptions,
  type WhereCondition,
  type WhereOperator
};

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
   * Execute Tagged Template Literal SQL query with auto-parameterization.
   */
  sql<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;

  /**
   * Execute Tagged Template Literal SQL query returning first row or null.
   */
  sqlOne<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | null>;

  /**
   * Declarative type-safe SELECT with parameterized filters, ordering and pagination.
   */
  findMany<T = unknown>(table: string, options?: QueryOptions): Promise<T[]>;

  /**
   * Declarative type-safe single-row SELECT, returning null if not found.
   */
  findOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null>;

  /**
   * Declarative type-safe INSERT returning the created row.
   */
  insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T>;

  /**
   * Declarative type-safe UPDATE with WHERE condition, returning modified rows.
   */
  update<T = unknown>(table: string, data: Record<string, unknown>, where: WhereCondition): Promise<T[]>;

  /**
   * Declarative type-safe DELETE with WHERE condition, returning number of affected rows.
   */
  delete(table: string, where: WhereCondition): Promise<number>;

  /**
   * Execute command inside a database transaction boundary.
   */
  transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T>;

  /**
   * Closes active connections or statement pools.
   */
  close?(): void | Promise<void>;
}

/**
 * In-memory Mock Database Client for deterministic testing and PBT (Fast-Check).
 */
/** Equality and `eq`/`in` matching, which is what the in-memory store can honour honestly. */
function rowMatchesCondition(row: Record<string, unknown>, where: WhereCondition): boolean {
  return Object.entries(where).every(([column, condition]) => {
    const value = row[column];

    if (condition !== null && typeof condition === 'object' && 'op' in (condition as Record<string, unknown>)) {
      const { op, val } = condition as { op: string; val: unknown };

      if (op === 'eq') return value === val;
      if (op === 'in') return Array.isArray(val) && val.includes(value);

      return false;
    }

    return value === condition;
  });
}

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

    // Default mock response: check if table matches initialData for SELECT queries
    if (/^\s*SELECT\b/i.test(sql)) {
      for (const [table, rows] of this.tables.entries()) {
        if (sql.includes(table)) {
          return [...rows] as unknown as T[];
        }
      }
    }

    // Default mock response: empty set
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
    const results = await this.query<Record<string, unknown>>(sql, params);
    let rows: Array<Record<string, unknown>> = results;

    if (rows.length === 0) {
      const inMemory = this.tables.get(table);
      if (inMemory) {
        rows = inMemory;
      }
    }

    if (options?.join && options.join.length > 0) {
      return rows.map((r) => nestJoinedRow<T>(r, options.join));
    }
    return rows as unknown as T[];
  }

  async findOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    const opts = { ...options, limit: 1 };
    const { sql, params } = compileSelect(table, opts);
    const result = await this.queryOne<Record<string, unknown>>(sql, params);
    let row: Record<string, unknown> | null = result;

    if (row === null) {
      const inMemory = this.tables.get(table);
      if (inMemory && inMemory.length > 0) {
        row = inMemory[0];
      }
    }

    if (!row) return null;
    if (options?.join && options.join.length > 0) {
      return nestJoinedRow<T>(row, options.join);
    }
    return row as unknown as T;
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    const { sql, params } = compileInsert(table, data);
    const results = await this.query<T>(sql, params);
    if (results.length > 0) {
      return results[0];
    }

    const tableRows = this.tables.get(table) || [];
    const created = { ...data };
    tableRows.push(created);
    this.tables.set(table, tableRows);
    return created as T;
  }

  async update<T = unknown>(table: string, data: Record<string, unknown>, where: WhereCondition): Promise<T[]> {
    const { sql, params } = compileUpdate(table, data, where);
    const results = await this.query<T>(sql, params);

    if (results.length > 0) {
      return results;
    }

    // No row matched, so no row is returned: reporting the payload back would be a
    // write that never happened.
    const rows = this.tables.get(table);

    if (!rows) {
      return [];
    }

    const updated = rows.filter((row) => rowMatchesCondition(row, where));
    for (const row of updated) {
      Object.assign(row, data);
    }

    return updated as unknown as T[];
  }

  async delete(table: string, where: WhereCondition): Promise<number> {
    const { sql, params } = compileDelete(table, where);
    const results = await this.query(sql, params);

    if (results.length > 0) {
      return results.length;
    }

    // A delete that matched nothing removed nothing.
    const rows = this.tables.get(table);

    if (!rows) {
      return 0;
    }

    const survivors = rows.filter((row) => !rowMatchesCondition(row, where));
    const removed = rows.length - survivors.length;
    this.tables.set(table, survivors);

    return removed;
  }

  async transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T> {
    const snapshot = new Map(
      Array.from(this.tables.entries()).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
    );

    try {
      return await operation(this);
    } catch (error) {
      // A rolled-back transaction discards the writes made inside it.
      this.tables = snapshot;
      throw error;
    }
  }

  close(): void {}
}
