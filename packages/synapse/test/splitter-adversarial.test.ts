import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import { type SplitResult, verifySplit } from '../src/compiler/slice-splitter';

describe('AST Splitter Adversarial Leak Verification Gates', () => {
  const dummyOutDir = path.resolve(import.meta.dir, 'fixtures');

  function makeMockSplitResult(clientCode: string): SplitResult {
    return {
      sliceName: 'adversarial-test',
      artifacts: [
        {
          kind: 'shared',
          fileName: 'shared.tsx',
          code: 'export type TestOutput = { ok: boolean };'
        },
        {
          kind: 'server',
          fileName: 'server.ts',
          code: 'export async function testAction() { return { ok: true }; }'
        },
        {
          kind: 'client',
          fileName: 'client.tsx',
          code: clientCode
        }
      ]
    };
  }

  it('detects bracket-notation process["env"] leak in client artifact', () => {
    const split = makeMockSplitResult(`
      export function ClientView() {
        const secret = process["env"].SECRET_KEY;
        return <div>{secret}</div>;
      }
    `);

    const verification = verifySplit(split, dummyOutDir);
    expect(verification.status).toBe('FAIL');
    expect(verification.leaks).toContain('process.env access');
  });

  it('detects destructured process.env leak in client artifact', () => {
    const split = makeMockSplitResult(`
      export function ClientView() {
        const { env } = process;
        return <div>{env.DATABASE_URL}</div>;
      }
    `);

    const verification = verifySplit(split, dummyOutDir);
    expect(verification.status).toBe('FAIL');
    expect(verification.leaks).toContain('process destructuring');
  });

  it('detects node server-only module imports in client artifact', () => {
    const split = makeMockSplitResult(`
      import * as fs from 'node:fs';
      export function ClientView() {
        return <div>{fs.existsSync('/tmp') ? 'yes' : 'no'}</div>;
      }
    `);

    const verification = verifySplit(split, dummyOutDir);
    expect(verification.status).toBe('FAIL');
    expect(verification.leaks).toContain('node server module import');
  });

  it('detects dynamic eval() attempts in client artifact', () => {
    const split = makeMockSplitResult(`
      export function ClientView() {
        eval("console.log('leaked')");
        return <div>Eval</div>;
      }
    `);

    const verification = verifySplit(split, dummyOutDir);
    expect(verification.status).toBe('FAIL');
    expect(verification.leaks).toContain('dynamic code evaluation');
  });

  it('detects leaked DDL ALTER TABLE and DROP TABLE statements in client artifact', () => {
    const splitAlter = makeMockSplitResult(`
      export function ClientView() {
        const ddl = "ALTER TABLE users ADD COLUMN age INTEGER;";
        return <div>{ddl}</div>;
      }
    `);

    const verifAlter = verifySplit(splitAlter, dummyOutDir);
    expect(verifAlter.status).toBe('FAIL');
    expect(verifAlter.leaks).toContain('ALTER TABLE statement');

    const splitDrop = makeMockSplitResult(`
      export function ClientView() {
        const ddl = "DROP TABLE users;";
        return <div>{ddl}</div>;
      }
    `);

    const verifDrop = verifySplit(splitDrop, dummyOutDir);
    expect(verifDrop.status).toBe('FAIL');
    expect(verifDrop.leaks).toContain('DROP TABLE statement');
  });
});
