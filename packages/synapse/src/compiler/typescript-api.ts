/**
 * SynapseJS - TypeScript compiler API guard.
 *
 * The splitter, checker and repo-map generator use the in-process JavaScript
 * compiler API. TypeScript 7 (the native compiler) ships a CLI-only package and
 * removed that API, so resolving it must fail with a named, actionable error
 * instead of a `TypeError` deep inside the compiler.
 */

import * as ts from 'typescript';

export const COMPILER_API_UNAVAILABLE = 'COMPILER_API_UNAVAILABLE';

interface CompilerModuleShape {
  version?: string;
  sys?: { readFile?: unknown };
  createProgram?: unknown;
}

export function assertCompilerApi(module: unknown = ts): void {
  const candidate = module as CompilerModuleShape;

  if (typeof candidate?.sys?.readFile === 'function' && typeof candidate.createProgram === 'function') {
    return;
  }

  const error = new Error(
    `${COMPILER_API_UNAVAILABLE}: TypeScript ${candidate?.version ?? 'unknown'} does not expose the in-process compiler API required by SynapseJS. Use TypeScript 5.9.x (the pinned version) or run the compiler through its CLI.`
  ) as Error & { code: string };

  error.code = COMPILER_API_UNAVAILABLE;
  throw error;
}
