import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { measureAppSurface, measureFeature } from '../src/compiler/context-bench';

const conventionalFixture = path.resolve(import.meta.dir, 'fixtures', 'conventional-app');

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-bench-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('measureFeature', () => {
  it('walks the import closure of the declared entry, in app-relative paths', () => {
    const surface = measureFeature(conventionalFixture, 'abrir chamado', ['src/routes/tickets.ts']);

    expect(surface.appFiles).toEqual([
      path.join('src', 'routes', 'tickets.ts'),
      path.join('src', 'services', 'ticket-service.ts')
    ]);
    expect(surface.appBytes).toBeGreaterThan(0);
    expect(surface.appTokensEstimate).toBe(Math.round(surface.appBytes * 0.25));
  });

  it('separates the app closure from the total closure', () => {
    const surface = measureFeature(conventionalFixture, 'abrir chamado', ['src/routes/tickets.ts']);

    expect(surface.totalFiles).toBeGreaterThanOrEqual(surface.appFiles.length);
  });

  it('is deterministic across runs', () => {
    const first = measureFeature(conventionalFixture, 'feature', ['src/routes/tickets.ts']);
    const second = measureFeature(conventionalFixture, 'feature', ['src/routes/tickets.ts']);

    expect(first).toEqual(second);
  });

  it('does not count node_modules or declaration files', () => {
    const surface = measureFeature(conventionalFixture, 'abrir chamado', ['src/routes/tickets.ts']);

    for (const file of surface.appFiles) {
      expect(file).not.toContain('node_modules');
      expect(file.endsWith('.d.ts')).toBe(false);
    }
  });
});

describe('measureAppSurface', () => {
  it('refuses an app without a bench config', () => {
    expect(() => measureAppSurface(sandbox)).toThrow(/bench.config.json/);
  });

  it('refuses a config that declares no feature', () => {
    fs.writeFileSync(
      path.join(sandbox, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*'] }),
      'utf-8'
    );
    fs.writeFileSync(path.join(sandbox, 'bench.config.json'), JSON.stringify({ features: {} }), 'utf-8');

    expect(() => measureAppSurface(sandbox)).toThrow(/nenhuma feature/);
  });
});
