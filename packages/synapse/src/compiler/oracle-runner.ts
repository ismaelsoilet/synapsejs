/**
 * SynapseJS - Slice Oracle Runner
 *
 * Executes every slice's `sliceTests` under Bun's real test runner without
 * importing `bun:test` into production code. For each slice a companion wrapper
 * is generated inside `.synapse/oracles/`; Bun writes JUnit XML; this module
 * turns that XML into the framework's machine-readable JSON.
 *
 * Nothing here may report PASS when no invariant was executed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { findSliceFiles, resolveSlicesDir, type SlicesDirErrorCode } from './slice-discovery';

export const ORACLE_DIR_NAME = 'oracles';

export interface OracleCaseResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface OracleSliceResult {
  slice: string;
  file: string;
  wrapperPath: string;
  passed: boolean;
  cases: OracleCaseResult[];
}

export type OracleErrorCode = SlicesDirErrorCode | 'NO_CASES' | 'RUNNER_FAILED' | 'WRITE_FAILED';

export interface OracleReport {
  status: 'PASS' | 'FAIL';
  slicesDir?: string;
  totalSlices: number;
  passedSlices: number;
  totalCases: number;
  passedCases: number;
  results: OracleSliceResult[];
  code?: OracleErrorCode;
  message?: string;
  candidates?: string[];
}

export interface JunitSuite {
  name: string;
  cases: OracleCaseResult[];
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? unescapeXml(match[1]) : null;
}

/**
 * Parses Bun's JUnit output into suites of named cases.
 *
 * Bun emits a nested `<testsuite>` per file and another per `describe`, so
 * chunks are aggregated by their `file` attribute and their cases merged.
 */
export function parseOracleJunit(xml: string): JunitSuite[] {
  const byFile = new Map<string, JunitSuite>();

  for (const suiteChunk of xml.split('<testsuite ').slice(1)) {
    const opening = suiteChunk.slice(0, suiteChunk.indexOf('>'));
    const file = attribute(opening, 'file') ?? attribute(opening, 'name') ?? 'unknown';
    const suite = byFile.get(file) ?? { name: file, cases: [] };

    const casePattern = /<testcase ([^>]*?)(\/>|>)([\s\S]*?)(?:<\/testcase>|(?=<testcase )|$)/g;
    let match: RegExpExecArray | null;

    while ((match = casePattern.exec(suiteChunk)) !== null) {
      const body = match[3] ?? '';
      const caseName = attribute(match[1], 'name') ?? 'unnamed';
      const failureMatch = body.match(/<failure ([^>]*?)(\/>|>)/);
      const skipped = /<skipped/.test(body);

      const result: OracleCaseResult = { name: caseName, passed: !failureMatch && !skipped };
      if (failureMatch) {
        result.message = attribute(failureMatch[1], 'message') ?? 'falhou sem mensagem';
      }

      suite.cases.push(result);
    }

    byFile.set(file, suite);
  }

  return [...byFile.values()];
}

/**
 * Generates the companion file that registers one Bun test per oracle case.
 * The wrapper is a generated artifact — the authored feature stays one file.
 */
export function oracleWrapperSource(importPath: string, sliceName: string): string {
  return [
    `// [SYNAPSE-JS GENERATED ORACLE WRAPPER] registers the slice's invariants`,
    `import { describe, expect, it } from 'bun:test';`,
    `import * as sliceModule from ${JSON.stringify(importPath)};`,
    ``,
    `const oracle = (sliceModule as Record<string, unknown>).sliceTests as`,
    `  | { description?: string; cases?: Array<{ name: string; run: () => unknown }>; run?: () => unknown }`,
    `  | undefined;`,
    ``,
    `describe(${JSON.stringify(sliceName)}, () => {`,
    `  if (!oracle) {`,
    `    it('declares sliceTests', () => {`,
    `      expect(oracle).toBeDefined();`,
    `    });`,
    `    return;`,
    `  }`,
    ``,
    `  if (Array.isArray(oracle.cases) && oracle.cases.length > 0) {`,
    `    for (const oracleCase of oracle.cases) {`,
    `      it(oracleCase.name, async () => {`,
    `        await oracleCase.run();`,
    `      });`,
    `    }`,
    `    return;`,
    `  }`,
    ``,
    `  if (typeof oracle.run === 'function') {`,
    `    it(oracle.description ?? 'invariantes', async () => {`,
    `      await oracle.run?.();`,
    `    });`,
    `    return;`,
    `  }`,
    ``,
    `  it('declares at least one invariant', () => {`,
    `    const hasCases = Array.isArray(oracle.cases) && oracle.cases.length > 0;`,
    `    const hasRun = typeof oracle.run === 'function';`,
    `    expect(hasCases || hasRun).toBe(true);`,
    `  });`,
    `});`,
    ``
  ].join('\n');
}

export interface OracleRunOptions {
  /** Injected by tests: runs a command and returns its exit code and output. */
  spawn?: (args: string[], cwd: string) => Promise<{ exitCode: number; output: string }>;
}

async function defaultSpawn(args: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

export async function runSliceOracles(
  root: string = process.cwd(),
  options: OracleRunOptions = {}
): Promise<OracleReport> {
  const resolution = resolveSlicesDir(root);

  if (!resolution.ok) {
    return {
      status: 'FAIL',
      totalSlices: 0,
      passedSlices: 0,
      totalCases: 0,
      passedCases: 0,
      results: [],
      code: resolution.error.code,
      message: resolution.error.message,
      candidates: resolution.error.candidates
    };
  }

  const slicesDir = resolution.value.slicesDir;
  const sliceFiles = findSliceFiles(slicesDir);
  const oraclesDir = path.join(root, '.synapse', ORACLE_DIR_NAME);
  const reportPath = path.join(oraclesDir, 'report.xml');

  const wrappers = new Map<string, OracleSliceResult>();

  try {
    fs.rmSync(oraclesDir, { recursive: true, force: true });
    fs.mkdirSync(oraclesDir, { recursive: true });

    for (const sliceFile of sliceFiles) {
      const sliceName = path.basename(sliceFile, '.slice.tsx');
      const wrapperPath = path.join(oraclesDir, `${sliceName}.oracle.test.ts`);
      const relativeImport = path
        .relative(oraclesDir, sliceFile)
        .split(path.sep)
        .join('/')
        .replace(/\.tsx$/, '');

      fs.writeFileSync(wrapperPath, oracleWrapperSource(`./${relativeImport}`, sliceName), 'utf-8');
      wrappers.set(`${sliceName}.oracle.test.ts`, {
        slice: sliceName,
        file: path.relative(root, sliceFile),
        wrapperPath: path.relative(root, wrapperPath),
        passed: false,
        cases: []
      });
    }
  } catch (err) {
    return {
      status: 'FAIL',
      totalSlices: 0,
      passedSlices: 0,
      totalCases: 0,
      passedCases: 0,
      results: [],
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const spawn = options.spawn ?? defaultSpawn;
  const { exitCode, output } = await spawn(
    [
      'bun',
      'test',
      ...[...wrappers.values()].map((entry) => path.resolve(root, entry.wrapperPath)),
      '--reporter=junit',
      `--reporter-outfile=${reportPath}`
    ],
    root
  );

  if (!fs.existsSync(reportPath)) {
    return {
      status: 'FAIL',
      totalSlices: wrappers.size,
      passedSlices: 0,
      totalCases: 0,
      passedCases: 0,
      results: [],
      code: 'RUNNER_FAILED',
      message: `O runner não produziu relatório (exit ${exitCode}). ${output.trim().slice(-400)}`.trim()
    };
  }

  for (const suite of parseOracleJunit(fs.readFileSync(reportPath, 'utf-8'))) {
    const entry = wrappers.get(path.basename(suite.name));
    if (!entry) {
      continue;
    }
    entry.cases = suite.cases;
    entry.passed = suite.cases.length > 0 && suite.cases.every((item) => item.passed);
  }

  const results = [...wrappers.values()];
  const totalCases = results.reduce((sum, item) => sum + item.cases.length, 0);
  const passedCases = results.reduce((sum, item) => sum + item.cases.filter((c) => c.passed).length, 0);
  const passedSlices = results.filter((item) => item.passed).length;

  if (totalCases === 0) {
    return {
      status: 'FAIL',
      slicesDir: path.relative(root, slicesDir),
      totalSlices: results.length,
      passedSlices: 0,
      totalCases: 0,
      passedCases: 0,
      results,
      code: 'NO_CASES',
      message: `Nenhum invariante foi executado em ${results.length} fatia(s).`
    };
  }

  return {
    status: passedSlices === results.length ? 'PASS' : 'FAIL',
    slicesDir: path.relative(root, slicesDir),
    totalSlices: results.length,
    passedSlices,
    totalCases,
    passedCases,
    results
  };
}
