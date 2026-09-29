/**
 * SynapseJS - Schema DAG & Topological Migration Ordering
 *
 * Inspects slice DDL contracts for table definitions and foreign key references,
 * building an acyclic dependency graph to guarantee parent tables
 * are migrated before child tables referencing them.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { extractSliceSchema } from './migration-runner';

export interface SliceSchemaMetadata {
  filePath: string;
  sliceName: string;
  tablesCreated: string[];
  tablesReferenced: string[];
}

/**
 * Extracts table definitions and foreign key table references from a DDL string.
 */
export function parseTableDependencies(ddl: string): { created: string[]; referenced: string[] } {
  const created: string[] = [];
  const referenced: string[] = [];

  // Strip SQL comments to avoid false-positive dependencies
  const cleanDdl = ddl.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Match CREATE TABLE [IF NOT EXISTS] [schema.]<name>
  const createRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["'`]?[a-zA-Z0-9_]+["'`]?\.)?["'`]?([a-zA-Z0-9_]+)["'`]?/gi;
  let match: RegExpExecArray | null = createRegex.exec(cleanDdl);
  while (match !== null) {
    const tableName = match[1].toLowerCase();
    if (!created.includes(tableName)) {
      created.push(tableName);
    }
    match = createRegex.exec(cleanDdl);
  }

  // Match REFERENCES [schema.]<name>[(columns)]
  const refRegex = /REFERENCES\s+(?:["'`]?[a-zA-Z0-9_]+["'`]?\.)?["'`]?([a-zA-Z0-9_]+)["'`]?/gi;
  let refMatch: RegExpExecArray | null = refRegex.exec(cleanDdl);
  while (refMatch !== null) {
    const tableName = refMatch[1].toLowerCase();
    if (!created.includes(tableName) && !referenced.includes(tableName)) {
      referenced.push(tableName);
    }
    refMatch = refRegex.exec(cleanDdl);
  }

  return { created, referenced };
}

/**
 * Sorts slice file paths topologically based on table dependencies so parent tables
 * are created before dependent foreign-key child tables.
 */
export function orderSlicesByDag(sliceFiles: string[]): string[] {
  const metadataMap = new Map<string, SliceSchemaMetadata>();
  const tableToSlice = new Map<string, string>(); // tableName -> sliceFilePath

  // Pass 1: Parse AST and metadata for all slices
  for (const filePath of sliceFiles) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const sliceName = path.basename(filePath, '.slice.tsx');
    const ddl = extractSliceSchema(sourceFile);

    if (!ddl) {
      metadataMap.set(filePath, { filePath, sliceName, tablesCreated: [], tablesReferenced: [] });
      continue;
    }

    const { created, referenced } = parseTableDependencies(ddl);
    metadataMap.set(filePath, { filePath, sliceName, tablesCreated: created, tablesReferenced: referenced });

    for (const table of created) {
      tableToSlice.set(table, filePath);
    }
  }

  // Pass 2: Build adjacency list for topological sorting
  // Dependency: slice A depends on slice B (B must run before A)
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // B -> list of A's that depend on B

  for (const filePath of sliceFiles) {
    inDegree.set(filePath, 0);
    graph.set(filePath, []);
  }

  for (const [filePath, meta] of metadataMap) {
    for (const refTable of meta.tablesReferenced) {
      const parentFilePath = tableToSlice.get(refTable);
      if (parentFilePath && parentFilePath !== filePath) {
        // parentFilePath must run before filePath (prevent duplicate edge)
        const neighbors = graph.get(parentFilePath);
        if (neighbors && !neighbors.includes(filePath)) {
          neighbors.push(filePath);
          inDegree.set(filePath, (inDegree.get(filePath) || 0) + 1);
        }
      }
    }
  }

  // Pass 3: Kahn's algorithm for topological sorting
  const queue: string[] = [];
  for (const [filePath, deg] of inDegree) {
    if (deg === 0) {
      queue.push(filePath);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    sorted.push(current);

    for (const neighbor of graph.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If cycle or unvisited nodes remain, append remaining in original order
  if (sorted.length < sliceFiles.length) {
    for (const file of sliceFiles) {
      if (!sorted.includes(file)) {
        sorted.push(file);
      }
    }
  }

  return sorted;
}
