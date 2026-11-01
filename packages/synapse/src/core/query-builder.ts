/**
 * SynapseJS - Isomorphic Query Builder & SQL Compiler
 *
 * Compiles declarative filter criteria, sorting, pagination and mutations
 * into parameterized SQL ($1, $2, ...) compatible with both SQLite and PostgreSQL.
 * Immune to SQL injection and free of heavy ORM runtime overhead.
 */

export type WhereOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'ILIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN';

export interface WhereClauseItem {
  column: string;
  op: WhereOperator;
  value?: unknown;
}

export type WhereCondition = Record<string, unknown> | WhereClauseItem[];

export interface JoinClause {
  table: string;
  on: Record<string, string>;
  type?: 'LEFT' | 'INNER' | 'RIGHT';
  select?: string[];
  as?: string;
}

export interface AggregateItem {
  fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  column?: string;
  as?: string;
}

export interface HavingAggregateCondition {
  fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  column?: string;
  op: WhereOperator;
  value?: unknown;
}

export type HavingInput = WhereCondition | HavingAggregateCondition | HavingAggregateCondition[];

export interface QueryOptions<T = Record<string, unknown>> {
  select?: Array<keyof T | string>;
  distinct?: boolean;
  aggregations?: AggregateItem[];
  where?: WhereCondition;
  join?: JoinClause[];
  groupBy?: string[] | string;
  having?: HavingInput;
  orderBy?: Record<string, 'asc' | 'desc' | 'ASC' | 'DESC'> | string;
  limit?: number;
  offset?: number;
}

/** Sanitize SQL identifiers (table names, column names) to avoid injection */
export function sanitizeIdentifier(ident: string): string {
  const trimmed = ident.trim();
  if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)?$/.test(trimmed)) {
    throw new Error(`Invalid SQL identifier: "${ident}"`);
  }
  return trimmed;
}

const VALID_WHERE_OPERATORS = new Set<string>([
  '=',
  '!=',
  '<>',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'ILIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
  'BETWEEN'
]);

const VALID_AGGREGATE_FUNCTIONS = new Set<string>(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

export function sanitizeOperator(op: string): WhereOperator {
  const normalized = op.trim().toUpperCase();
  if (!VALID_WHERE_OPERATORS.has(normalized)) {
    throw new Error(`Invalid SQL operator: "${op}"`);
  }
  return normalized as WhereOperator;
}

/** Normalize WhereCondition into an array of WhereClauseItem */
function normalizeWhere(where?: WhereCondition): WhereClauseItem[] {
  if (!where) return [];

  if (Array.isArray(where)) {
    return where;
  }

  const items: WhereClauseItem[] = [];
  for (const [column, value] of Object.entries(where)) {
    if (value === null || value === undefined) {
      items.push({ column, op: 'IS NULL' });
    } else if (Array.isArray(value)) {
      items.push({ column, op: 'IN', value });
    } else if (typeof value === 'object' && value !== null && 'op' in value) {
      const cond = value as { op: string; val?: unknown; value?: unknown };
      items.push({
        column,
        op: cond.op as WhereOperator,
        value: cond.val !== undefined ? cond.val : cond.value
      });
    } else {
      items.push({ column, op: '=', value });
    }
  }
  return items;
}

/** Compiles one expression and its operator into a parameterized SQL condition. */
function compileCondition(expression: string, op: string, value: unknown, params: unknown[]): string {
  const normalized = sanitizeOperator(op);

  if (normalized === 'IS NULL' || normalized === 'IS NOT NULL') {
    return `${expression} ${normalized}`;
  }

  if (normalized === 'IN' || normalized === 'NOT IN') {
    const arr = Array.isArray(value) ? value : [value];
    if (arr.length === 0) {
      return normalized === 'IN' ? '1=0' : '1=1';
    }

    const placeholders = arr.map((entry) => {
      params.push(entry);
      return `$${params.length}`;
    });

    return `${expression} ${normalized} (${placeholders.join(', ')})`;
  }

  if (normalized === 'BETWEEN') {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length !== 2) {
      throw new Error(`BETWEEN operator requires an array of 2 values, received: ${JSON.stringify(value)}`);
    }

    params.push(arr[0]);
    const p1 = `$${params.length}`;
    params.push(arr[1]);
    const p2 = `$${params.length}`;
    return `${expression} BETWEEN ${p1} AND ${p2}`;
  }

  params.push(value);
  return `${expression} ${normalized} $${params.length}`;
}

/** Compiles WhereClauseItem array into parameterized SQL condition strings */
export function compileWhereClauses(whereItems: WhereClauseItem[], params: unknown[]): string[] {
  return whereItems.map((item) => compileCondition(sanitizeIdentifier(item.column), item.op, item.value, params));
}

/**
 * Compiles HAVING conditions. A condition that names an aggregation alias is
 * compiled as the aggregate expression, so PostgreSQL (which rejects output
 * aliases in HAVING) and SQLite receive the same portable SQL.
 */
function compileHaving(
  having: HavingInput,
  aggregations: AggregateItem[],
  groupBy: string[] | string | undefined,
  params: unknown[]
): string[] {
  const aliases = new Map<string, string>();
  const groupedColumns = new Set<string>();

  if (groupBy) {
    const columns = Array.isArray(groupBy) ? groupBy : groupBy.split(',').map((column) => column.trim());
    for (const column of columns) {
      groupedColumns.add(sanitizeIdentifier(column.trim()));
    }
  }

  for (const aggregation of aggregations) {
    const fn = aggregation.fn.toUpperCase();
    if (!VALID_AGGREGATE_FUNCTIONS.has(fn)) {
      throw new Error(`Invalid aggregate function: "${aggregation.fn}"`);
    }

    const column = aggregation.column?.trim() || '*';
    const expression = `${fn}(${column === '*' ? '*' : sanitizeIdentifier(column)})`;

    if (aggregation.as) {
      aliases.set(aggregation.as, expression);
    }
  }

  const items: Array<WhereClauseItem | HavingAggregateCondition> = Array.isArray(having)
    ? having
    : typeof having === 'object' && having !== null && 'fn' in having
      ? [having as HavingAggregateCondition]
      : normalizeWhere(having as WhereCondition);

  const conditions: string[] = [];

  for (const item of items) {
    if ('fn' in item) {
      const fn = item.fn.toUpperCase();
      if (!VALID_AGGREGATE_FUNCTIONS.has(fn)) {
        throw new Error(`Invalid aggregate function: "${item.fn}"`);
      }

      const column = item.column?.trim() || '*';
      const expression = `${fn}(${column === '*' ? '*' : sanitizeIdentifier(column)})`;
      conditions.push(compileCondition(expression, item.op, item.value, params));
      continue;
    }

    const aliasExpression = aliases.get(item.column);
    const column = sanitizeIdentifier(item.column);

    if (!aliasExpression && !groupedColumns.has(column)) {
      throw new Error(`Invalid HAVING column: "${item.column}" must be a groupBy column or an aggregation alias`);
    }

    conditions.push(compileCondition(aliasExpression ?? column, item.op, item.value, params));
  }

  return conditions;
}

/**
 * Maps flat prefixed columns (e.g. "customer_name") into nested objects ({ customer: { name } })
 */
export function nestJoinedRow<T>(row: Record<string, unknown>, joins?: JoinClause[]): T {
  if (!joins || joins.length === 0 || !row || typeof row !== 'object') {
    return row as T;
  }

  const result: Record<string, unknown> = { ...row };

  for (const j of joins) {
    const alias = j.as || j.table;
    const prefix = `${alias}_`;
    const nestedObj: Record<string, unknown> = {};
    let hasNestedFields = false;

    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(prefix)) {
        const fieldName = key.slice(prefix.length);
        nestedObj[fieldName] = value;
        hasNestedFields = true;
      }
    }

    if (hasNestedFields) {
      result[alias] = nestedObj;
    }
  }

  return result as T;
}

/**
 * Compiles a SELECT query with parameterized filters, joins, order, limit, and offset.
 */
export function compileSelect(table: string, options?: QueryOptions): { sql: string; params: unknown[] } {
  const safeTable = sanitizeIdentifier(table);
  const params: unknown[] = [];

  // 1. SELECT columns
  const selectCols: string[] = [];
  if (options?.select && options.select.length > 0) {
    selectCols.push(
      ...options.select.map((col) => {
        const safeCol = sanitizeIdentifier(String(col));
        if (options?.join && options.join.length > 0 && !safeCol.includes('.')) {
          return `${safeTable}.${safeCol} AS "${safeCol}"`;
        }
        return safeCol;
      })
    );
  }

  // Handle explicit aggregations
  if (options?.aggregations && options.aggregations.length > 0) {
    for (const agg of options.aggregations) {
      const fn = agg.fn.toUpperCase();
      if (!VALID_AGGREGATE_FUNCTIONS.has(fn)) {
        throw new Error(`Invalid aggregate function: "${agg.fn}"`);
      }
      const rawCol = agg.column?.trim() || '*';
      const col = rawCol === '*' ? '*' : sanitizeIdentifier(rawCol);
      const alias = agg.as ? ` AS "${sanitizeIdentifier(agg.as)}"` : '';
      selectCols.push(`${fn}(${col})${alias}`);
    }
  }

  if (selectCols.length === 0) {
    if (!options?.join || options.join.length === 0) {
      selectCols.push('*');
    } else {
      selectCols.push(`${safeTable}.*`);
    }
  }

  // Handle joins
  const joinClauses: string[] = [];
  if (options?.join && options.join.length > 0) {
    for (const j of options.join) {
      const joinType = (j.type || 'LEFT').toUpperCase();
      if (!['LEFT', 'INNER', 'RIGHT'].includes(joinType)) {
        throw new Error(`Unsupported JOIN type: "${j.type}"`);
      }
      const joinTable = sanitizeIdentifier(j.table);
      const joinAlias = j.as ? sanitizeIdentifier(j.as) : joinTable;
      const targetTableClause = j.as ? `${joinTable} AS ${joinAlias}` : joinTable;

      const onConditions: string[] = [];
      for (const [leftCol, rightCol] of Object.entries(j.on)) {
        const left = sanitizeIdentifier(leftCol.includes('.') ? leftCol : `${safeTable}.${leftCol}`);
        const right = sanitizeIdentifier(rightCol.includes('.') ? rightCol : `${joinAlias}.${rightCol}`);
        onConditions.push(`${left} = ${right}`);
      }

      joinClauses.push(`${joinType} JOIN ${targetTableClause} ON ${onConditions.join(' AND ')}`);

      if (j.select && j.select.length > 0) {
        for (const col of j.select) {
          const safeCol = sanitizeIdentifier(col);
          const qualifiedCol = col.includes('.') ? safeCol : `${joinAlias}.${safeCol}`;
          const alias = `${joinAlias}_${col.replace('.', '_')}`;
          selectCols.push(`${qualifiedCol} AS "${alias}"`);
        }
      }
    }
  }

  const distinctPrefix = options?.distinct ? 'DISTINCT ' : '';
  let sql = `SELECT ${distinctPrefix}${selectCols.join(', ')} FROM ${safeTable}`;
  if (joinClauses.length > 0) {
    sql += ` ${joinClauses.join(' ')}`;
  }

  // 2. WHERE clause
  const whereItems = normalizeWhere(options?.where);
  if (whereItems.length > 0) {
    const conditions = compileWhereClauses(whereItems, params);
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
  }

  // 3. GROUP BY clause
  if (options?.groupBy) {
    const groupCols = Array.isArray(options.groupBy)
      ? options.groupBy
      : options.groupBy.split(',').map((c) => c.trim());
    const safeGroupCols = groupCols.map((c) => sanitizeIdentifier(c.trim())).filter(Boolean);
    if (safeGroupCols.length > 0) {
      sql += ` GROUP BY ${safeGroupCols.join(', ')}`;
    }
  }

  // 4. HAVING clause
  if (options?.having) {
    const conditions = compileHaving(options.having, options.aggregations ?? [], options.groupBy, params);
    if (conditions.length > 0) {
      sql += ` HAVING ${conditions.join(' AND ')}`;
    }
  }

  // 3. ORDER BY clause
  if (options?.orderBy) {
    if (typeof options.orderBy === 'string') {
      const parts = options.orderBy.split(',').map((part) => {
        const [col, dir] = part.trim().split(/\s+/);
        const safeCol = sanitizeIdentifier(col);
        const safeDir = dir && dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        return `${safeCol} ${safeDir}`;
      });
      sql += ` ORDER BY ${parts.join(', ')}`;
    } else {
      const parts = Object.entries(options.orderBy).map(([col, dir]) => {
        const safeCol = sanitizeIdentifier(col);
        const safeDir = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        return `${safeCol} ${safeDir}`;
      });
      if (parts.length > 0) {
        sql += ` ORDER BY ${parts.join(', ')}`;
      }
    }
  }

  // 4. LIMIT & OFFSET
  if (typeof options?.limit === 'number' && options.limit >= 0) {
    params.push(options.limit);
    sql += ` LIMIT $${params.length}`;
  }

  if (typeof options?.offset === 'number' && options.offset >= 0) {
    params.push(options.offset);
    sql += ` OFFSET $${params.length}`;
  }

  return { sql, params };
}

/**
 * Compiles an INSERT query returning the created row.
 */
export function compileInsert(table: string, data: Record<string, unknown>): { sql: string; params: unknown[] } {
  const safeTable = sanitizeIdentifier(table);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error(`Cannot insert empty record into ${table}`);
  }

  const columns = keys.map(sanitizeIdentifier);
  const params: unknown[] = [];
  const placeholders = keys.map((key) => {
    params.push(data[key]);
    return `$${params.length}`;
  });

  const sql = `INSERT INTO ${safeTable} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *;`;
  return { sql, params };
}

/**
 * Compiles an UPDATE query returning the modified rows.
 */
export function compileUpdate(
  table: string,
  data: Record<string, unknown>,
  where: WhereCondition
): { sql: string; params: unknown[] } {
  const safeTable = sanitizeIdentifier(table);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error(`Cannot update record in ${table} with empty data`);
  }

  const params: unknown[] = [];
  const setClauses = keys.map((key) => {
    params.push(data[key]);
    return `${sanitizeIdentifier(key)} = $${params.length}`;
  });

  let sql = `UPDATE ${safeTable} SET ${setClauses.join(', ')}`;

  const whereItems = normalizeWhere(where);
  if (whereItems.length === 0) {
    throw new Error(`Unconditional UPDATE on ${table} is blocked for safety. Provide a WHERE condition.`);
  }

  const conditions = compileWhereClauses(whereItems, params);
  sql += ` WHERE ${conditions.join(' AND ')} RETURNING *;`;
  return { sql, params };
}

/**
 * Compiles a DELETE query returning count/rows.
 */
export function compileDelete(table: string, where: WhereCondition): { sql: string; params: unknown[] } {
  const safeTable = sanitizeIdentifier(table);
  const whereItems = normalizeWhere(where);
  if (whereItems.length === 0) {
    throw new Error(`Unconditional DELETE on ${table} is blocked for safety. Provide a WHERE condition.`);
  }

  const params: unknown[] = [];
  const conditions = compileWhereClauses(whereItems, params);
  const sql = `DELETE FROM ${safeTable} WHERE ${conditions.join(' AND ')} RETURNING *;`;
  return { sql, params };
}
