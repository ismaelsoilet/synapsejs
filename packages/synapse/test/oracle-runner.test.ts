import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { oracleWrapperSource, parseOracleJunit, runSliceOracles } from '../src/compiler/oracle-runner';

const fixtureApp = path.resolve(import.meta.dir, 'fixtures', 'oracle-app');

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-oracles-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const NESTED_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="0" failures="1" skipped="0" time="0.01">
  <testsuite name=".synapse/oracles/good.oracle.test.ts" file=".synapse/oracles/good.oracle.test.ts" tests="2" failures="1">
    <testsuite name="good" file=".synapse/oracles/good.oracle.test.ts" line="9" tests="2" failures="1">
      <testcase name="aceita objeto" classname="good" file=".synapse/oracles/good.oracle.test.ts" line="19" />
      <testcase name="rejeita nulo" classname="good" file=".synapse/oracles/good.oracle.test.ts" line="20">
        <failure type="Error" message="esperava Err&#10;&#10;at good.slice.tsx:30:11" />
      </testcase>
    </testsuite>
  </testsuite>
</testsuites>`;

describe('parseOracleJunit', () => {
  it('aggregates Bun nested suites by file and keeps case names', () => {
    const suites = parseOracleJunit(NESTED_JUNIT);

    expect(suites.length).toBe(1);
    expect(suites[0].name).toBe('.synapse/oracles/good.oracle.test.ts');
    expect(suites[0].cases.map((item) => item.name)).toEqual(['aceita objeto', 'rejeita nulo']);
  });

  it('marks a failing case and decodes its message', () => {
    const [suite] = parseOracleJunit(NESTED_JUNIT);

    expect(suite.cases[0].passed).toBe(true);
    expect(suite.cases[1].passed).toBe(false);
    expect(suite.cases[1].message).toContain('esperava Err');
    expect(suite.cases[1].message).toContain('at good.slice.tsx');
  });

  it('returns nothing for output without suites', () => {
    expect(parseOracleJunit('<?xml version="1.0"?><testsuites />')).toEqual([]);
  });
});

describe('oracleWrapperSource', () => {
  const source = oracleWrapperSource('./../../src/slices/x.slice', 'x-slice');

  it('imports bun:test only inside the generated wrapper', () => {
    expect(source).toContain(`from 'bun:test'`);
    expect(source).toContain('import * as sliceModule from "./../../src/slices/x.slice"');
  });

  it('registers one test per named case and still supports the legacy run()', () => {
    expect(source).toContain('for (const oracleCase of oracle.cases)');
    expect(source).toContain(`it(oracleCase.name`);
    expect(source).toContain('typeof oracle.run ===');
  });

  it('fails when the slice declares no oracle at all', () => {
    expect(source).toContain(`it('declares sliceTests'`);
  });
});

describe('runSliceOracles', () => {
  it('fails with NO_SLICES_DIR instead of reporting an empty pass', async () => {
    const report = await runSliceOracles(sandbox);

    expect(report.status).toBe('FAIL');
    expect(report.code).toBe('NO_SLICES_DIR');
    expect(report.totalCases).toBe(0);
  });

  it('runs the fixture app and reports one entry per invariant', async () => {
    const report = await runSliceOracles(fixtureApp);

    expect(report.status).toBe('PASS');
    expect(report.totalSlices).toBe(1);
    expect(report.totalCases).toBe(2);
    expect(report.passedCases).toBe(2);
    expect(report.results[0].cases.map((item) => item.name)).toEqual(['aceita objeto', 'rejeita nulo']);
  });

  it('reports FAIL, the failing case name and its message when an invariant breaks', async () => {
    const report = await runSliceOracles(fixtureApp, {
      spawn: async (args) => {
        const outfile = args.find((arg) => arg.startsWith('--reporter-outfile='));
        if (!outfile) {
          throw new Error('runner sem --reporter-outfile');
        }
        fs.writeFileSync(outfile.replace('--reporter-outfile=', ''), NESTED_JUNIT, 'utf-8');
        return { exitCode: 1, output: 'simulated failure' };
      }
    });

    expect(report.status).toBe('FAIL');
    expect(report.passedCases).toBe(1);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].cases[1].passed).toBe(false);
    expect(report.results[0].cases[1].message).toContain('esperava Err');
  });

  it('fails with RUNNER_FAILED when the runner produces no report', async () => {
    const report = await runSliceOracles(fixtureApp, {
      spawn: async () => ({ exitCode: 1, output: 'bun explodiu' })
    });

    expect(report.status).toBe('FAIL');
    expect(report.code).toBe('RUNNER_FAILED');
    expect(report.message).toContain('bun explodiu');
  });
});
