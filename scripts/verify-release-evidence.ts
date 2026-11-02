#!/usr/bin/env bun
/**
 * Re-executes the commands recorded in a release-evidence file and checks that
 * the recorded commit is the commit under evaluation. The evidence is not a
 * claim the author signs: it is a script the repository can replay.
 *
 * Usage: bun run scripts/verify-release-evidence.ts [file] [--dry-run] [--json]
 */

import * as fs from 'fs';
import * as path from 'path';

interface EvidenceCommand {
  command: string;
  exitCode: number;
}

interface ReleaseEvidence {
  version: string;
  commit: string;
  dirty: boolean;
  commands: EvidenceCommand[];
}

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const asJson = args.includes('--json');
const fileArg = args.find((arg) => !arg.startsWith('--'));
const file = fileArg ? path.resolve(root, fileArg) : path.join(root, 'release-evidence', '1.11.0.md');

function run(command: string): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync(['bash', '-lc', command], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString()
  };
}

function fail(message: string): never {
  const report = { status: 'FAIL', operation: 'VERIFY_RELEASE_EVIDENCE', message };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
}

if (!fs.existsSync(file)) {
  fail(`evidence file not found: ${file}`);
}

const text = fs.readFileSync(file, 'utf-8');
const block = text.match(/```json\n([\s\S]*?)\n```/);
if (!block) {
  fail('evidence file has no ```json block');
}

let evidence: ReleaseEvidence;
try {
  evidence = JSON.parse(block[1]) as ReleaseEvidence;
} catch (error) {
  fail(`evidence JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'synapse', 'package.json'), 'utf-8')) as {
  version: string;
};

if (evidence.version !== manifest.version) {
  fail(`evidence version ${evidence.version} does not match manifest ${manifest.version}`);
}

const head = run('git rev-parse HEAD').stdout.trim();
// `HEAD` is the symbolic form used by committed evidence: the file cannot contain
// the hash of the commit that contains it, so the verifier resolves the ref and
// requires a clean tree. An explicit hash is still accepted for historical evidence.
const declaredCommit = evidence.commit === 'HEAD' ? head : evidence.commit;
if (declaredCommit !== head) {
  fail(`evidence commit ${declaredCommit} does not match HEAD ${head}`);
}

const dirty = run('git status --porcelain').stdout.trim().length > 0;
if (evidence.dirty !== dirty) {
  fail(`evidence dirty=${evidence.dirty} does not match the working tree (dirty=${dirty})`);
}

const results = [];

for (const entry of evidence.commands) {
  if (dryRun) {
    results.push({ command: entry.command, expected: entry.exitCode, actual: null, status: 'DRY_RUN' });
    continue;
  }

  const result = run(entry.command);
  const status = result.exitCode === entry.exitCode ? 'PASS' : 'FAIL';
  results.push({ command: entry.command, expected: entry.exitCode, actual: result.exitCode, status });

  if (status === 'FAIL') {
    if (!asJson) {
      process.stdout.write(`FAIL ${entry.command}: expected ${entry.exitCode}, got ${result.exitCode}\n`);
    }
  }
}

const failures = results.filter((result) => result.status === 'FAIL');
const report = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  operation: 'VERIFY_RELEASE_EVIDENCE',
  file: path.relative(root, file),
  version: evidence.version,
  commit: evidence.commit,
  resolvedCommit: head,
  dirty,
  dryRun,
  results
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failures.length === 0 ? 0 : 1);
