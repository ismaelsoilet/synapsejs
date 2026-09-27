/**
 * SynapseJS - Schema Drift Detector
 *
 * Compares live database catalog (SQLite or PostgreSQL) against the declared
 * AST sliceSchema DDL contracts across the project.
 *
 * Pinpoints:
 * - Missing tables (declared in slice, not yet migrated)
 * - Missing columns (declared in slice, missing in DB)
 * - Orphan tables (exist in DB, not declared by any slice)
 */

import type { DatabaseClient } from '../core/database-client';
import { getDatabase } from '../core/database-factory';
import { PostgresDatabaseClient } from '../core/postgres-client';
import { type DatabaseCatalog, generateDatabaseSchemaCatalog } from './db-schema-generator';

export interface MissingTableInfo {
  table: string;
  sourceSlice?: string;
}

export interface MissingColumnInfo {
  table: string;
  column: string;
  expectedType: string;
}

export interface SchemaDriftReport {
  status: 'PASS' | 'DRIFT_DETECTED';
  totalDeclaredTables: number;
  totalLiveTables: number;
  drift: {
    missingTables: MissingTableInfo[];
    missingColumns: MissingColumnInfo[];
    orphanTables: string[];
  };
}

const IGNORED_TABLE_PATTERNS = [/^sqlite_/i, /^_synapse_/i, /^pg_/i, /^sql_/i];

function isIgnoredTable(name: string): boolean {
  return IGNORED_TABLE_PATTERNS.some((pat) => pat.test(name));
}

interface LiveColumn {
  name: string;
  type: string;
}

interface LiveTableSchema {
  name: string;
  columns: Map<string, LiveColumn>;
}

async function inspectLiveDatabase(db: DatabaseClient): Promise<Map<string, LiveTableSchema>> {
  const isPostgres = db instanceof PostgresDatabaseClient;
  const liveSchema = new Map<string, LiveTableSchema>();

  if (isPostgres) {
    const tables = await db.query<{ table_name: string }>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
    `);

    for (const t of tables) {
      const tName = t.table_name.toLowerCase();
      if (isIgnoredTable(tName)) continue;
      liveSchema.set(tName, { name: tName, columns: new Map() });
    }

    const columns = await db.query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
    `);

    for (const col of columns) {
      const tName = col.table_name.toLowerCase();
      const colName = col.column_name.toLowerCase();
      const tbl = liveSchema.get(tName);
      if (tbl) {
        tbl.columns.set(colName, {
          name: col.column_name,
          type: col.data_type
        });
      }
    }
  } else {
    // SQLite
    const tables = await db.query<{ name: string }>(`
      SELECT name 
      FROM sqlite_master 
      WHERE type = 'table'
    `);

    for (const t of tables) {
      const tName = t.name.toLowerCase();
      if (isIgnoredTable(tName)) continue;

      const colMap = new Map<string, LiveColumn>();
      const colInfo = await db.query<{ name: string; type: string }>(`
        PRAGMA table_info("${t.name}");
      `);

      for (const c of colInfo) {
        colMap.set(c.name.toLowerCase(), {
          name: c.name,
          type: c.type
        });
      }

      liveSchema.set(tName, { name: t.name, columns: colMap });
    }
  }

  return liveSchema;
}

/**
 * Checks for schema drift between AST slice schemas and a live database.
 */
export async function checkSchemaDrift(
  rootDir: string = process.cwd(),
  customDb?: DatabaseClient
): Promise<SchemaDriftReport> {
  const db = customDb || getDatabase();
  const catalog: DatabaseCatalog = generateDatabaseSchemaCatalog(rootDir);
  const liveTables = await inspectLiveDatabase(db);

  const missingTables: MissingTableInfo[] = [];
  const missingColumns: MissingColumnInfo[] = [];
  const orphanTables: string[] = [];

  const declaredTableNames = new Set<string>();

  for (const table of catalog.tables) {
    const tName = table.name.toLowerCase();
    declaredTableNames.add(tName);

    const liveTable = liveTables.get(tName);
    if (!liveTable) {
      missingTables.push({
        table: table.name,
        sourceSlice: table.sourceSlice
      });
      continue;
    }

    // Check columns
    for (const col of table.columns) {
      const colName = col.name.toLowerCase();
      if (!liveTable.columns.has(colName)) {
        missingColumns.push({
          table: table.name,
          column: col.name,
          expectedType: col.sqlType
        });
      }
    }
  }

  // Check for orphan tables
  for (const [liveName, tbl] of liveTables.entries()) {
    if (!declaredTableNames.has(liveName)) {
      orphanTables.push(tbl.name);
    }
  }

  const hasDrift = missingTables.length > 0 || missingColumns.length > 0 || orphanTables.length > 0;

  return {
    status: hasDrift ? 'DRIFT_DETECTED' : 'PASS',
    totalDeclaredTables: catalog.totalTables,
    totalLiveTables: liveTables.size,
    drift: {
      missingTables,
      missingColumns,
      orphanTables
    }
  };
}
