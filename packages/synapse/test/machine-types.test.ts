import { describe, expect, it } from 'bun:test';
import { Err, None, Ok, Some, isErr, isOk, map, mapErr, unwrapOr } from '../src/core/machine-types';
import * as publicEntry from '../src/index';
import type {
  DatabaseClient,
  DiagnosticReport,
  MigrationReport,
  OracleReport,
  ScaffoldError,
  SessionContext,
  SlicesDirError,
  SplitResult
} from '../src/index';

// Type-only exports are part of the documented contract too. `bun test` transpiles
// without typechecking, so this tuple is what makes a removed type break a gate:
// `bun run check` typechecks this file.
type TypeOnlyContract = [
  DatabaseClient,
  SessionContext,
  SplitResult,
  MigrationReport,
  OracleReport,
  DiagnosticReport,
  ScaffoldError,
  SlicesDirError
];
const typeOnlyContract: TypeOnlyContract | null = null;
void typeOnlyContract;

describe('Result<T, E>', () => {
  it('builds Ok and Err values', () => {
    expect(Ok(1)).toEqual({ ok: true, value: 1 });
    expect(Err('nope')).toEqual({ ok: false, error: 'nope' });
  });

  it('narrows with isOk / isErr', () => {
    const ok = Ok(42);
    const err = Err('E');

    expect(isOk(ok)).toBe(true);
    expect(isErr(ok)).toBe(false);
    expect(isErr(err)).toBe(true);
    expect(isOk(err)).toBe(false);
  });

  it('maps the success branch and leaves Err untouched', () => {
    expect(map(Ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(map(Err('E'), (n: number) => n * 3)).toEqual({ ok: false, error: 'E' });
  });

  it('maps the error branch and leaves Ok untouched', () => {
    expect(mapErr(Err('E'), (e) => `${e}!`)).toEqual({ ok: false, error: 'E!' });
    expect(mapErr(Ok(2), (e: string) => `${e}!`)).toEqual({ ok: true, value: 2 });
  });

  it('falls back with unwrapOr instead of throwing', () => {
    expect(unwrapOr(Ok(7), 0)).toBe(7);
    expect(unwrapOr(Err('E'), 0)).toBe(0);
  });
});

describe('Option<T>', () => {
  it('represents presence and absence', () => {
    expect(Some('x')).toEqual({ hasValue: true, value: 'x' });
    expect(None()).toEqual({ hasValue: false });
  });
});

describe('public surface', () => {
  it('does not export a throwing unwrap helper', () => {
    expect('unwrap' in publicEntry).toBe(false);
  });

  it('exports the documented functional helpers', () => {
    for (const name of ['Ok', 'Err', 'isOk', 'isErr', 'map', 'mapErr', 'unwrapOr', 'Some', 'None']) {
      expect(name in publicEntry).toBe(true);
    }
  });
});


describe('public contract (decision recorded in packages/synapse/README.md)', () => {
  it('keeps every export the documented contract promises', () => {
    const contract = [
      'Ok', 'Err', 'isOk', 'isErr', 'map', 'mapErr', 'unwrapOr', 'Some', 'None',
      'Type', 'Value', 'fc',
      'MockDatabaseClient', 'SqliteDatabaseClient', 'PostgresDatabaseClient',
      'getDatabase', 'resetDatabaseInstance',
      'AnonymousSession', 'createSession', 'requireAuth', 'hasRole', 'hasAnyRole',
      'rpcCall', 'rpcTransportFailure',
      'resolveSlicesDir', 'findSliceFiles', 'runSliceMigrations', 'runSliceOracles',
      'splitSlice', 'verifySplit', 'scaffoldSlice', 'compressRepositoryAST',
      'runMachineVerifications', 'SynapseServer', 'SynapseMcpServer'
    ];

    const missing = contract.filter((name) => !(name in publicEntry));
    expect(missing).toEqual([]);
  });

  it('does not ship a throwing unwrap helper', () => {
    expect('unwrap' in publicEntry).toBe(false);
  });
});
