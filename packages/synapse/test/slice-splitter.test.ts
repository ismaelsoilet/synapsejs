import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  artifactDirectory,
  type SplitResult,
  splitSlice,
  verifySplit,
  writeSplitArtifacts
} from '../src/compiler/slice-splitter';

const fixturesDir = path.resolve(import.meta.dir, 'fixtures');
const slicesDir = path.join(fixturesDir, 'slices');

function slicePath(relative: string): string {
  return path.join(slicesDir, relative);
}

function splitOrFail(relative: string): SplitResult {
  const result = splitSlice(slicePath(relative), fixturesDir);
  if (!result.ok) {
    throw new Error(`splitSlice falhou: ${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function artifact(result: SplitResult, kind: 'shared' | 'server' | 'client'): string {
  const found = result.artifacts.find((item) => item.kind === kind);
  return found ? found.code : '';
}

afterAll(() => {
  fs.rmSync(path.join(fixturesDir, '.synapse'), { recursive: true, force: true });
});

describe('splitSlice', () => {
  it('partitions a slice into shared, server and client modules', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');

    expect(result.artifacts.map((item) => item.fileName)).toEqual(['shared.tsx', 'server.ts', 'client.tsx']);
  });

  it('keeps the action implementation, SQL and DDL out of the client', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');
    const client = artifact(result, 'client');
    const server = artifact(result, 'server');

    expect(server).toContain('INSERT INTO orders');
    expect(server).toContain('CREATE TABLE');
    expect(server).toContain('export async function createOrderAction');

    expect(client).not.toContain('INSERT INTO orders');
    expect(client).not.toContain('CREATE TABLE');
    expect(client).not.toContain('await db.query');
    expect(client).not.toContain('null as any');
  });

  it('emits an RPC stub when the component calls the action', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');
    const client = artifact(result, 'client');

    expect(client).toContain(`import { rpcCall } from 'synapsejs';`);
    expect(client).toContain(`rpcCall<OrderOutput>("/_synapse/rpc/create-order", payload)`);
    expect(client).not.toContain('Value.Check');
  });

  it('shares type contracts instead of degrading them', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');
    const shared = artifact(result, 'shared');

    expect(shared).toContain('export type OrderOutput');
    expect(shared).toContain(`from 'synapsejs'`);
  });

  it('carries a non-exported helper to every side that uses it', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');

    expect(artifact(result, 'client')).toContain('function formatAmount');
    expect(artifact(result, 'server')).toContain('function formatAmount');
  });

  it('preserves side-effect imports, re-anchored to the artifact directory', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');
    const client = artifact(result, 'client');

    expect(client).toMatch(/import '\.\.\/\.\.\/\.\.\/slices\/orders\/side-effect';/);
  });

  it('drops the test oracle and its fast-check import from the runtime bundles', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');

    for (const item of result.artifacts) {
      expect(item.code).not.toContain('fast-check');
      expect(item.code).not.toContain('sliceTests');
    }
  });

  it('refuses a slice without any action or component', () => {
    const result = splitSlice(slicePath('contracts/contracts-only.slice.tsx'), fixturesDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_ROOTS');
    }
  });

  it('refuses a missing file', () => {
    const result = splitSlice(slicePath('orders/does-not-exist.slice.tsx'), fixturesDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SLICE_NOT_FOUND');
    }
  });
});

describe('verifySplit gates', () => {
  it('passes both gates on a clean slice', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');
    const outDir = artifactDirectory(fixturesDir, result.sliceName);

    writeSplitArtifacts(result, outDir);
    const verification = verifySplit(result, outDir);

    expect(verification.diagnostics).toEqual([]);
    expect(verification.leaks).toEqual([]);
    expect(verification.status).toBe('PASS');
  });

  it('fails the leak gate when the client reaches into the database', () => {
    const result = splitOrFail('reports/leaky-report.slice.tsx');
    const outDir = artifactDirectory(fixturesDir, result.sliceName);

    writeSplitArtifacts(result, outDir);
    const verification = verifySplit(result, outDir);

    expect(verification.status).toBe('FAIL');
    expect(verification.leaks).toContain('SELECT statement');
    expect(verification.leaks).toContain('database call');
  });

  it('fails the compilation gate when the emitted modules do not typecheck', () => {
    const result = splitOrFail('broken/broken.slice.tsx');
    const outDir = artifactDirectory(fixturesDir, result.sliceName);

    writeSplitArtifacts(result, outDir);
    const verification = verifySplit(result, outDir);

    expect(verification.status).toBe('FAIL');
    expect(verification.diagnostics.some((item) => item.file === 'client.tsx')).toBe(true);
  });

  it('writes the three artifacts to the slice directory', () => {
    const result = splitOrFail('orders/create-order.slice.tsx');
    const outDir = artifactDirectory(fixturesDir, result.sliceName);
    const written = writeSplitArtifacts(result, outDir);

    expect(written.length).toBe(3);
    for (const target of written) {
      expect(fs.existsSync(target)).toBe(true);
    }
  });
});
