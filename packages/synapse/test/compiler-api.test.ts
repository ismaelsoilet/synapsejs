import { describe, expect, it } from 'bun:test';
import { assertCompilerApi, COMPILER_API_UNAVAILABLE } from '../src/compiler/typescript-api';

describe('TypeScript compiler API guard', () => {
  it('accepts the pinned compiler', () => {
    expect(() => assertCompilerApi()).not.toThrow();
  });

  it('fails with a named error when the compiler API is absent', () => {
    expect(() => assertCompilerApi({ version: '7.0.2' })).toThrow(new RegExp(COMPILER_API_UNAVAILABLE));
  });

  it('names the detected version in the error', () => {
    try {
      assertCompilerApi({ version: '7.0.2' });
      throw new Error('expected assertCompilerApi to throw');
    } catch (error) {
      expect((error as Error).message).toContain('7.0.2');
      expect((error as Error & { code: string }).code).toBe(COMPILER_API_UNAVAILABLE);
    }
  });
});
