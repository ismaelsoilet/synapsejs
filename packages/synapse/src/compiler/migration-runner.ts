/**
 * SynapseJS - Declarative AST Slice Migration Runner
 *
 * Auto-discovers 'sliceSchema' DDL definitions co-located in *.slice.tsx files
 * and applies them idempotently to the active database (SQLite or PostgreSQL).
 * Preserves Locality of Behavior (LoB): each slice owns its own table contracts!
 */

import { type AbortGateResult, shouldAbortTrajectory } from '@ismaelsoilet/jev-harness';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { DatabaseClient } from '../core/database-client';
import { getDatabase } from '../core/index';
import { PostgresDatabaseClient } from '../core/postgres-client';
import { orderSlicesByDag } from './schema-dag';
import { findSliceFiles, resolveSlicesDir, type SlicesDirErrorCode } from './slice-discovery';

export interface MigrationResult {
  slice: string;
  filePath: string;
  status: 'APPLIED' | 'SKIPPED' | 'FAILED';
  /** Statements actually executed in this run (0 for a skipped slice). */
  statementsApplied: number;
  error?: string;
}

export interface MigrationReport {
  status: 'PASS' | 'FAIL';
  totalDiscovered: number;
  appliedCount: number;
  skippedCount: number;
  statementsApplied: number;
  migrations: MigrationResult[];
  code?: SlicesDirErrorCode;
  message?: string;
  candidates?: string[];
  abortSignal?: AbortGateResult;
}

export interface BidirectionalDdl {
  upDdl: string;
  downDdl: string | null;
}

export interface RollbackResult {
  slice: string;
  status: 'ROLLED_BACK' | 'FAILED' | 'SKIPPED';
  statementsRolledBack: number;
  error?: string;
}

export interface RollbackReport {
  status: 'PASS' | 'FAIL';
  totalRolledBack: number;
  rollbacks: RollbackResult[];
  message?: string;
}

export interface RollbackOptions {
  targetSlice?: string;
  steps?: number;
}

export function parseBidirectionalDdl(rawDdl: string): BidirectionalDdl {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;
  let splitIndex = -1;
  let matchLength = 0;

  let i = 0;
  while (i < rawDdl.length) {
    const char = rawDdl[i];
    const next = rawDdl[i + 1] ?? '';

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (inSingleQuote) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === "'") {
        if (next === "'") {
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        if (next === '"') {
          i += 2;
          continue;
        }
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (dollarTag !== null) {
      if (char === '$' && rawDdl.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      i++;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      i++;
      continue;
    }

    if (char === '$') {
      const match = rawDdl.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        i += dollarTag.length;
        continue;
      }
    }

    // Check for -- down: marker at beginning of line outside strings/comments
    const isLineStart = i === 0 || rawDdl[i - 1] === '\n';
    if (isLineStart) {
      const lineSlice = rawDdl.slice(i);
      const match = lineSlice.match(/^[ \t]*--\s*down:?[ \t]*(?:\r?\n|$)/i);
      if (match) {
        splitIndex = i;
        matchLength = match[0].length;
        break;
      }
    }

    i++;
  }

  if (splitIndex === -1) {
    return { upDdl: rawDdl.trim(), downDdl: null };
  }

  const upDdl = rawDdl.slice(0, splitIndex).trim();
  const downDdl = rawDdl.slice(splitIndex + matchLength).trim();
  return {
    upDdl,
    downDdl: downDdl.length > 0 ? downDdl : null
  };
}

function hashStatement(statement: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(statement);
  return hasher.digest('hex');
}

export function splitStatements(ddl: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;
  let beginDepth = 0;

  let i = 0;
  while (i < ddl.length) {
    const char = ddl[i];
    const next = ddl[i + 1] ?? '';

    // Handle line comment (-- ...)
    if (inLineComment) {
      current += char;
      if (char === '\n') {
        inLineComment = false;
      }
      i++;
      continue;
    }

    // Handle block comment (/* ... */)
    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Handle single quote string ('...')
    if (inSingleQuote) {
      current += char;
      if (char === '\\') {
        current += next;
        i += 2;
        continue;
      }
      if (char === "'") {
        if (next === "'") {
          current += next;
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    // Handle double quote identifier ("...")
    if (inDoubleQuote) {
      current += char;
      if (char === '"') {
        if (next === '"') {
          current += next;
          i += 2;
          continue;
        }
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    // Handle dollar-quoted string ($tag$ ... $tag$)
    if (dollarTag !== null) {
      current += char;
      if (char === '$' && ddl.startsWith(dollarTag, i)) {
        current += dollarTag.slice(1);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    // Check transitions from normal state:
    if (char === '-' && next === '-') {
      inLineComment = true;
      current += '--';
      i += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      current += '/*';
      i += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += "'";
      i++;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += '"';
      i++;
      continue;
    }

    if (char === '$') {
      const match = ddl.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    // Track BEGIN ... END blocks (e.g. triggers, compound statements)
    const remaining = ddl.slice(i);
    const prevChar = i > 0 ? ddl[i - 1] : ' ';
    const isWordStart = /[\s,;(]/.test(prevChar);

    if (isWordStart) {
      const beginMatch = remaining.match(/^BEGIN\b/i);
      if (beginMatch) {
        beginDepth++;
        current += beginMatch[0];
        i += beginMatch[0].length;
        continue;
      }

      const endMatch = remaining.match(/^END\b/i);
      if (endMatch) {
        if (beginDepth > 0) beginDepth--;
        current += endMatch[0];
        i += endMatch[0].length;
        continue;
      }
    }

    // Statement terminator outside strings or comments, but only when not inside a BEGIN...END block
    if (char === ';' && beginDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

export function extractSliceSchema(sourceFile: ts.SourceFile): string | null {
  let ddl: string | null = null;
  ts.forEachChild(sourceFile, (node) => {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (isExported && ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const varName = decl.name.getText(sourceFile);
        if (varName === 'sliceSchema' && decl.initializer) {
          if (ts.isStringLiteral(decl.initializer) || ts.isNoSubstitutionTemplateLiteral(decl.initializer)) {
            ddl = decl.initializer.text.trim();
          } else if (ts.isTemplateExpression(decl.initializer)) {
            let fullText = decl.initializer.head.text;
            for (const span of decl.initializer.templateSpans) {
              if (ts.isStringLiteral(span.expression) || ts.isNoSubstitutionTemplateLiteral(span.expression)) {
                fullText += span.expression.text;
              } else {
                fullText += span.expression.getText(sourceFile).replace(/^['"`]|['"`]$/g, '');
              }
              fullText += span.literal.text;
            }
            ddl = fullText.trim();
          }
        }
      }
    }
  });
  return ddl;
}

export interface RunMigrationsOptions {
  /** Consult the Jev abort gate after a failure (default: disabled). */
  enableJevGate?: boolean;
}

export async function runSliceMigrations(
  baseDir: string = process.cwd(),
  customDb?: DatabaseClient,
  options: RunMigrationsOptions = {}
): Promise<MigrationReport> {
  const db = customDb || getDatabase();
  const isPostgres = db instanceof PostgresDatabaseClient;
  const SYNAPSE_MIGRATION_LOCK_ID = 82910471;

  if (isPostgres) {
    await db.query(`SELECT pg_advisory_lock(${SYNAPSE_MIGRATION_LOCK_ID});`);
  }

  try {
    // Ensure migrations tracking table exists.
    // TIMESTAMP is accepted by both SQLite and PostgreSQL; DATETIME is SQLite-only.
    await db.query(`
      CREATE TABLE IF NOT EXISTS _synapse_migrations (
        slice_name TEXT PRIMARY KEY,
        schema_hash TEXT NOT NULL,
        down_ddl TEXT,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await db.query(`ALTER TABLE _synapse_migrations ADD COLUMN down_ddl TEXT;`);
    } catch (_) {}

    // Progresso por statement, não por fatia: sem isso, um `ALTER TABLE` registrado
    // uma vez volta a rodar na próxima edição do DDL e falha para sempre
    // ("duplicate column name"). Com o histórico por statement, cada um roda uma
    // única vez e evoluir o schema passa a ser só declarar a mudança.
    await db.query(`
    CREATE TABLE IF NOT EXISTS _synapse_migration_statements (
      slice_name TEXT NOT NULL,
      statement_hash TEXT NOT NULL,
      down_statement TEXT,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (slice_name, statement_hash)
    );
  `);

    try {
      await db.query(`ALTER TABLE _synapse_migration_statements ADD COLUMN down_statement TEXT;`);
    } catch (_) {}

    const resolution = resolveSlicesDir(baseDir);
    if (!resolution.ok) {
      return {
        status: 'FAIL',
        totalDiscovered: 0,
        appliedCount: 0,
        skippedCount: 0,
        statementsApplied: 0,
        migrations: [],
        code: resolution.error.code,
        message: resolution.error.message,
        candidates: resolution.error.candidates
      };
    }

    const sliceFiles = orderSlicesByDag(findSliceFiles(resolution.value.slicesDir));
    const migrations: MigrationResult[] = [];
    let appliedCount = 0;
    let skippedCount = 0;
    let statementsAppliedTotal = 0;
    let hasFailure = false;

    for (const filePath of sliceFiles) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      const sliceName = path.basename(filePath, '.slice.tsx');
      const ddlContent = extractSliceSchema(sourceFile);

      if (!ddlContent) {
        continue;
      }

      const { upDdl, downDdl } = parseBidirectionalDdl(ddlContent);
      if (!upDdl) {
        continue;
      }

      const hash = hashStatement(upDdl);
      const statements = splitStatements(upDdl);
      const withHashes = statements.map((statement) => ({ statement, hash: hashStatement(statement) }));

      const applied = await db.query<{ statement_hash: string }>(
        `SELECT statement_hash FROM _synapse_migration_statements WHERE slice_name = $1`,
        [sliceName]
      );
      const appliedHashes = new Set(applied.map((row) => row.statement_hash));
      const pending = withHashes.filter((entry) => !appliedHashes.has(entry.hash));

      if (pending.length === 0) {
        skippedCount++;
        migrations.push({
          slice: sliceName,
          filePath: path.relative(baseDir, filePath),
          status: 'SKIPPED',
          statementsApplied: 0
        });
        continue;
      }

      try {
        await db.transaction(async (tx) => {
          for (const entry of pending) {
            await tx.query(entry.statement);
          }
          for (const entry of pending) {
            await tx.query(
              `INSERT INTO _synapse_migration_statements (slice_name, statement_hash, down_statement) VALUES ($1, $2, $3)
             ON CONFLICT(slice_name, statement_hash) DO NOTHING`,
              [sliceName, entry.hash, downDdl]
            );
          }
          await tx.query(
            `INSERT INTO _synapse_migrations (slice_name, schema_hash, down_ddl, applied_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT(slice_name) DO UPDATE SET schema_hash = $2, down_ddl = $3, applied_at = CURRENT_TIMESTAMP`,
            [sliceName, hash, downDdl]
          );
        });

        appliedCount++;
        statementsAppliedTotal += pending.length;
        migrations.push({
          slice: sliceName,
          filePath: path.relative(baseDir, filePath),
          status: 'APPLIED',
          statementsApplied: pending.length
        });
      } catch (err: unknown) {
        hasFailure = true;
        const errMessage = err instanceof Error ? err.message : String(err);
        migrations.push({
          slice: sliceName,
          filePath: path.relative(baseDir, filePath),
          status: 'FAILED',
          statementsApplied: 0,
          error: errMessage
        });
      }
    }

    // Opt-in (default: disabled): the abort gate consults an external model provider
    // when one is configured, so a programmatic caller asks for it explicitly.
    let abortSignal: AbortGateResult | undefined;
    if (hasFailure && options?.enableJevGate === true) {
      try {
        const failureDetails = migrations
          .filter((m) => m.status === 'FAILED')
          .map((m) => `Slice ${m.slice}: ${m.error}`)
          .join('\n');
        abortSignal = await shouldAbortTrajectory(
          `Apply sliceSchema migrations across discovered slices in ${baseDir}`,
          failureDetails
        );
      } catch {}
    }

    return {
      status: hasFailure ? 'FAIL' : 'PASS',
      totalDiscovered: migrations.length,
      appliedCount,
      skippedCount,
      statementsApplied: statementsAppliedTotal,
      migrations,
      abortSignal
    };
  } finally {
    if (isPostgres) {
      await db.query(`SELECT pg_advisory_unlock(${SYNAPSE_MIGRATION_LOCK_ID});`);
    }
  }
}

export async function rollbackSliceMigrations(
  _baseDir: string = process.cwd(),
  customDb?: DatabaseClient,
  options: RollbackOptions = {}
): Promise<RollbackReport> {
  const db = customDb || getDatabase();
  const isPostgres = db instanceof PostgresDatabaseClient;
  const SYNAPSE_MIGRATION_LOCK_ID = 82910471;

  if (isPostgres) {
    await db.query(`SELECT pg_advisory_lock(${SYNAPSE_MIGRATION_LOCK_ID});`);
  }

  try {
    const tableExists = await db.query(
      isPostgres
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = '_synapse_migrations'`
        : `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_synapse_migrations'`
    );

    if (tableExists.length === 0) {
      return {
        status: 'PASS',
        totalRolledBack: 0,
        rollbacks: [],
        message: 'Nenhuma tabela de migrações encontrada no banco.'
      };
    }

    let records: Array<{ slice_name: string; down_ddl: string | null }>;
    if (options.targetSlice) {
      const cleanTarget = options.targetSlice.endsWith('.slice.tsx')
        ? path.basename(options.targetSlice, '.slice.tsx')
        : options.targetSlice.includes('/')
          ? (options.targetSlice.split('/').pop() ?? options.targetSlice)
          : options.targetSlice;

      records = await db.query<{ slice_name: string; down_ddl: string | null }>(
        `SELECT slice_name, down_ddl FROM _synapse_migrations WHERE slice_name = $1`,
        [cleanTarget]
      );

      if (records.length === 0) {
        return {
          status: 'FAIL',
          totalRolledBack: 0,
          rollbacks: [
            {
              slice: cleanTarget,
              status: 'FAILED',
              statementsRolledBack: 0,
              error: `Fatia '${cleanTarget}' não foi encontrada no histórico de migrações aplicadas.`
            }
          ]
        };
      }
    } else {
      const steps = Math.max(1, options.steps ?? 1);
      records = await db.query<{ slice_name: string; down_ddl: string | null }>(
        `SELECT slice_name, down_ddl FROM _synapse_migrations ORDER BY applied_at DESC, slice_name DESC LIMIT $1`,
        [steps]
      );
    }

    if (records.length === 0) {
      return {
        status: 'PASS',
        totalRolledBack: 0,
        rollbacks: [],
        message: 'Nenhuma migração disponível para reverter.'
      };
    }

    const rollbacks: RollbackResult[] = [];
    let hasFailure = false;
    let totalRolledBack = 0;

    for (const record of records) {
      if (!record.down_ddl || record.down_ddl.trim().length === 0) {
        hasFailure = true;
        rollbacks.push({
          slice: record.slice_name,
          status: 'FAILED',
          statementsRolledBack: 0,
          error: `A fatia '${record.slice_name}' não possui bloco '-- down:' declarado para reversão.`
        });
        continue;
      }

      const downStatements = splitStatements(record.down_ddl);
      try {
        await db.transaction(async (tx) => {
          for (const stmt of downStatements) {
            await tx.query(stmt);
          }
          await tx.query(`DELETE FROM _synapse_migration_statements WHERE slice_name = $1`, [record.slice_name]);
          await tx.query(`DELETE FROM _synapse_migrations WHERE slice_name = $1`, [record.slice_name]);
        });

        totalRolledBack++;
        rollbacks.push({
          slice: record.slice_name,
          status: 'ROLLED_BACK',
          statementsRolledBack: downStatements.length
        });
      } catch (err: unknown) {
        hasFailure = true;
        rollbacks.push({
          slice: record.slice_name,
          status: 'FAILED',
          statementsRolledBack: 0,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return {
      status: hasFailure ? 'FAIL' : 'PASS',
      totalRolledBack,
      rollbacks
    };
  } finally {
    if (isPostgres) {
      await db.query(`SELECT pg_advisory_unlock(${SYNAPSE_MIGRATION_LOCK_ID});`);
    }
  }
}

if (import.meta.main) {
  console.log('⚡ [Synapse Migrator] Varrendo fatias verticais para auto-descoberta de DDL...');
  const report = await runSliceMigrations();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.status === 'PASS' ? 0 : 1);
}
