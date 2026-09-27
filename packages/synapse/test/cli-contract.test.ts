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
    expect(result.json?.totalSlices).toBe(0);
    expect(Array.isArray(result.json?.candidates)).toBe(true);
  });

  it('reports one named entry per invariant', async () => {
    const sliceDir = path.join(sandbox, 'src', 'slices', 'demo');
    fs.mkdirSync(sliceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sliceDir, 'always-ok.slice.tsx'),
      [
        'export const sliceTests = {',
        `  description: 'fixture',`,
        '  cases: [',
        `    { name: 'invariante que passa', run: async () => {} },`,
        `    { name: 'outro invariante', run: async () => {} }`,
        '  ]',
        '};',
        ''
      ].join('\n'),
      'utf-8'
    );

    const result = await runCli(['test']);

    expect(result.exitCode).toBe(0);
    expect(result.json?.status).toBe('PASS');
    expect(result.json?.totalSlices).toBe(1);
    expect(result.json?.passedSlices).toBe(1);
    expect(result.json?.totalCases).toBe(2);
    expect(result.json?.results[0].cases.map((item: { name: string }) => item.name)).toEqual([
      'invariante que passa',
      'outro invariante'
    ]);
  });

  it('fails when a slice declares an empty case list', async () => {
    const sliceDir = path.join(sandbox, 'src', 'slices', 'demo');
    fs.mkdirSync(sliceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sliceDir, 'empty.slice.tsx'),
      ['export const sliceTests = { description: "sem invariantes", cases: [] };', ''].join('\n'),
      'utf-8'
    );

    const result = await runCli(['test']);

    expect(result.exitCode).toBe(1);
    expect(result.json?.status).toBe('FAIL');
    expect(result.json?.results[0].passed).toBe(false);
    expect(result.json?.results[0].cases[0].passed).toBe(false);
  });

  it('fails, names the broken invariant and surfaces its message', async () => {
    const sliceDir = path.join(sandbox, 'src', 'slices', 'demo');
    fs.mkdirSync(sliceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sliceDir, 'broken.slice.tsx'),
      [
        'export const sliceTests = {',
        `  cases: [`,
        `    { name: 'quebrado de proposito', run: async () => { throw new Error('invariante violada'); } }`,
        '  ]',
        '};',
        ''
      ].join('\n'),
      'utf-8'
    );

    const result = await runCli(['test']);

    expect(result.exitCode).toBe(1);
    expect(result.json?.status).toBe('FAIL');
    expect(result.json?.passedSlices).toBe(0);
    expect(result.json?.results[0].cases[0].passed).toBe(false);
    expect(result.json?.results[0].cases[0].name).toBe('quebrado de proposito');
    expect(result.json?.results[0].cases[0].message).toContain('invariante violada');
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

describe('zero-verification guards', () => {
  it('check fails when the tsconfig matches no file', async () => {
    fs.writeFileSync(
      path.join(sandbox, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*'] }),
      'utf-8'
    );

    const result = await runCli(['check']);

    expect(result.exitCode).toBe(1);
    expect(result.json?.status).toBe('FAIL');
    expect(result.json?.code).toBe('NO_FILES_MATCHED');
  });

  it('skeleton fails when no module can be mapped', async () => {
    fs.writeFileSync(
      path.join(sandbox, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*'] }),
      'utf-8'
    );

    const result = await runCli(['skeleton']);

    expect(result.exitCode).toBe(1);
    expect(result.json?.status).toBe('FAIL');
    expect(result.json?.code).toBe('EMPTY_REPO_MAP');
    expect(result.json?.totalModules).toBe(0);
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
    expect(pkg.dependencies['@ismaelsoilet/synapsejs'] || pkg.dependencies.synapsejs).toBe('^1.1.0');
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

describe('synapse contract', () => {
  it('describes the slice contract without the agent reading any source', async () => {
    const result = await runCli(['contract']);

    expect(result.exitCode).toBe(0);
    expect(result.json?.slice.location).toBe('src/slices/<domain>/<name>.slice.tsx');
    expect(Array.isArray(result.json?.slice.exports)).toBe(true);
    expect(result.json?.slice.example).toContain('sliceTests');
    expect(result.json?.gates.length).toBeGreaterThan(0);
  });
});

describe('synapse new-slice --template', () => {
  it('generates a paginated list slice instead of a create slice', async () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-template-'));
    fs.mkdirSync(path.join(app, 'src', 'slices', 'coisas'), { recursive: true });

    const result = await runCli(['new-slice', 'coisas', 'listar-coisa', '--template=list'], app);

    expect(result.exitCode).toBe(0);
    const source = fs.readFileSync(path.join(app, result.json?.createdPath as string), 'utf-8');
    expect(source).toContain('LIMIT $2 OFFSET $3');
    expect(source).toContain('export const sliceTests');
  });

  it('refuses an unknown template with a machine-readable error', async () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-template-'));
    fs.mkdirSync(path.join(app, 'src', 'slices', 'coisas'), { recursive: true });

    const result = await runCli(['new-slice', 'coisas', 'x', '--template=banana'], app);

    expect(result.exitCode).toBe(1);
    expect(result.json?.code).toBe('UNKNOWN_TEMPLATE');
    expect(result.json?.templates).toContain('crud');
  });

  it('generates the four crud slices in one call', async () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-template-'));
    fs.mkdirSync(path.join(app, 'src', 'slices', 'coisas'), { recursive: true });

    const result = await runCli(['new-slice', 'coisas', 'coisa', '--template=crud'], app);

    expect(result.exitCode).toBe(0);
    expect(result.json?.createdPaths.length).toBe(4);
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
