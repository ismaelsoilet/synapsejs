import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../src/compiler/slice-splitter';
import { generateOperationTemplate, type SliceTemplate } from '../src/compiler/slice-templates';

const generatedRoot = path.resolve(import.meta.dir, 'fixtures', 'generated');

afterAll(() => {
  fs.rmSync(generatedRoot, { recursive: true, force: true });
});

function generate(template: SliceTemplate, name: string): { appDir: string; file: string } {
  const appDir = path.join(generatedRoot, template);
  const file = path.join(appDir, 'src', 'slices', 'coisas', `${name}.slice.tsx`);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generateOperationTemplate('coisas', name, template), 'utf-8');

  return { appDir, file };
}

describe('slice templates', () => {
  for (const template of ['list', 'update', 'delete', 'login'] as const) {
    it(`${template}: the generated slice compiles and leaks nothing`, () => {
      const { appDir, file } = generate(template, `${template}-coisa`);

      const split = splitSlice(file, appDir);
      expect(split.ok).toBe(true);
      if (!split.ok) {
        return;
      }

      const outDir = artifactDirectory(appDir, split.value.sliceName);
      writeSplitArtifacts(split.value, outDir);

      const verification = verifySplit(split.value, outDir);
      expect(verification.diagnostics).toEqual([]);
      expect(verification.leaks).toEqual([]);
    });
  }

  it('update builds its SQL from an allowlist, never from the payload', () => {
    const source = generateOperationTemplate('coisas', 'update-coisa', 'update');

    expect(source).toContain('const UPDATABLE_COLUMNS');
    expect(source).toContain('Object.entries(UPDATABLE_COLUMNS)');
    expect(source).toContain("return Err('NOTHING_TO_UPDATE')");
    expect(source).not.toContain('Object.keys(input)');
  });

  it('list paginates with a ceiling and a parameterized filter', () => {
    const source = generateOperationTemplate('coisas', 'list-coisa', 'list');

    expect(source).toContain('LIMIT $2 OFFSET $3');
    expect(source).toContain('MAX_LIMIT = 100');
    expect(source).toContain("name LIKE '%' || $1 || '%'");
    expect(source).toContain('SELECT COUNT(*) AS total');
  });

  it('delete checks existence before deleting', () => {
    const source = generateOperationTemplate('coisas', 'delete-coisa', 'delete');

    expect(source).toContain("return Err('NOT_FOUND')");
    expect(source.indexOf('SELECT id FROM')).toBeLessThan(source.indexOf('DELETE FROM'));
  });

  it('login verifies with Bun.password and signs the session instead of trusting a header', () => {
    const source = generateOperationTemplate('auth', 'login', 'login');

    expect(source).toContain('Bun.password.verify');
    expect(source).toContain('signSessionToken');
    expect(source).toContain('process.env.SYNAPSE_SESSION_SECRET');
    expect(source).toContain("return Err('MISSING_SECRET')");
    expect(source).toContain('storeSession');
    expect(source).toContain('verifySessionToken');
  });

  it('every template declares an oracle and a component', () => {
    for (const template of ['list', 'update', 'delete', 'login'] as const) {
      const source = generateOperationTemplate('coisas', `${template}-coisa`, template);

      expect(source).toContain('export const sliceTests');
      expect(source).toContain('cases: [');
      expect(source).toContain('Trigger(');
    }
  });
});
