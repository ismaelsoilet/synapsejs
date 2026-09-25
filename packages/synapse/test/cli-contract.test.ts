import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(import.meta.dir, '../bin/synapse.ts');

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-cli-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function cliEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.SYNAPSE_ROOT;
  return env;
}

async function runCli(args: string[], cwd: string = sandbox) {
  const proc = Bun.spawn([process.execPath, 'run', CLI, ...args], {
    cwd,
    env: cliEnv(),
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  let json: any = null;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    json = null;
  }

  return { stdout, stderr, exitCode, json };
}

describe('synapse test', () => {
  it('never reports PASS when no slices were discovered', async () => {
    const result = await runCli(['test']);

    expect(result.exitCode).toBe(1);
    expect(result.json?.status).toBe('FAIL');
    expect(result.json?.code).toBe('NO_SLICES_DIR');
    expect(result.json?.totalSlices).toBeUndefined();
  });

  it('runs the slices it finds and reports them', async () => {
    const sliceDir = path.join(sandbox, 'src', 'slices', 'demo');
    fs.mkdirSync(sliceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sliceDir, 'always-ok.slice.tsx'),
      ['export const sliceTests = { run: async () => true };', 'if (import.meta.main) process.exit(0);', ''].join('\n'),
      'utf-8'
    );

    const result = await runCli(['test']);

    expect(result.exitCode).toBe(0);
    expect(result.json?.status).toBe('PASS');
    expect(result.json?.totalSlices).toBe(1);
    expect(result.json?.passedSlices).toBe(1);
  });
});

describe('synapse migrate', () => {
  it('fails loudly instead of reporting an empty PASS', async () => {
    const result = await runCli(['migrate']);

    expect(result.exitCode).toBe(1);
    expect(result.json?.status).toBe('FAIL');
    expect(result.json?.code).toBe('NO_SLICES_DIR');
  });
});

describe('synapse new-slice', () => {
  it('writes a slice that imports from the package entry', async () => {
    const result = await runCli(['new-slice', 'billing', 'create-invoice']);

    expect(result.exitCode).toBe(0);
    expect(result.json?.status).toBe('PASS');

    const created = path.join(sandbox, 'src', 'slices', 'billing', 'create-invoice.slice.tsx');
    expect(fs.existsSync(created)).toBe(true);
    expect(fs.readFileSync(created, 'utf-8')).toContain(`from 'synapsejs'`);
  });
});

describe('synapse new', () => {
  it('generates a project that does not depend on this monorepo', async () => {
    const result = await runCli(['new', 'my-app']);

    expect(result.exitCode).toBe(0);

    const projectDir = path.join(sandbox, 'my-app');
    const manifest = fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(manifest);

    expect(pkg.name).toBe('my-app');
    expect(pkg.dependencies.synapsejs).toBe('^0.4.0');
    expect(manifest).not.toContain('workspace:*');
    expect(pkg.engines.bun).toBeDefined();

    const tsconfig = fs.readFileSync(path.join(projectDir, 'tsconfig.json'), 'utf-8');
    expect(tsconfig).not.toContain('packages/synapse');

    expect(fs.existsSync(path.join(projectDir, 'src', 'slices', 'welcome', 'hello-world.slice.tsx'))).toBe(true);
  });

  it('refuses to overwrite an existing directory', async () => {
    fs.mkdirSync(path.join(sandbox, 'taken'), { recursive: true });

    const result = await runCli(['new', 'taken']);

    expect(result.exitCode).toBe(1);
  });
});

describe('synapse info', () => {
  it('reports every feature with a status and verifiable evidence', async () => {
    const result = await runCli(['info']);

    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.json?.features)).toBe(true);
    expect(result.json.features.length).toBeGreaterThan(0);

    for (const feature of result.json.features) {
      expect(['stable', 'experimental', 'roadmap']).toContain(feature.status);
      expect(typeof feature.evidence).toBe('string');
      expect(feature.evidence.length).toBeGreaterThan(0);
    }
  });
});
