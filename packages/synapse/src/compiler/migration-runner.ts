/**
 * SynapseJS - Declarative AST Slice Migration Runner
 *
 * Auto-discovers 'sliceSchema' DDL definitions co-located in *.slice.tsx files
 * and applies them idempotently to the active database (SQLite or PostgreSQL).
 * Preserves Locality of Behavior (LoB): each slice owns its own table contracts!
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { DatabaseClient } from '../core/database-client';
import { getDatabase } from '../core/index';
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
}

function hashStatement(statement: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(statement);
  return hasher.digest('hex');
}

function splitStatements(ddl: string): string[] {
  return ddl
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function extractSliceSchema(sourceFile: ts.SourceFile): string | null {
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

export async function runSliceMigrations(
  baseDir: string = process.cwd(),
  customDb?: DatabaseClient
): Promise<MigrationReport> {
  const db = customDb || getDatabase();

  // Ensure migrations tracking table exists.
  // TIMESTAMP is accepted by both SQLite and PostgreSQL; DATETIME is SQLite-only.
  await db.query(`
    CREATE TABLE IF NOT EXISTS _synapse_migrations (
      slice_name TEXT PRIMARY KEY,
      schema_hash TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Progresso por statement, não por fatia: sem isso, um `ALTER TABLE` registrado
  // uma vez volta a rodar na próxima edição do DDL e falha para sempre
  // ("duplicate column name"). Com o histórico por statement, cada um roda uma
  // única vez e evoluir o schema passa a ser só declarar a mudança.
  await db.query(`
    CREATE TABLE IF NOT EXISTS _synapse_migration_statements (
      slice_name TEXT NOT NULL,
      statement_hash TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (slice_name, statement_hash)
    );
  `);

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

  const sliceFiles = findSliceFiles(resolution.value.slicesDir);
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

    const hash = hashStatement(ddlContent);
    const statements = splitStatements(ddlContent);
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
            `INSERT INTO _synapse_migration_statements (slice_name, statement_hash) VALUES ($1, $2)
             ON CONFLICT(slice_name, statement_hash) DO NOTHING`,
            [sliceName, entry.hash]
          );
        }
        await tx.query(
          `INSERT INTO _synapse_migrations (slice_name, schema_hash) VALUES ($1, $2)
           ON CONFLICT(slice_name) DO UPDATE SET schema_hash = $2, applied_at = CURRENT_TIMESTAMP`,
          [sliceName, hash]
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
    } catch (err: any) {
      hasFailure = true;
      migrations.push({
        slice: sliceName,
        filePath: path.relative(baseDir, filePath),
        status: 'FAILED',
        statementsApplied: 0,
        error: err.message
      });
    }
  }

  return {
    status: hasFailure ? 'FAIL' : 'PASS',
    totalDiscovered: migrations.length,
    appliedCount,
    skippedCount,
    statementsApplied: statementsAppliedTotal,
    migrations
  };
}

if (import.meta.main) {
  console.log('⚡ [Synapse Migrator] Varrendo fatias verticais para auto-descoberta de DDL...');
  const report = await runSliceMigrations();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.status === 'PASS' ? 0 : 1);
}
