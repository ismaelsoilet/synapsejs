import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildAllClientBundles,
  buildClientBundle,
  clientManifestPath,
  freshBundleFrom,
  readClientManifest
} from '../src/compiler/client-bundler';
import { artifactDirectory, splitSlice, writeSplitArtifacts } from '../src/compiler/slice-splitter';

const fixtureApp = path.resolve(import.meta.dir, 'fixtures', 'runtime-app');

describe('synapse build', () => {
  it('builds a real bundle for every slice that renders a component', async () => {
    const report = await buildAllClientBundles(fixtureApp);

    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }

    const ticket = report.value.entries.find((entry) => entry.slice === 'tickets/view-tickets');
    expect(ticket?.status).toBe('PASS');
    expect(ticket?.url).toBe('/_synapse/client/tickets-view-tickets.js');

    const bundleFile = path.join(fixtureApp, '.synapse', 'client', 'tickets-view-tickets.js');
    expect(fs.existsSync(bundleFile)).toBe(true);
    expect(fs.statSync(bundleFile).size).toBeGreaterThan(1000);
  });

  it('builds a client that uses the client entry, and the bundle carries no server code', async () => {
    const fixturesApp = path.resolve(import.meta.dir, 'fixtures', 'slices');
    const sliceFile = path.join(fixturesApp, 'clients', 'browser-helper.slice.tsx');

    const split = splitSlice(sliceFile, fixturesApp);
    expect(split.ok).toBe(true);
    if (!split.ok) {
      return;
    }
    writeSplitArtifacts(split.value, artifactDirectory(fixturesApp, split.value.sliceName));

    const bundle = await buildClientBundle(
      {
        key: 'clients/browser-helper',
        name: 'browser-helper',
        domain: 'clients',
        filePath: sliceFile,
        rpcPath: '/_synapse/rpc/clients/browser-helper'
      },
      fixturesApp
    );

    expect(bundle.ok).toBe(true);
    if (!bundle.ok) {
      return;
    }

    const code = fs.readFileSync(bundle.value.filePath, 'utf-8');
    expect(bundle.value.bytes).toBeGreaterThan(1000);
    expect(code).not.toContain('bun:sqlite');
    expect(code).not.toContain('password_hash');
    expect(code).toContain('synapse_token');
  });

  it('reports a slice that cannot be imported as FAIL with its reason, without crashing the build', async () => {
    const report = await buildAllClientBundles(fixtureApp);

    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }

    const broken = report.value.entries.find((entry) => entry.slice === 'broken/cannot-load');
    expect(broken?.status).toBe('FAIL');
    expect(broken?.code).toBe('IMPORT_FAILED');
    expect(broken?.reason).toContain('falha proposital');
    expect(report.value.entries.some((entry) => entry.slice === 'tickets/view-tickets')).toBe(true);
  });

  it('writes a manifest that lets the runtime skip the bundler', async () => {
    await buildAllClientBundles(fixtureApp);

    const manifest = readClientManifest(fixtureApp);
    expect(manifest?.version).toBe(1);
    expect(fs.existsSync(clientManifestPath(fixtureApp))).toBe(true);

    const sliceFile = path.join(fixtureApp, 'src', 'slices', 'tickets', 'view-tickets.slice.tsx');
    const fresh = freshBundleFrom(manifest, 'tickets/view-tickets', fs.statSync(sliceFile).mtimeMs);
    expect(fresh).toBe('/_synapse/client/tickets-view-tickets.js');
  });

  it('ignores the pre-built bundle once the slice changes', () => {
    const manifest = { version: 1 as const, bundles: { 'tickets/view-tickets': { url: '/x.js', mtimeMs: 111 } } };

    expect(freshBundleFrom(manifest, 'tickets/view-tickets', 111)).toBe('/x.js');
    expect(freshBundleFrom(manifest, 'tickets/view-tickets', 222)).toBeNull();
    expect(freshBundleFrom(manifest, 'outra/slice', 111)).toBeNull();
    expect(freshBundleFrom(null, 'tickets/view-tickets', 111)).toBeNull();
  });

  it('is deterministic: two builds produce the same manifest', async () => {
    await buildAllClientBundles(fixtureApp);
    const first = fs.readFileSync(clientManifestPath(fixtureApp), 'utf-8');
    await buildAllClientBundles(fixtureApp);
    const second = fs.readFileSync(clientManifestPath(fixtureApp), 'utf-8');

    expect(second).toBe(first);
  });

  it('never reports PASS with zero slices to build', async () => {
    const emptyApp = fs.mkdtempSync(path.join(import.meta.dir, 'fixtures', 'empty-build-'));

    const report = await buildAllClientBundles(emptyApp);

    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.error.code).toBe('NO_SLICES_DIR');
    }

    fs.rmSync(emptyApp, { recursive: true, force: true });
  });
});
