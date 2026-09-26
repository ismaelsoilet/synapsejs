import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { findSliceFiles, resolveSlicesDir } from '../src/compiler/slice-discovery';

const repoRoot = path.resolve(import.meta.dir, '../../..');

const apps = ['examples/enterprise-crm', 'examples/helpdesk-slices', 'packages/synapse/templates/starter'];

function sliceFilesOf(app: string): string[] {
  const resolution = resolveSlicesDir(path.join(repoRoot, app));
  if (!resolution.ok) {
    throw new Error(`${app}: ${resolution.error.code}`);
  }
  return findSliceFiles(resolution.value.slicesDir);
}

/**
 * The framework's central claim is that a feature is one file. If a slice stops
 * exporting one of its pieces — because someone moved the action or the UI into a
 * sibling module — this fails.
 */
describe('locality invariant (N = 1)', () => {
  for (const app of apps) {
    it(`${app}: each slice exports contract, action, UI and oracle from one file`, async () => {
      const sliceFiles = sliceFilesOf(app);
      expect(sliceFiles.length).toBeGreaterThan(0);

      for (const sliceFile of sliceFiles) {
        const module = (await import(sliceFile)) as Record<string, unknown>;
        const exported = Object.keys(module);

        expect(exported.filter((name) => name.endsWith('Schema')).length).toBeGreaterThan(0);
        expect(exported.filter((name) => name.endsWith('Action')).length).toBeGreaterThan(0);
        expect(exported.filter((name) => /(Trigger|View|Form|Component)$/.test(name)).length).toBeGreaterThan(0);
        expect(typeof module.sliceTests).toBe('object');
      }
    });
  }

  it('keeps features independent: no slice imports another slice', () => {
    for (const app of apps) {
      for (const sliceFile of sliceFilesOf(app)) {
        const source = fs.readFileSync(sliceFile, 'utf-8');
        const crossSliceImports = source.match(/from\s+['"][^'"]*\.slice['"]/g) ?? [];

        expect(crossSliceImports).toEqual([]);
      }
    }
  });
});
