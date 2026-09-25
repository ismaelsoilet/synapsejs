/**
 * SynapseJS - Declarative AST Slice Migration Runner
 * 
 * Auto-discovers 'sliceSchema' DDL definitions co-located in *.slice.tsx files
 * and applies them idempotently to the active database (SQLite or PostgreSQL).
 * Preserves Locality of Behavior (LoB): each slice owns its own table contracts!
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseClient } from '../core/database-client';
import { getDatabase } from '../core/index';

export interface MigrationResult {
  slice: string;
  filePath: string;
  status: 'APPLIED' | 'SKIPPED' | 'FAILED';
  error?: string;
}

export interface MigrationReport {
  status: 'PASS' | 'FAIL';
  totalDiscovered: number;
  appliedCount: number;
  skippedCount: number;
  migrations: MigrationResult[];
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
  const slicesDir = path.join(baseDir, 'src/slices');

  // Ensure migrations tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS _synapse_migrations (
      slice_name TEXT PRIMARY KEY,
      schema_hash TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!fs.existsSync(slicesDir)) {
    return {
      status: 'PASS',
      totalDiscovered: 0,
      appliedCount: 0,
      skippedCount: 0,
      migrations: []
    };
  }

  const findSliceFiles = (dir: string): string[] => {
    let results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findSliceFiles(full));
      else if (entry.name.endsWith('.slice.tsx')) results.push(full);
    }
    return results;
  };

  const sliceFiles = findSliceFiles(slicesDir);
  const migrations: MigrationResult[] = [];
  let appliedCount = 0;
  let skippedCount = 0;
  let hasFailure = false;

  for (const filePath of sliceFiles) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const sliceName = path.basename(filePath, '.slice.tsx');
    const ddlContent = extractSliceSchema(sourceFile);

    if (!ddlContent) {
      continue;
    }

    // Hash schema to detect modifications
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(ddlContent);
    const hash = hasher.digest('hex');

    // Check if already applied
    const existing = await db.query<{ schema_hash: string }>(
      `SELECT schema_hash FROM _synapse_migrations WHERE slice_name = $1`,
      [sliceName]
    );

    if (existing.length > 0 && existing[0].schema_hash === hash) {
      skippedCount++;
      migrations.push({
        slice: sliceName,
        filePath: path.relative(baseDir, filePath),
        status: 'SKIPPED'
      });
      continue;
    }

    // Split statements and execute sequentially
    try {
      const statements = ddlContent
        .split(';')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      await db.transaction(async (tx) => {
        for (const stmt of statements) {
          await tx.query(stmt);
        }
        await tx.query(
          `INSERT INTO _synapse_migrations (slice_name, schema_hash) VALUES ($1, $2)
           ON CONFLICT(slice_name) DO UPDATE SET schema_hash = $2, applied_at = CURRENT_TIMESTAMP`,
          [sliceName, hash]
        );
      });

      appliedCount++;
      migrations.push({
        slice: sliceName,
        filePath: path.relative(baseDir, filePath),
        status: 'APPLIED'
      });
    } catch (err: any) {
      hasFailure = true;
      migrations.push({
        slice: sliceName,
        filePath: path.relative(baseDir, filePath),
        status: 'FAILED',
        error: err.message
      });
    }
  }

  return {
    status: hasFailure ? 'FAIL' : 'PASS',
    totalDiscovered: migrations.length,
    appliedCount,
    skippedCount,
    migrations
  };
}

if (import.meta.main) {
  console.log('⚡ [Synapse Migrator] Varrendo fatias verticais para auto-descoberta de DDL...');
  const report = await runSliceMigrations();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.status === 'PASS' ? 0 : 1);
}
