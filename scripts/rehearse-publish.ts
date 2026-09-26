/**
 * SynapseJS - Publish Rehearsal
 *
 * Proves the packed artifact works for someone who is NOT inside this monorepo,
 * without publishing anything: packs the package, installs the tarball in a
 * throwaway project outside the repo, then exercises every entry point a
 * stranger would touch.
 *
 * It exists because a manual run of exactly this found two fatal packaging bugs:
 * `typescript` was a devDependency although the CLI imports it at runtime (every
 * command crashed on install), and the starter template's `.gitignore` never
 * reached the tarball because packagers drop that filename (generated projects
 * came out without an ignore file).
 *
 * Usage: bun run rehearse:publish [--keep]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(import.meta.dir, '..');
const packageDir = path.join(repoRoot, 'packages', 'synapse');
const keepArtifacts = process.argv.includes('--keep');

interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

const steps: StepResult[] = [];

function record(step: string, ok: boolean, detail?: string): void {
  steps.push({ step, ok, detail });
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

function parseJson(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{');
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(output.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emit(payload: Record<string, unknown>, ok: boolean): never {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(ok ? 0 : 1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-rehearsal-'));
const packDir = path.join(workDir, 'pack');
const consumerDir = path.join(workDir, 'consumer');
fs.mkdirSync(packDir);
fs.mkdirSync(consumerDir);

try {
  const packed = await run(['bun', 'pm', 'pack', '--destination', packDir], packageDir);
  const tarball = fs.readdirSync(packDir).find((file) => file.endsWith('.tgz'));
  if (!tarball) {
    record('pack', false, packed.output.trim().slice(-300));
    emit({ status: 'FAIL', operation: 'PUBLISH_REHEARSAL', steps }, false);
  }
  const tarballPath = path.join(packDir, tarball as string);
  record('pack', true, tarball);

  const listed = await run(['tar', '-tzf', tarballPath], workDir);
  const entries = listed.output.split('\n').filter((line) => line.trim().length > 0);

  if (!entries.includes('package/templates/starter/gitignore')) {
    record('template gitignore ships', false, 'o pack descarta .gitignore; o template precisa enviá-lo como gitignore');
  } else {
    record('template gitignore ships', true);
  }

  const leaked = entries.filter(
    (entry) => entry.includes('.synapse') || entry.includes('.codebase') || entry.includes('node_modules')
  );
  record('no generated output in the tarball', leaked.length === 0, leaked.join(', ') || undefined);

  const packedManifest = parseJson(
    (await run(['tar', '-xzOf', tarballPath, 'package/package.json'], workDir)).output
  ) as { dependencies?: Record<string, string> } | null;
  const runtimeDeps = packedManifest?.dependencies ?? {};
  const missingRuntimeDeps = ['typescript', '@sinclair/typebox', 'react', 'react-dom', 'fast-check', 'postgres'].filter(
    (dep) => !(dep in runtimeDeps)
  );
  record(
    'every runtime dependency is declared',
    missingRuntimeDeps.length === 0,
    missingRuntimeDeps.join(', ') || undefined
  );

  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2),
    'utf-8'
  );

  const installed = await run(['bun', 'add', tarballPath], consumerDir);
  if (installed.exitCode !== 0) {
    record('install outside the monorepo', false, installed.output.trim().slice(-300));
    emit({ status: 'FAIL', operation: 'PUBLISH_REHEARSAL', steps }, false);
  }
  record('install outside the monorepo', true);

  const synapseBin = path.join(consumerDir, 'node_modules', '.bin', 'synapse');

  const importProbe = path.join(consumerDir, 'probe.ts');
  fs.writeFileSync(
    importProbe,
    [
      `import { Ok, Err, Type, resolveSlicesDir, rpcCall, MockDatabaseClient, fc } from 'synapsejs';`,
      `console.log(JSON.stringify({ ok: [typeof Ok, typeof Err, typeof Type, typeof resolveSlicesDir, typeof rpcCall, typeof MockDatabaseClient, typeof fc] }));`,
      ''
    ].join('\n'),
    'utf-8'
  );
  const importRun = await run(['bun', 'run', 'probe.ts'], consumerDir);
  record('entry point imports', importRun.exitCode === 0 && importRun.output.includes('function'), importRun.output.trim().slice(-200));

  const info = await run([synapseBin, 'info'], consumerDir);
  record('synapse info runs', parseJson(info.output)?.status !== 'FAIL' && info.output.includes('"version"'));

  const created = await run([synapseBin, 'new', 'my-app'], consumerDir);
  const appDir = path.join(consumerDir, 'my-app');
  record('synapse new', created.exitCode === 0 && fs.existsSync(path.join(appDir, 'src', 'slices')), parseJson(created.output)?.status as string | undefined);
  record('generated project has a gitignore', fs.existsSync(path.join(appDir, '.gitignore')));

  const appManifestPath = path.join(appDir, 'package.json');
  const appManifest = fs.readFileSync(appManifestPath, 'utf-8').replace(
    /"synapsejs":\s*"[^"]+"/,
    `"synapsejs": "file:${tarballPath}"`
  );
  fs.writeFileSync(appManifestPath, appManifest, 'utf-8');

  const appInstall = await run(['bun', 'install'], appDir);
  record('generated project installs', appInstall.exitCode === 0, appInstall.output.trim().slice(-200));

  const appCheck = await run([synapseBin, 'check'], appDir);
  record('generated project typechecks', parseJson(appCheck.output)?.status === 'PASS');

  const appTest = await run([synapseBin, 'test'], appDir);
  const testReport = parseJson(appTest.output);
  record(
    'generated project oracles run',
    testReport?.status === 'PASS' && Number(testReport?.totalCases) > 0,
    `cases=${String(testReport?.totalCases ?? 0)}`
  );

  const appSkeleton = await run([synapseBin, 'skeleton'], appDir);
  record('generated project maps its modules', parseJson(appSkeleton.output)?.status === 'PASS');

  const appMigrate = await run([synapseBin, 'migrate'], appDir);
  record('generated project migrates', parseJson(appMigrate.output)?.status === 'PASS');

  const appSlice = await run([synapseBin, 'new-slice', 'tickets', 'escalate-ticket'], appDir);
  const sliceCreated = fs.existsSync(path.join(appDir, 'src', 'slices', 'tickets', 'escalate-ticket.slice.tsx'));
  record('scaffolder writes a slice', appSlice.exitCode === 0 && sliceCreated);

  const afterScaffold = await run([synapseBin, 'check'], appDir);
  record('scaffolded slice typechecks in the consumer project', parseJson(afterScaffold.output)?.status === 'PASS');

  const appSplit = await run([synapseBin, 'split'], appDir);
  record('scaffolded slice passes both splitter gates', parseJson(appSplit.output)?.status === 'PASS');

  const mcp = await run(
    [
      'bash',
      '-c',
      `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\\n' | timeout 20 ${synapseBin} mcp`
    ],
    appDir
  );
  record('MCP server answers a handshake', mcp.output.includes('"protocolVersion"') && mcp.output.includes('synapse_run_pbt'));

  const failed = steps.filter((step) => !step.ok);
  emit(
    {
      status: failed.length === 0 ? 'PASS' : 'FAIL',
      operation: 'PUBLISH_REHEARSAL',
      tarball,
      steps,
      ...(failed.length > 0 ? { failed: failed.map((step) => step.step) } : {}),
      workDir: keepArtifacts ? workDir : undefined
    },
    failed.length === 0
  );
} catch (error) {
  emit(
    {
      status: 'FAIL',
      operation: 'PUBLISH_REHEARSAL',
      steps,
      message: error instanceof Error ? error.message : String(error)
    },
    false
  );
} finally {
  if (!keepArtifacts) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
