/**
 * SynapseJS - AST Diff & Cross-Slice Impact Analyzer
 *
 * Discovers cross-slice dependencies (Foreign Keys, shared module imports,
 * and table references) to calculate the precise blast radius of a change.
 * Allows AI agents to verify only what is affected without running blind full rebuilds.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { extractSliceSchema } from './migration-runner';
import { parseTableDependencies } from './schema-dag';
import { findSliceFiles, resolveSlicesDir } from './slice-discovery';

export type ImpactReason = 'DIRECT' | 'FOREIGN_KEY_DEPENDENCY' | 'TABLE_REFERENCE' | 'SHARED_MODULE_IMPORT';

export interface ImpactedSlice {
  sliceName: string;
  domain: string;
  filePath: string;
  reason: ImpactReason;
  detail: string;
}

export interface ImpactAnalysisReport {
  status: 'PASS';
  operation: 'IMPACT_ANALYSIS';
  target: string;
  targetType: 'slice' | 'table' | 'shared_module';
  totalImpacted: number;
  impactedSlices: ImpactedSlice[];
  recommendedCommands: string[];
}

interface SliceAnalysisData {
  sliceName: string;
  domain: string;
  filePath: string;
  tablesCreated: string[];
  tablesReferenced: string[];
  sharedImports: string[];
  queriedTables: string[];
}

function extractQueriedTables(sourceFile: ts.SourceFile): string[] {
  const tables = new Set<string>();

  function visit(node: ts.Node) {
    // Match db.findMany('table_name', ...), db.insert('table_name', ...) etc.
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr)) {
        const method = expr.name.text;
        if (['findMany', 'findOne', 'insert', 'update', 'delete'].includes(method)) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            tables.add(firstArg.text.toLowerCase());
          }
        }
      }
    }

    // Match raw SQL strings e.g. FROM table_name, JOIN table_name, INTO table_name
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      const sqlMatches = text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi);
      for (const m of sqlMatches) {
        const tName = m[1].toLowerCase();
        if (!['select', 'where', 'set', 'values'].includes(tName)) {
          tables.add(tName);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(tables);
}

function extractSharedImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const modulePath = statement.moduleSpecifier.text;
      if (modulePath.includes('/shared/') || modulePath.startsWith('@shared/')) {
        imports.push(path.basename(modulePath, path.extname(modulePath)));
      }
    }
  }

  return imports;
}

/**
 * Analyzes the impact of a file change, slice modification, or table mutation.
 */
export function analyzeImpact(target: string, rootDir: string = process.cwd()): ImpactAnalysisReport {
  const resolution = resolveSlicesDir(rootDir);
  const slicesDir = resolution.ok ? resolution.value.slicesDir : path.join(rootDir, 'src/slices');
  const sliceFiles = fs.existsSync(slicesDir) ? findSliceFiles(slicesDir) : [];

  const sliceDataList: SliceAnalysisData[] = [];

  for (const filePath of sliceFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const sliceName = path.basename(filePath, '.slice.tsx');
      const domain = path.basename(path.dirname(filePath));
      const ddl = extractSliceSchema(sourceFile);
      const deps = ddl ? parseTableDependencies(ddl) : { created: [], referenced: [] };
      const sharedImports = extractSharedImports(sourceFile);
      const queriedTables = extractQueriedTables(sourceFile);

      sliceDataList.push({
        sliceName,
        domain,
        filePath: path.relative(rootDir, filePath),
        tablesCreated: deps.created,
        tablesReferenced: deps.referenced,
        sharedImports,
        queriedTables
      });
    } catch {
      // Ignore unparseable files
    }
  }

  const cleanTarget = target.trim();
  const cleanBase = path.basename(cleanTarget, '.slice.tsx');

  // Identify target type
  const isSliceTarget =
    cleanTarget.endsWith('.slice.tsx') ||
    sliceDataList.some(
      (s) =>
        s.sliceName.toLowerCase() === cleanBase.toLowerCase() ||
        s.filePath === cleanTarget ||
        s.filePath.endsWith(`/${cleanTarget}`)
    );

  const isSharedTarget =
    cleanTarget.includes('shared/') ||
    cleanTarget.includes('@shared') ||
    (!isSliceTarget && cleanTarget.endsWith('.ts'));

  const targetType: 'slice' | 'table' | 'shared_module' = isSliceTarget
    ? 'slice'
    : isSharedTarget
      ? 'shared_module'
      : 'table';

  const impactedMap = new Map<string, ImpactedSlice>();

  if (targetType === 'slice') {
    const targetSlice = sliceDataList.find(
      (s) =>
        s.sliceName.toLowerCase() === cleanBase.toLowerCase() ||
        s.filePath === cleanTarget ||
        s.filePath.endsWith(`/${cleanTarget}`)
    );

    if (targetSlice) {
      impactedMap.set(targetSlice.sliceName, {
        sliceName: targetSlice.sliceName,
        domain: targetSlice.domain,
        filePath: targetSlice.filePath,
        reason: 'DIRECT',
        detail: 'Fatia alvo diretamente modificada'
      });

      // Find dependent slices
      const ownedTables = new Set(targetSlice.tablesCreated);

      for (const other of sliceDataList) {
        if (other.sliceName === targetSlice.sliceName) continue;

        // Foreign Key dependencies
        const fkMatch = other.tablesReferenced.find((t) => ownedTables.has(t));
        if (fkMatch) {
          impactedMap.set(other.sliceName, {
            sliceName: other.sliceName,
            domain: other.domain,
            filePath: other.filePath,
            reason: 'FOREIGN_KEY_DEPENDENCY',
            detail: `Tabela '${fkMatch}' referenciada via chave estrangeira`
          });
          continue;
        }

        // Query references
        const queryMatch = other.queriedTables.find((t) => ownedTables.has(t));
        if (queryMatch) {
          impactedMap.set(other.sliceName, {
            sliceName: other.sliceName,
            domain: other.domain,
            filePath: other.filePath,
            reason: 'TABLE_REFERENCE',
            detail: `Consulta SQL referencia tabela '${queryMatch}' da fatia alvo`
          });
        }
      }
    }
  } else if (targetType === 'shared_module') {
    const sharedName = path.basename(cleanTarget, path.extname(cleanTarget));

    for (const slice of sliceDataList) {
      if (slice.sharedImports.includes(sharedName)) {
        impactedMap.set(slice.sliceName, {
          sliceName: slice.sliceName,
          domain: slice.domain,
          filePath: slice.filePath,
          reason: 'SHARED_MODULE_IMPORT',
          detail: `Importa módulo compartilhado '${sharedName}'`
        });
      }
    }
  } else {
    // targetType === 'table'
    const tableName = cleanTarget.toLowerCase();

    for (const slice of sliceDataList) {
      if (slice.tablesCreated.includes(tableName)) {
        impactedMap.set(slice.sliceName, {
          sliceName: slice.sliceName,
          domain: slice.domain,
          filePath: slice.filePath,
          reason: 'DIRECT',
          detail: `Fatia é dona da tabela '${tableName}' (CREATE TABLE)`
        });
      } else if (slice.tablesReferenced.includes(tableName)) {
        impactedMap.set(slice.sliceName, {
          sliceName: slice.sliceName,
          domain: slice.domain,
          filePath: slice.filePath,
          reason: 'FOREIGN_KEY_DEPENDENCY',
          detail: `Chave estrangeira referencia tabela '${tableName}'`
        });
      } else if (slice.queriedTables.includes(tableName)) {
        impactedMap.set(slice.sliceName, {
          sliceName: slice.sliceName,
          domain: slice.domain,
          filePath: slice.filePath,
          reason: 'TABLE_REFERENCE',
          detail: `Consulta tabela '${tableName}' via query builder ou SQL`
        });
      }
    }
  }

  const impactedSlices = Array.from(impactedMap.values());

  const recommendedCommands = ['synapse check', 'synapse split'];

  if (
    targetType === 'table' ||
    (targetType === 'slice' && impactedSlices.some((s) => s.reason === 'FOREIGN_KEY_DEPENDENCY'))
  ) {
    recommendedCommands.push('synapse db-drift', 'synapse migrate');
  }

  if (impactedSlices.length > 0) {
    recommendedCommands.push('synapse test');
  }

  return {
    status: 'PASS',
    operation: 'IMPACT_ANALYSIS',
    target: cleanTarget,
    targetType,
    totalImpacted: impactedSlices.length,
    impactedSlices,
    recommendedCommands
  };
}
