/**
 * SynapseJS - Centralized Database Schema Generator
 *
 * Inspects all sliceSchema DDL contracts across the project, parses table definitions,
 * column types, primary keys and foreign keys, and generates a clean, compilable
 * TypeScript declaration catalog at `.codebase/db-schema.d.ts`.
 *
 * This provides 100% type visibility to both AI agents and human developers
 * without requiring heavy ORMs or external database connections.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { extractSliceSchema } from './migration-runner';
import { orderSlicesByDag } from './schema-dag';
import { findSliceFiles, resolveSlicesDir } from './slice-discovery';

export interface ColumnDefinition {
  name: string;
  sqlType: string;
  tsType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  references?: { table: string; column: string };
}

export interface TableDefinition {
  name: string;
  interfaceName: string;
  columns: ColumnDefinition[];
  sourceSlice?: string;
}

export interface DatabaseCatalog {
  tables: TableDefinition[];
  totalTables: number;
  totalColumns: number;
}

/** Converts snake_case or kebab-case to PascalCase */
export function toPascalCase(str: string): string {
  return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase()).replace(/^(\w)/, (_, c) => c.toUpperCase());
}

/** Maps SQL column types to strict TypeScript types */
export function mapSqlTypeToTs(sqlType: string): string {
  const upper = sqlType.toUpperCase().trim();

  if (
    upper.startsWith('TEXT') ||
    upper.startsWith('VARCHAR') ||
    upper.startsWith('CHAR') ||
    upper.startsWith('UUID') ||
    upper.startsWith('STRING')
  ) {
    return 'string';
  }

  if (
    upper.startsWith('INT') ||
    upper.startsWith('BIGINT') ||
    upper.startsWith('SMALLINT') ||
    upper.startsWith('SERIAL') ||
    upper.startsWith('REAL') ||
    upper.startsWith('FLOAT') ||
    upper.startsWith('DOUBLE') ||
    upper.startsWith('NUMERIC') ||
    upper.startsWith('DECIMAL')
  ) {
    return 'number';
  }

  if (upper.startsWith('BOOL')) {
    return 'boolean';
  }

  if (
    upper.startsWith('TIMESTAMP') ||
    upper.startsWith('DATETIME') ||
    upper.startsWith('DATE') ||
    upper.startsWith('TIME')
  ) {
    return 'string';
  }

  if (upper.startsWith('JSON')) {
    return 'Record<string, unknown> | unknown[]';
  }

  if (upper.startsWith('BLOB') || upper.startsWith('BYTEA')) {
    return 'Uint8Array';
  }

  return 'unknown';
}

/**
 * Splits column definitions inside CREATE TABLE (...) accounting for nested parentheses.
 */
function splitColumnDefinitions(body: string): string[] {
  const defs: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      if (current.trim().length > 0) {
        defs.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) {
    defs.push(current.trim());
  }

  return defs;
}

/** Index of the `)` matching the `(` at `openIndex`, or -1. Linear in the input. */
function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < text.length; index++) {
    const char = text[index];

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * Parses DDL string to extract all table and column definitions.
 *
 * The header is matched first and the column body is delimited by scanning for the
 * matching parenthesis. The previous single-pattern form (`([\s\S]*?)\)(?:\s*;|\s*$)`)
 * backtracked quadratically on a large DDL.
 */
export function parseDdlToCatalog(ddl: string, sourceSlice?: string): TableDefinition[] {
  const tables: TableDefinition[] = [];
  const createTableHeader = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?\s*\(/gi;

  let header: RegExpExecArray | null = createTableHeader.exec(ddl);

  while (header !== null) {
    const openParen = header.index + header[0].length - 1;
    const closeParen = findMatchingParen(ddl, openParen);

    if (closeParen === -1) {
      break;
    }

    const tableName = header[1].toLowerCase();
    const body = ddl.slice(openParen + 1, closeParen);
    const rawDefs = splitColumnDefinitions(body);
    const columns: ColumnDefinition[] = [];

    for (const def of rawDefs) {
      const cleanDef = def.replace(/\s+/g, ' ').trim();
      const upperDef = cleanDef.toUpperCase();

      // Skip table-level constraints like PRIMARY KEY (a, b) or FOREIGN KEY (...)
      if (
        upperDef.startsWith('PRIMARY KEY') ||
        upperDef.startsWith('FOREIGN KEY') ||
        upperDef.startsWith('CONSTRAINT') ||
        upperDef.startsWith('CHECK') ||
        upperDef.startsWith('UNIQUE')
      ) {
        continue;
      }

      // First token is column name, second token is type
      const tokens = cleanDef.split(' ');
      if (tokens.length < 2) continue;

      const colName = tokens[0].replace(/["'`]/g, '');
      const sqlType = tokens[1].replace(/["'`]/g, '');
      const tsType = mapSqlTypeToTs(sqlType);

      const isPrimaryKey = upperDef.includes('PRIMARY KEY');
      const isNotNull = upperDef.includes('NOT NULL') || isPrimaryKey;
      const isUnique = upperDef.includes('UNIQUE') || isPrimaryKey;

      let references: { table: string; column: string } | undefined;
      const refMatch = /REFERENCES\s+["'`]?([a-zA-Z0-9_]+)["'`]?\s*(?:\(["'`]?([a-zA-Z0-9_]+)["'`]?\))?/i.exec(
        cleanDef
      );
      if (refMatch) {
        references = {
          table: refMatch[1].toLowerCase(),
          column: refMatch[2] ? refMatch[2].toLowerCase() : 'id'
        };
      }

      columns.push({
        name: colName,
        sqlType,
        tsType,
        isNullable: !isNotNull,
        isPrimaryKey,
        isUnique,
        references
      });
    }

    tables.push({
      name: tableName,
      interfaceName: `Db${toPascalCase(tableName)}`,
      columns,
      sourceSlice
    });

    createTableHeader.lastIndex = closeParen + 1;
    header = createTableHeader.exec(ddl);
  }

  return tables;
}

/**
 * Scans a project directory, parses all slice schemas, and generates .codebase/db-schema.d.ts
 */
export function generateDatabaseSchemaCatalog(rootDir: string, outputFile?: string): DatabaseCatalog {
  const targetOutput = outputFile || path.join(rootDir, '.codebase/db-schema.d.ts');
  const allTables: Map<string, TableDefinition> = new Map();

  const slicesRes = resolveSlicesDir(rootDir);
  if (slicesRes.ok) {
    const sliceFiles = findSliceFiles(slicesRes.value.slicesDir);
    const sortedFiles = orderSlicesByDag(sliceFiles);

    for (const filePath of sortedFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const ddl = extractSliceSchema(sourceFile);
        if (ddl) {
          const sliceName = path.basename(filePath, '.slice.tsx');
          const tables = parseDdlToCatalog(ddl, sliceName);
          for (const table of tables) {
            // Merge or set table
            if (!allTables.has(table.name)) {
              allTables.set(table.name, table);
            } else {
              // Merge columns if table defined across slices
              const existing = allTables.get(table.name);
              if (existing) {
                for (const col of table.columns) {
                  if (!existing.columns.some((c) => c.name === col.name)) {
                    existing.columns.push(col);
                  }
                }
              }
            }
          }
        }
      } catch {
        // Skip unreadable slices gracefully
      }
    }
  }

  const tablesArray = Array.from(allTables.values());
  let totalColumns = 0;
  for (const t of tablesArray) {
    totalColumns += t.columns.length;
  }

  // Generate TypeScript declaration code
  let dtsContent = `/**\n`;
  dtsContent += ` * [SYNAPSE-JS AUTO-GENERATED DATABASE SCHEMA CATALOG]\n`;
  dtsContent += ` * Provides 100% type-safe table and column definitions extracted directly from slice DDLs.\n`;
  dtsContent += ` * Regenerate with 'synapse skeleton' or 'synapse db-schema'. DO NOT EDIT MANUALLY.\n`;
  dtsContent += ` */\n\n`;

  for (const table of tablesArray) {
    dtsContent += `export interface ${table.interfaceName} {\n`;
    for (const col of table.columns) {
      const opt = col.isNullable ? '?' : '';
      const nullType = col.isNullable ? ' | null' : '';
      const comment = col.isPrimaryKey
        ? ' /** Primary Key */'
        : col.references
          ? ` /** Foreign Key -> ${col.references.table}.${col.references.column} */`
          : '';
      dtsContent += `  ${col.name}${opt}: ${col.tsType}${nullType};${comment}\n`;
    }
    dtsContent += `}\n\n`;
  }

  dtsContent += `export interface DatabaseSchema {\n`;
  for (const table of tablesArray) {
    dtsContent += `  ${table.name}: ${table.interfaceName};\n`;
  }
  dtsContent += `}\n\n`;

  dtsContent += `export type TableName = keyof DatabaseSchema;\n`;
  dtsContent += `export type Row<T extends TableName> = DatabaseSchema[T];\n`;

  // Write output file
  const outDir = path.dirname(targetOutput);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(targetOutput, dtsContent, 'utf-8');

  return {
    tables: tablesArray,
    totalTables: tablesArray.length,
    totalColumns
  };
}

export const generateDbSchemaCatalog = generateDatabaseSchemaCatalog;
