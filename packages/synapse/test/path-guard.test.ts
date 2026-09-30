import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import { isInsideBase, MAX_PATH_SEGMENT_LENGTH, resolveWithinBase, validatePathSegment } from '../src/core/path-guard';

describe('validatePathSegment', () => {
  it('accepts an ordinary single segment', () => {
    for (const name of ['billing', 'create-invoice', 'oauth2_client', 'contrato-2026.pdf']) {
      const result = validatePathSegment(name);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(name);
      }
    }
  });

  it('rejects an empty or blank segment', () => {
    for (const name of ['', '   ', null, undefined]) {
      expect(validatePathSegment(name as string).ok).toBe(false);
    }
  });

  it('rejects separators', () => {
    for (const name of ['a/b', 'a\\b', '/etc/passwd', 'sub/dir.txt']) {
      expect(validatePathSegment(name).ok).toBe(false);
    }
  });

  it('rejects parent traversal', () => {
    for (const name of ['..', '../..', 'a/../b', '..\\..\\x', 'a..b']) {
      expect(validatePathSegment(name).ok).toBe(false);
    }
  });

  it('rejects absolute prefixes and drive letters', () => {
    for (const name of ['/tmp', 'C:', 'C:\\Windows']) {
      expect(validatePathSegment(name).ok).toBe(false);
    }
  });

  it('rejects over-length segments', () => {
    expect(validatePathSegment('a'.repeat(MAX_PATH_SEGMENT_LENGTH + 1)).ok).toBe(false);
    expect(validatePathSegment('a'.repeat(MAX_PATH_SEGMENT_LENGTH)).ok).toBe(true);
  });

  it('rejects names outside the plain-name pattern', () => {
    for (const name of ['.hidden', '-flag.txt', 'with space', 'colon:name', 'tab\tname']) {
      expect(validatePathSegment(name).ok).toBe(false);
    }
  });
});

describe('isInsideBase', () => {
  it('accepts a target strictly inside the base', () => {
    const base = path.join('/tmp', 'app');
    expect(isInsideBase(base, path.join(base, 'src', 'slices'))).toBe(true);
  });

  it('refuses the base itself and anything outside it', () => {
    const base = path.join('/tmp', 'app');
    expect(isInsideBase(base, base)).toBe(false);
    expect(isInsideBase(base, path.join(base, '..', 'elsewhere'))).toBe(false);
    expect(isInsideBase(base, '/etc/passwd')).toBe(false);
  });
});

describe('resolveWithinBase', () => {
  it('joins validated segments onto the resolved base', () => {
    const result = resolveWithinBase('/tmp/app', 'orders', 'create.slice.tsx');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(path.join(path.resolve('/tmp/app'), 'orders', 'create.slice.tsx'));
    }
  });

  it('refuses when any segment escapes', () => {
    const result = resolveWithinBase('/tmp/app', 'orders', '../../../outside/pwn');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('INVALID_PATH_SEGMENT');
    }
  });
});
