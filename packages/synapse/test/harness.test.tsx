import { expect, test } from 'bun:test';
import { act } from 'react';

test('the test preload exposes the React test environment', () => {
  expect(process.env.NODE_ENV).toBe('test');
  expect(typeof act).toBe('function');
});

test('the documentation and coverage gates do not re-inject NODE_ENV', async () => {
  const docsCheck = await Bun.file('scripts/docs-check.ts').text();
  const coverageCheck = await Bun.file('scripts/coverage-check.ts').text();

  expect(docsCheck).not.toContain("NODE_ENV: process.env.NODE_ENV ?? 'development'");
  expect(coverageCheck).not.toContain("NODE_ENV: process.env.NODE_ENV ?? 'development'");
});
