import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dir, '../../..');

async function runScript(args: string[], env: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn([process.execPath, 'run', ...args], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', ...env },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(`script failed: ${stderr || stdout}`);
  }

  return stdout;
}

describe('benchmarks measure the work the documentation claims', () => {
  it('the context-surface benchmark prints the numbers the readmes quote', async () => {
    const output = await runScript(['scripts/bench-context.ts']);

    // The comparable app column, quoted in the readmes as 1,832 vs 1,627 tokens.
    expect(output).toContain('1832');
    expect(output).toContain('1627');
    expect(output).toContain('não comparável');

    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');
    expect(readme).toContain('1,832');
    expect(readme).toContain('1,627');
    expect(readme).toContain('not comparable');
  });

  it('the concurrency benchmark discovers slices and measures real work in a separate process', async () => {
    const output = await runScript(['scripts/bench-concurrency.ts', '--json'], {
      SYNAPSE_BENCH_REQUESTS: '20',
      SYNAPSE_BENCH_CONCURRENCY: '5'
    });

    const report = JSON.parse(output) as {
      status: string;
      slicesLoaded: number;
      loadGeneratorProcess: string;
      doesNotMeasure: string;
      arms: Array<{ arm: string; requests: number; requestsPerSecond: number; errors: number }>;
    };

    expect(report.status).toBe('PASS');
    expect(report.slicesLoaded).toBeGreaterThan(0);
    expect(report.loadGeneratorProcess).toBe('separate');
    expect(report.doesNotMeasure).toContain('multi-instance');

    const armNames = report.arms.map((arm) => arm.arm).join(' | ');
    expect(armNames).toContain('baseline-static-json (not comparable');
    expect(armNames).toContain('ssr-render');
    expect(armNames).toContain('rpc-persisted-write');

    for (const arm of report.arms) {
      expect(arm.requests).toBe(20);
      expect(arm.errors).toBe(0);
      expect(arm.requestsPerSecond).toBeGreaterThan(0);
    }
  }, 60_000);
});
