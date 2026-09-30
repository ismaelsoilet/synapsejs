/**
 * SynapseJS - Slice Directory Resolution & Discovery
 *
 * Single source of truth for locating `src/slices`. Every consumer (CLI, MCP,
 * runtime, migrations, scaffolder) resolves through here.
 *
 * Fails loudly with structured diagnostics instead of silently reporting
 * success when no slices directory exists — the previous source of
 * false-green reports to AI agents.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Err, Ok, type Result } from '../core/machine-types';

export const SLICE_EXTENSION = '.slice.tsx';

export type SlicesDirErrorCode = 'NO_SLICES_DIR' | 'AMBIGUOUS_SLICES_DIR';

export interface SlicesDirError {
  code: SlicesDirErrorCode;
  message: string;
  candidates: string[];
}

export interface SlicesResolution {
  projectRoot: string;
  slicesDir: string;
}

/**
 * Recursively collects every `*.slice.tsx` under `dir`.
 * Returns an empty array when the directory does not exist.
 */
export function findSliceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];
  // `readdirSync` order is filesystem-dependent: on a fresh checkout it can differ from
  // the developer's machine, which made generated artifacts (repo map, schema catalog,
  // split order) drift between the two. Sorting makes every generated file reproducible.
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSliceFiles(full));
    } else if (entry.name.endsWith(SLICE_EXTENSION)) {
      results.push(full);
    }
  }
  return results;
}

function readWorkspaceGlobs(projectRoot: string): string[] {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (Array.isArray(pkg.workspaces)) {
      return pkg.workspaces;
    }
    if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
      return pkg.workspaces.packages;
    }
  } catch {
    return [];
  }

  return [];
}

function expandWorkspaceGlobs(projectRoot: string, globs: string[]): string[] {
  const dirs: string[] = [];

  for (const glob of globs) {
    if (!glob.endsWith('/*')) {
      dirs.push(path.resolve(projectRoot, glob));
      continue;
    }

    const parent = path.resolve(projectRoot, glob.slice(0, -2));
    if (!fs.existsSync(parent)) {
      continue;
    }

    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        dirs.push(path.join(parent, entry.name));
      }
    }
  }

  return dirs;
}

function hasSlices(dir: string): boolean {
  return findSliceFiles(dir).length > 0;
}

/**
 * Resolves the slices directory starting from `startDir`.
 *
 * Order:
 * 1. `SYNAPSE_ROOT` (relative to `startDir`) overrides the starting point.
 * 2. `<projectRoot>/src/slices` when it contains at least one slice.
 * 3. Workspace members declared in `package.json#workspaces` — only when
 *    exactly one of them owns a non-empty `src/slices`.
 *
 * Ambiguity and absence are both errors: a machine consumer must never be
 * told "PASS" when nothing was discovered.
 */
export function resolveSlicesDir(startDir: string = process.cwd()): Result<SlicesResolution, SlicesDirError> {
  const envRoot = process.env.SYNAPSE_ROOT;
  const projectRoot = envRoot ? path.resolve(startDir, envRoot) : path.resolve(startDir);
  const candidates: string[] = [];

  const direct = path.join(projectRoot, 'src/slices');
  candidates.push(direct);
  if (hasSlices(direct)) {
    return Ok({ projectRoot, slicesDir: direct });
  }

  const discovered: string[] = [];
  for (const workspaceDir of expandWorkspaceGlobs(projectRoot, readWorkspaceGlobs(projectRoot))) {
    const candidate = path.join(workspaceDir, 'src/slices');
    candidates.push(candidate);
    if (hasSlices(candidate)) {
      discovered.push(candidate);
    }
  }

  if (discovered.length === 1) {
    return Ok({ projectRoot, slicesDir: discovered[0] });
  }

  if (discovered.length > 1) {
    return Err({
      code: 'AMBIGUOUS_SLICES_DIR',
      message:
        `Múltiplos diretórios de fatias encontrados a partir de '${projectRoot}'. ` +
        `Defina SYNAPSE_ROOT ou execute o comando dentro do app alvo.`,
      candidates: discovered
    });
  }

  return Err({
    code: 'NO_SLICES_DIR',
    message:
      `Nenhum diretório de fatias (src/slices contendo arquivos *${SLICE_EXTENSION}) ` +
      `encontrado a partir de '${projectRoot}'.`,
    candidates
  });
}
