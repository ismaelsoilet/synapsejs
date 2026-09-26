import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findSliceFiles, resolveSlicesDir } from '../src/compiler/slice-discovery';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-discovery-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  delete process.env.SYNAPSE_ROOT;
});

function writeSlice(appDir: string, domain: string, name: string): string {
  const slicesDir = path.join(appDir, 'src', 'slices');
  const target = path.join(slicesDir, domain, `${name}.slice.tsx`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '// slice fixture\n', 'utf-8');
  return slicesDir;
}

function writeWorkspaceRoot(root: string, globs: string[]): void {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-root', private: true, workspaces: globs }, null, 2),
    'utf-8'
  );
}

describe('findSliceFiles', () => {
  it('returns an empty array for a missing directory', () => {
    expect(findSliceFiles(path.join(sandbox, 'does-not-exist'))).toEqual([]);
  });

  it('finds slices recursively', () => {
    const appDir = path.join(sandbox, 'app');
    const slicesDir = writeSlice(appDir, 'billing', 'generate-invoice');
    writeSlice(appDir, 'customers', 'create-customer');

    const found = findSliceFiles(slicesDir)
      .map((f) => path.basename(f))
      .sort();
    expect(found).toEqual(['create-customer.slice.tsx', 'generate-invoice.slice.tsx']);
  });
});

describe('resolveSlicesDir', () => {
  it('resolves a direct src/slices directory', () => {
    const appDir = path.join(sandbox, 'app');
    const slicesDir = writeSlice(appDir, 'billing', 'generate-invoice');

    const resolution = resolveSlicesDir(appDir);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.value.slicesDir).toBe(slicesDir);
      expect(resolution.value.projectRoot).toBe(appDir);
    }
  });

  it('resolves the single workspace member that owns slices', () => {
    writeWorkspaceRoot(sandbox, ['packages/*', 'apps/*']);
    fs.mkdirSync(path.join(sandbox, 'packages', 'lib'), { recursive: true });
    const slicesDir = writeSlice(path.join(sandbox, 'apps', 'crm'), 'billing', 'generate-invoice');

    const resolution = resolveSlicesDir(sandbox);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.value.slicesDir).toBe(slicesDir);
    }
  });

  it('refuses to guess when several workspace members own slices', () => {
    writeWorkspaceRoot(sandbox, ['apps/*']);
    writeSlice(path.join(sandbox, 'apps', 'crm'), 'billing', 'generate-invoice');
    writeSlice(path.join(sandbox, 'apps', 'shop'), 'orders', 'create-order');

    const resolution = resolveSlicesDir(sandbox);

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.error.code).toBe('AMBIGUOUS_SLICES_DIR');
      expect(resolution.error.candidates.length).toBe(2);
    }
  });

  it('reports NO_SLICES_DIR with every candidate examined', () => {
    writeWorkspaceRoot(sandbox, ['apps/*']);
    fs.mkdirSync(path.join(sandbox, 'apps', 'empty'), { recursive: true });

    const resolution = resolveSlicesDir(sandbox);

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.error.code).toBe('NO_SLICES_DIR');
      expect(resolution.error.candidates).toContain(path.join(sandbox, 'src', 'slices'));
      expect(resolution.error.candidates).toContain(path.join(sandbox, 'apps', 'empty', 'src', 'slices'));
    }
  });

  it('honours SYNAPSE_ROOT over the working directory', () => {
    const appDir = path.join(sandbox, 'nested', 'app');
    const slicesDir = writeSlice(appDir, 'billing', 'generate-invoice');

    process.env.SYNAPSE_ROOT = path.join('nested', 'app');
    const resolution = resolveSlicesDir(sandbox);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.value.slicesDir).toBe(slicesDir);
    }
  });
});
