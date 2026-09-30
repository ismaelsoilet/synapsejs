import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(import.meta.dir, '../../..');
const CLI = path.resolve(import.meta.dir, '../bin/synapse.ts');
const CRM = path.join(root, 'examples', 'enterprise-crm');

interface CliResult {
  exitCode: number;
  json: Record<string, unknown> | null;
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, 'run', CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_ENV: 'development' },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  let json: Record<string, unknown> | null = null;

  try {
    json = JSON.parse(stdout.trim());
  } catch {
    json = null;
  }

  return { exitCode, json };
}

describe('a shipped application declares a reversible migration block', () => {
  it('rolls a real statement back and can re-apply it', async () => {
    // The shipped slices run inside a scratch application, so the rollback exercises
    // real committed files without depending on a developer's local database state.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-rollback-'));
    fs.cpSync(path.join(CRM, 'src'), path.join(scratch, 'src'), { recursive: true });
    fs.copyFileSync(path.join(CRM, 'package.json'), path.join(scratch, 'package.json'));
    fs.copyFileSync(path.join(CRM, 'tsconfig.json'), path.join(scratch, 'tsconfig.json'));

    try {
      const migrated = await runCli(['migrate'], scratch);
      expect(migrated.exitCode).toBe(0);
      expect(migrated.json?.status).toBe('PASS');

      const rolledBack = await runCli(['rollback', 'create-customer'], scratch);

      expect(rolledBack.exitCode).toBe(0);
      expect(rolledBack.json?.status).toBe('PASS');
      expect(Number(rolledBack.json?.totalRolledBack)).toBeGreaterThan(0);

      // The records are removed with the statements, so migrating re-applies them.
      const restored = await runCli(['migrate'], scratch);
      expect(restored.exitCode).toBe(0);
      expect(restored.json?.status).toBe('PASS');
      expect(Number(restored.json?.statementsApplied)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('reports every optional contract item as exercised by a committed slice', async () => {
    const result = await runCli(['coverage'], root);

    expect(result.exitCode).toBe(0);
    expect(result.json?.status).toBe('PASS');
    expect(result.json?.unexercised).toEqual([]);

    const covered = (result.json?.covered ?? []) as string[];
    for (const item of [
      'webhook',
      'background job',
      'websocket definition',
      'cache definition',
      'metadata generation',
      'broadcast',
      'subscription'
    ]) {
      expect(covered).toContain(item);
    }
  }, 30_000);

  it('ships a slice that generates its own metadata on the server', () => {
    const slice = fs.readFileSync(path.join(CRM, 'src', 'slices', 'customers', 'create-customer.slice.tsx'), 'utf-8');

    expect(slice).toContain('export const sliceMeta');
    expect(slice).toContain('-- down:');

    // The generated client bundle never carries the server-side metadata generator.
    const client = path.join(CRM, '.synapse', 'dist', 'create-customer', 'client.tsx');

    if (fs.existsSync(client)) {
      expect(fs.readFileSync(client, 'utf-8')).not.toContain('sliceMeta');
    }
  });
});
