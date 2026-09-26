/**
 * Study runner. The single writer of `scripts/study/results/`.
 *
 * Attempts are counted from the append-only log, so an implementer cannot forget
 * an attempt, and files/lines come from git rather than from anyone's summary.
 *
 * Usage:
 *   bun run study --task T1 --stack slices [--note "..."] [--reset]
 *   bun run study --report
 */

import * as fs from 'fs';
import * as path from 'path';
import { STACKS, STUDY_TASKS, type StudyStack } from './tasks';

const repoRoot = path.resolve(import.meta.dir, '..', '..');
const resultsDir = path.join(import.meta.dir, 'results');
const logPath = path.join(resultsDir, 'attempts.jsonl');

interface GateResult {
  command: string;
  exitCode: number;
  output: string;
}

interface DiffStats {
  files: number;
  added: number;
  removed: number;
  paths: string[];
}

interface Attempt {
  task: string;
  stack: StudyStack;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  green: boolean;
  seconds: number;
  gates: GateResult[];
  diff: DiffStats | null;
  note?: string;
}

async function run(args: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

function readLog(): Attempt[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Attempt);
}

function appendLog(attempt: Attempt): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(attempt)}\n`, 'utf-8');
}

async function diffStats(appDir: string): Promise<DiffStats> {
  const scoped = path.relative(repoRoot, appDir);
  const stats: DiffStats = { files: 0, added: 0, removed: 0, paths: [] };

  const tracked = await run(['git', 'diff', '--numstat', '--', scoped], repoRoot);
  for (const line of tracked.output.split('\n')) {
    const [added, removed, file] = line.trim().split(/\s+/);
    if (!file) {
      continue;
    }
    stats.files += 1;
    stats.added += Number(added) || 0;
    stats.removed += Number(removed) || 0;
    stats.paths.push(path.relative(appDir, path.join(repoRoot, file)));
  }

  // `git diff` misses files that do not exist yet, which is exactly what a new
  // slice is. Counting them is what makes the two stacks comparable.
  const untracked = await run(['git', 'ls-files', '--others', '--exclude-standard', '--', scoped], repoRoot);
  for (const file of untracked.output.split('\n').filter((line) => line.trim().length > 0)) {
    const absolute = path.join(repoRoot, file);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    stats.files += 1;
    stats.added += fs.readFileSync(absolute, 'utf-8').split('\n').length - 1;
    stats.paths.push(path.relative(appDir, absolute));
  }

  return stats;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function record(): Promise<never> {
  const taskId = argValue('task');
  const stackId = argValue('stack') as StudyStack | undefined;
  const note = argValue('note');

  const task = STUDY_TASKS.find((item) => item.id === taskId);
  const stack = stackId ? STACKS[stackId] : undefined;

  if (!task || !stack || !stackId) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'FAIL',
          code: 'UNKNOWN_TASK_OR_STACK',
          tasks: STUDY_TASKS.map((item) => item.id),
          stacks: Object.keys(STACKS)
        },
        null,
        2
      )}\n`
    );
    process.exit(1);
  }

  const appDir = path.join(repoRoot, stack.app);
  const previous = readLog().filter((item) => item.task === task.id && item.stack === stackId);
  const startedAt = previous[0]?.startedAt ?? new Date().toISOString();

  const gates: GateResult[] = [];
  for (const command of stack.gates) {
    const result = await run(command, appDir);
    gates.push({
      command: command.join(' '),
      exitCode: result.exitCode,
      output: result.output.trim().slice(-400)
    });
  }

  const green = gates.every((gate) => gate.exitCode === 0);
  const finishedAt = new Date().toISOString();
  const stats = await diffStats(appDir);

  const attempt: Attempt = {
    task: task.id,
    stack: stackId,
    attempt: previous.length + 1,
    startedAt,
    finishedAt,
    green,
    seconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000),
    gates,
    diff: green ? stats : null,
    ...(note ? { note } : {})
  };

  appendLog(attempt);

  if (green) {
    fs.writeFileSync(
      path.join(resultsDir, `${task.id}-${stackId}.diff`),
      (await run(['git', 'diff', '--', path.relative(repoRoot, appDir)], repoRoot)).output,
      'utf-8'
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: green ? 'PASS' : 'FAIL',
        operation: 'STUDY_ATTEMPT',
        task: task.id,
        stack: stackId,
        attempt: attempt.attempt,
        seconds: attempt.seconds,
        gates: gates.map((gate) => ({ command: gate.command, exitCode: gate.exitCode })),
        diff: attempt.diff,
        hint: green ? 'verde: reverta com --reset antes da próxima célula' : 'rode de novo após corrigir'
      },
      null,
      2
    )}\n`
  );
  process.exit(green ? 0 : 1);
}

function report(): never {
  const attempts = readLog();
  const lines = [
    '| task | stack | registros | arquivos tocados | linhas (+/-) | caminhos |',
    '|---|---|---|---|---|---|'
  ];

  for (const task of STUDY_TASKS) {
    for (const stackId of Object.keys(STACKS) as StudyStack[]) {
      const cell = attempts.filter((item) => item.task === task.id && item.stack === stackId);
      // The last green attempt that carries a diff, not the first: a cell may hold
      // an entry invalidated by a measurement defect. That is disclosed, not used.
      const green = [...cell].reverse().find((item) => item.green && item.diff);
      // A green attempt that changed no file cannot be real for these tasks: it
      // means the collector failed, and it is disclosed instead of being used.
      const invalidated = cell.filter((item) => item.green && (!item.diff || item.diff.files === 0)).length;

      if (!green) {
        lines.push(`| ${task.id} | ${stackId} | ${cell.length} | — | — | não ficou verde |`);
        continue;
      }

      lines.push(
        `| ${task.id} | ${stackId} | ${cell.length} | ${green.diff?.files ?? 0} | ` +
          `+${green.diff?.added ?? 0}/-${green.diff?.removed ?? 0} | ${(green.diff?.paths ?? []).join(', ')} |` +
          (invalidated > 0 ? ` (${invalidated} entrada invalidada por defeito de medição)` : '')
      );
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

async function reset(stack: StudyStack): Promise<void> {
  // `git checkout` restores tracked files but leaves a brand-new slice behind,
  // which would leak into the next cell.
  await run(['git', 'checkout', '--', STACKS[stack].app], repoRoot);
  await run(['git', 'clean', '-fd', '--', STACKS[stack].app], repoRoot);
  process.stdout.write(`revertido: ${STACKS[stack].app}\n`);
  process.exit(0);
}

if (process.argv.includes('--report')) {
  report();
} else if (process.argv.includes('--reset')) {
  const stackId = argValue('stack') as StudyStack | undefined;
  if (!stackId || !STACKS[stackId]) {
    process.exit(1);
  }
  await reset(stackId);
} else {
  await record();
}
