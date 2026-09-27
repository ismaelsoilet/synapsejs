/**
 * SynapseJS - Client Bundle Builder
 *
 * The runtime builds a browser bundle per slice on demand; `synapse build` builds
 * them ahead of time. Both go through this module, so what a deploy serves is
 * byte-for-byte what development produced — there is no second implementation to
 * keep in sync.
 *
 * The manifest is what makes the pre-build worth anything: it records the bundle
 * URL next to the modification time of the slice it came from, so the runtime can
 * serve the artifact without invoking the bundler, and rebuild the moment the slice
 * changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Err, Ok, type Result } from '../core/machine-types';
import { clientEntrySource } from '../runtime/client-entry';
import { isComponent } from '../runtime/discovery-rules';
import { findSliceFiles, resolveSlicesDir, type SlicesDirError } from './slice-discovery';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from './slice-splitter';

export const VENDOR_BUNDLE_NAME = '_vendor.js';
export const VENDOR_BUNDLE_URL = `/_synapse/client/${VENDOR_BUNDLE_NAME}`;

export interface BundleTarget {
  key: string;
  name: string;
  domain: string;
  filePath: string;
  rpcPath: string;
  vendorSplit?: boolean;
}

export interface BuiltBundle {
  sliceKey: string;
  url: string;
  filePath: string;
  bytes: number;
  mtimeMs: number;
}

export interface BundleLeak {
  sliceKey: string;
  leaks: string[];
}

export type BuildErrorCode = 'IMPORT_FAILED' | 'SPLIT_FAILED' | 'NO_COMPONENT' | 'NO_CLIENT_ARTIFACT' | 'BUNDLE_FAILED';

export interface BuildError {
  code: BuildErrorCode;
  message: string;
}

export interface ClientManifest {
  version: number;
  bundles: Record<string, { url: string; mtimeMs: number }>;
}

export function clientManifestPath(baseDir: string): string {
  return path.join(baseDir, '.synapse', 'client', 'manifest.json');
}

export async function buildVendorBundle(baseDir: string): Promise<Result<BuiltBundle, BuildError>> {
  const vendorEntryDir = path.join(baseDir, '.synapse/client-entry');
  fs.mkdirSync(vendorEntryDir, { recursive: true });
  const vendorEntryPath = path.join(vendorEntryDir, '_vendor.ts');

  const vendorEntryContent = [
    `import React from 'react';`,
    `import * as ReactDOM from 'react-dom';`,
    `import * as ReactDOMClient from 'react-dom/client';`,
    `import * as SynapseClient from 'synapsejs/client';`,
    ``,
    `export default React;`,
    `export * from 'react';`,
    `export * from 'react-dom';`,
    `export * from 'react-dom/client';`,
    `export * from 'synapsejs/client';`,
    `export { ReactDOM, ReactDOMClient, SynapseClient };`,
    ``
  ].join('\n');

  const existingEntry = fs.existsSync(vendorEntryPath) ? fs.readFileSync(vendorEntryPath, 'utf-8') : null;
  if (existingEntry !== vendorEntryContent) {
    fs.writeFileSync(vendorEntryPath, vendorEntryContent, 'utf-8');
  }

  const buildDir = path.join(baseDir, '.synapse/client');
  fs.mkdirSync(buildDir, { recursive: true });
  const vendorFile = path.join(buildDir, VENDOR_BUNDLE_NAME);

  if (fs.existsSync(vendorFile) && existingEntry === vendorEntryContent) {
    return Ok({
      sliceKey: '_vendor',
      url: VENDOR_BUNDLE_URL,
      filePath: vendorFile,
      bytes: fs.statSync(vendorFile).size,
      mtimeMs: fs.statSync(vendorEntryPath).mtimeMs
    });
  }

  const production = isProduction();

  try {
    const result = await Bun.build({
      entrypoints: [vendorEntryPath],
      target: 'browser',
      outdir: buildDir,
      naming: VENDOR_BUNDLE_NAME,
      minify: production,
      define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' }
    });

    const output = result.outputs[0];
    if (!result.success || !output) {
      return Err({
        code: 'BUNDLE_FAILED',
        message: `Falha ao empacotar vendor: ${result.logs.map((log) => String(log)).join('; ') || 'sem diagnóstico'}`
      });
    }

    return Ok({
      sliceKey: '_vendor',
      url: VENDOR_BUNDLE_URL,
      filePath: output.path,
      bytes: output.size,
      mtimeMs: fs.statSync(vendorEntryPath).mtimeMs
    });
  } catch (err) {
    return Err({ code: 'BUNDLE_FAILED', message: `_vendor: ${(err as Error).message}` });
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** The component name the runtime would render, read from the running module. */
export function componentExportOf(module: Record<string, unknown>): string | undefined {
  return Object.entries(module).find(
    ([exportName, value]) => typeof value === 'function' && isComponent(exportName)
  )?.[0];
}

export async function buildClientBundle(
  target: BundleTarget,
  baseDir: string
): Promise<Result<BuiltBundle, BuildError>> {
  // Uma fatia que não carrega não pode derrubar o build inteiro: ela vira FAIL com o motivo.
  let sliceModule: Record<string, unknown>;
  try {
    sliceModule = (await import(target.filePath)) as Record<string, unknown>;
  } catch (err) {
    return Err({ code: 'IMPORT_FAILED', message: `${target.key}: ${(err as Error).message}` });
  }

  const componentExport = componentExportOf(sliceModule);

  if (!componentExport) {
    return Err({
      code: 'NO_COMPONENT',
      message: `${target.key} não exporta nenhum *Trigger|*View|*Form|*Component`
    });
  }

  const split = splitSlice(target.filePath, baseDir);
  if (!split.ok) {
    return Err({ code: 'SPLIT_FAILED', message: split.error.message });
  }

  const outDir = artifactDirectory(baseDir, split.value.sliceName);
  writeSplitArtifacts(split.value, outDir);

  const clientArtifact = split.value.artifacts.find((artifact) => artifact.kind === 'client');
  if (!clientArtifact) {
    return Err({ code: 'NO_CLIENT_ARTIFACT', message: `${target.key} não produziu um módulo de cliente` });
  }

  // O gate roda antes de empacotar: sem isto um vazamento só apareceria como falha
  // obscura de bundle, ou pior, seria servido ao browser sem ninguém notar.
  const verification = verifySplit(split.value, outDir);
  if (verification.status === 'FAIL') {
    const diagnostic = verification.diagnostics[0];
    const detail = verification.leaks.length
      ? `vazamento no cliente: ${verification.leaks.join(', ')}`
      : `erro de compilação: ${diagnostic?.file ?? '?'}:${diagnostic?.line ?? 0} ${diagnostic?.message ?? ''}`;

    return Err({ code: 'SPLIT_FAILED', message: `${target.key}: ${detail}` });
  }

  const entryDir = path.join(baseDir, '.synapse/client-entry');
  fs.mkdirSync(entryDir, { recursive: true });
  const entryPath = path.join(entryDir, `${target.domain}-${target.name}.tsx`);
  const modulePath = path.relative(entryDir, path.join(outDir, clientArtifact.fileName)).split(path.sep).join('/');

  fs.writeFileSync(
    entryPath,
    clientEntrySource({
      componentName: componentExport,
      clientModulePath: `./${modulePath}`,
      rpcPath: target.rpcPath
    }),
    'utf-8'
  );

  const vendorSplit = target.vendorSplit ?? true;
  if (vendorSplit) {
    const vendorFile = path.join(baseDir, '.synapse/client', VENDOR_BUNDLE_NAME);
    if (!fs.existsSync(vendorFile)) {
      await buildVendorBundle(baseDir);
    }
  }

  // Em produção o bundle é minificado e usa a build de produção do React (~4x menor).
  const production = isProduction();
  const buildDir = path.join(baseDir, '.synapse/client');
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entryPath],
      target: 'browser',
      outdir: buildDir,
      naming: '[name].js',
      minify: production,
      external: vendorSplit
        ? ['react', 'react-dom', 'react-dom/client', 'synapsejs/client', '@ismaelsoilet/synapsejs/client']
        : [],
      define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' }
    });
  } catch (err) {
    // Bun.build pode lançar AggregateError em vez de retornar success:false: o motivo
    // real está nos erros agregados, e um deles diz qual módulo não resolveu.
    const aggregated = (err as { errors?: unknown[] }).errors ?? [];
    const details = aggregated.map((item) => String((item as Error)?.message ?? item)).join('; ');

    return Err({ code: 'BUNDLE_FAILED', message: `${target.key}: ${details || (err as Error).message}` });
  }

  const output = result.outputs[0];
  if (!result.success || !output) {
    return Err({
      code: 'BUNDLE_FAILED',
      message: `${target.key}: ${result.logs.map((log) => String(log)).join('; ') || 'sem diagnóstico'}`
    });
  }

  return Ok({
    sliceKey: target.key,
    url: `/_synapse/client/${path.basename(output.path)}`,
    filePath: output.path,
    bytes: output.size,
    mtimeMs: fs.statSync(target.filePath).mtimeMs
  });
}

export function readClientManifest(baseDir: string): ClientManifest | null {
  const manifestFile = clientManifestPath(baseDir);

  if (!fs.existsSync(manifestFile)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as ClientManifest;
    return parsed?.version === 1 && typeof parsed.bundles === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Writes the manifest sorted by slice key and without timestamps: the same slices
 * always produce the same file, so a diff means something really changed.
 */
export function writeClientManifest(baseDir: string, bundles: BuiltBundle[]): string {
  const manifestFile = clientManifestPath(baseDir);
  const bundlesByKey: ClientManifest['bundles'] = {};

  for (const bundle of [...bundles].sort((left, right) => left.sliceKey.localeCompare(right.sliceKey))) {
    bundlesByKey[bundle.sliceKey] = { url: bundle.url, mtimeMs: bundle.mtimeMs };
  }

  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, `${JSON.stringify({ version: 1, bundles: bundlesByKey }, null, 2)}\n`, 'utf-8');

  return manifestFile;
}

/** The pre-built bundle for a slice, but only while the slice has not changed since. */
export function freshBundleFrom(manifest: ClientManifest | null, sliceKey: string, mtimeMs: number): string | null {
  const entry = manifest?.bundles[sliceKey];

  return entry && entry.mtimeMs === mtimeMs ? entry.url : null;
}

export interface BuildReportEntry {
  slice: string;
  status: 'PASS' | 'SKIP' | 'FAIL';
  url?: string;
  bytes?: number;
  reason?: string;
  code?: string;
}

/**
 * Builds every slice that renders a component, ahead of time.
 *
 * A slice without UI is reported as SKIP, not FAIL: only a slice that has a
 * component and fails to produce a bundle is a broken build.
 */
export async function buildAllClientBundles(
  appRoot: string
): Promise<Result<{ entries: BuildReportEntry[]; manifestFile: string }, SlicesDirError>> {
  const resolution = resolveSlicesDir(appRoot);

  if (!resolution.ok) {
    return Err(resolution.error);
  }

  const slicesDir = resolution.value.slicesDir;
  const entries: BuildReportEntry[] = [];
  const built: BuiltBundle[] = [];

  const vendorRes = await buildVendorBundle(appRoot);
  if (vendorRes.ok) {
    built.push(vendorRes.value);
    entries.push({ slice: '_vendor', status: 'PASS', url: vendorRes.value.url, bytes: vendorRes.value.bytes });
  }

  for (const file of findSliceFiles(slicesDir)) {
    const domain = path.relative(slicesDir, file).split(path.sep)[0] || 'general';
    const name = path.basename(file, '.slice.tsx');
    const key = `${domain}/${name}`;

    const bundle = await buildClientBundle(
      { key, name, domain, filePath: file, rpcPath: `/_synapse/rpc/${domain}/${name}` },
      appRoot
    );

    if (bundle.ok) {
      built.push(bundle.value);
      entries.push({ slice: key, status: 'PASS', url: bundle.value.url, bytes: bundle.value.bytes });
      continue;
    }

    if (bundle.error.code === 'NO_COMPONENT') {
      entries.push({ slice: key, status: 'SKIP', reason: bundle.error.message });
      continue;
    }

    entries.push({ slice: key, status: 'FAIL', code: bundle.error.code, reason: bundle.error.message });
  }

  return Ok({ entries, manifestFile: writeClientManifest(appRoot, built) });
}
