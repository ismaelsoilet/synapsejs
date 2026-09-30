#!/usr/bin/env bun
/**
 * SynapseJS - Coverage Gate
 *
 * Runs the framework suite with coverage instrumentation and fails when the totals
 * fall below the committed threshold. Bun reports coverage but has no threshold flag,
 * so the comparison lives here and the number is stated in one place.
 *
 * Usage: bun run scripts/coverage-check.ts [--json]
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Committed floor. Raise it deliberately; a drop below it fails the pipeline.
 * The environment override exists so the gate itself can be exercised.
 */
export const COVERAGE_THRESHOLD = {
  functionsPercent: Number(process.env.SYNAPSE_COVERAGE_MIN_FUNCTIONS ?? 55),
  linesPercent: Number(process.env.SYNAPSE_COVERAGE_MIN_LINES ?? 70)
};

const root = process.cwd();
const asJson = process.argv.includes('--json');

const proc = Bun.spawn([process.execPath, 'test', 'packages/synapse/test', '--coverage', '--coverage-reporter=text'], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'pipe',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' }
});

const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
const suiteExitCode = await proc.exited;
const output = `${stdout}\n${stderr}`;

// The summary row is the one that starts with "All files".
const summary = output
  .split('\n')
  .map((line) => line.match(/^All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/))
  .find((match) => match !== null);

const functionsPercent = summary ? Number(summary[1]) : NaN;
const linesPercent = summary ? Number(summary[2]) : NaN;

// The coverage text report is also written to disk for the pipeline artifact.
if (fs.existsSync(path.join(root, 'coverage'))) {
  fs.rmSync(path.join(root, 'coverage'), { recursive: true, force: true });
}

const failures: string[] = [];

if (suiteExitCode !== 0) {
  failures.push(`the framework suite exited ${suiteExitCode} under coverage instrumentation`);
}

if (!Number.isFinite(functionsPercent) || !Number.isFinite(linesPercent)) {
  failures.push('the coverage summary row was not found in the report');
} else {
  if (functionsPercent < COVERAGE_THRESHOLD.functionsPercent) {
    failures.push(
      `function coverage ${functionsPercent}% is below the committed floor of ${COVERAGE_THRESHOLD.functionsPercent}%`
    );
  }

  if (linesPercent < COVERAGE_THRESHOLD.linesPercent) {
    failures.push(`line coverage ${linesPercent}% is below the committed floor of ${COVERAGE_THRESHOLD.linesPercent}%`);
  }
}

const report = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  operation: 'COVERAGE_GATE',
  threshold: COVERAGE_THRESHOLD,
  functionsPercent,
  linesPercent,
  failures
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (failures.length === 0) {
  process.stdout.write(
    `PASS COVERAGE_GATE: functions ${functionsPercent}% (floor ${COVERAGE_THRESHOLD.functionsPercent}%), lines ${linesPercent}% (floor ${COVERAGE_THRESHOLD.linesPercent}%)\n`
  );
} else {
  process.stdout.write(`FAIL COVERAGE_GATE\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
}

process.exit(failures.length === 0 ? 0 : 1);
