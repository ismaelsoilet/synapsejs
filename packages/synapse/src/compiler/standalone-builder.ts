/**
 * SynapseJS - Standalone Production Build Generator
 *
 * Produces an ultra-optimized, self-contained deployment package under `.synapse/standalone/`
 * containing pre-compiled client bundles, server-side slice execution runtime,
 * static assets, and minimal production package.json for zero-dependency container deployment.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Err, Ok, type Result } from '../core/machine-types';
import { type BuildReportEntry, buildAllClientBundles } from './client-bundler';
import { resolveSlicesDir, type SlicesDirError } from './slice-discovery';

export interface StandaloneBuildResult {
  status: 'PASS' | 'FAIL';
  outDir: string;
  clientBundlesCount: number;
  totalBytes: number;
  serverEntry: string;
  entries: BuildReportEntry[];
}

export async function buildStandalone(
  appRoot: string
): Promise<Result<StandaloneBuildResult, SlicesDirError | { code: string; message: string }>> {
  const resolution = resolveSlicesDir(appRoot);
  if (!resolution.ok) {
    return Err(resolution.error);
  }

  // 1. Pre-build all client bundles and manifest
  const clientBuild = await buildAllClientBundles(appRoot);
  if (!clientBuild.ok) {
    return Err(clientBuild.error);
  }

  const standaloneDir = path.join(appRoot, '.synapse', 'standalone');
  fs.rmSync(standaloneDir, { recursive: true, force: true });
  fs.mkdirSync(standaloneDir, { recursive: true });

  // 2. Copy pre-built client bundles
  const clientSrc = path.join(appRoot, '.synapse', 'client');
  const clientDest = path.join(standaloneDir, '.synapse', 'client');
  if (fs.existsSync(clientSrc)) {
    fs.cpSync(clientSrc, clientDest, { recursive: true });
  }

  // 3. Copy public/ if present
  const publicSrc = path.join(appRoot, 'public');
  const publicDest = path.join(standaloneDir, 'public');
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true });
  }

  // 4. Copy slices for server-side SSR and actions
  const slicesSrc = resolution.value.slicesDir;
  const relSlices = path.relative(appRoot, slicesSrc);
  const slicesDest = path.join(standaloneDir, relSlices);
  fs.mkdirSync(path.dirname(slicesDest), { recursive: true });
  fs.cpSync(slicesSrc, slicesDest, { recursive: true });

  // 5. Copy package.json & tsconfig.json if present
  const pkgSrc = path.join(appRoot, 'package.json');
  if (fs.existsSync(pkgSrc)) {
    fs.copyFileSync(pkgSrc, path.join(standaloneDir, 'package.json'));
  }

  const tsconfigSrc = path.join(appRoot, 'tsconfig.json');
  if (fs.existsSync(tsconfigSrc)) {
    fs.copyFileSync(tsconfigSrc, path.join(standaloneDir, 'tsconfig.json'));
  }

  // 6. Write standalone server bootstrap
  const serverEntryCode = `/**
 * SynapseJS Standalone Production Server
 */
import { SynapseServer } from 'synapsejs';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const server = new SynapseServer(import.meta.dir, port);

console.log(\`⚡ [SynapseJS Standalone] Iniciando servidor de produção na porta \${port}...\`);
await server.discoverSlices();
await server.start();
`;

  const serverEntryPath = path.join(standaloneDir, 'server.ts');
  fs.writeFileSync(serverEntryPath, serverEntryCode, 'utf-8');

  // Compute stats
  let totalBytes = 0;
  function computeDirSize(dir: string) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        computeDirSize(full);
      } else if (item.isFile()) {
        totalBytes += fs.statSync(full).size;
      }
    }
  }
  computeDirSize(standaloneDir);

  const passedEntries = clientBuild.value.entries.filter((e) => e.status === 'PASS');

  return Ok({
    status: 'PASS',
    outDir: standaloneDir,
    clientBundlesCount: passedEntries.length,
    totalBytes,
    serverEntry: serverEntryPath,
    entries: clientBuild.value.entries
  });
}
