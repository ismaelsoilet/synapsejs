import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCssBundle } from '../src/compiler/client-bundler';

let sandbox: string | undefined;

afterEach(() => {
  if (sandbox) {
    fs.rmSync(sandbox, { recursive: true, force: true });
    sandbox = undefined;
  }
});

describe('CSS bundle pipeline', () => {
  test('copies an application stylesheet into .synapse/client', async () => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-css-'));
    fs.mkdirSync(path.join(sandbox, 'src', 'styles'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'src', 'styles', 'main.css'), '.app { color: red; }', 'utf-8');

    const result = await buildCssBundle(sandbox);
    expect(result.ok).toBe(true);

    const output = path.join(sandbox, '.synapse', 'client', 'synapse.css');
    expect(fs.readFileSync(output, 'utf-8')).toBe('.app { color: red; }');
  });

  test('does not invent a theme when no stylesheet exists', async () => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-css-'));

    const result = await buildCssBundle(sandbox);
    expect(result.ok).toBe(true);

    expect(fs.existsSync(path.join(sandbox, '.synapse', 'client', 'synapse.css'))).toBe(false);
  });
});
