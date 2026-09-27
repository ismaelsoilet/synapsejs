import { describe, expect, it } from 'bun:test';
import { machineContract, renderContractMarkdown } from '../src/compiler/contract';
import {
  ACTION_SUFFIX,
  COMPONENT_SUFFIXES,
  isAction,
  isComponent,
  isLoader,
  isSchema,
  isTestOnly,
  LOADER_SUFFIX,
  SLICE_DDL_EXPORT,
  SLICE_ORACLE_EXPORT
} from '../src/runtime/discovery-rules';

describe('discovery rules', () => {
  it('classifies exports by the suffixes the contract documents', () => {
    expect(isAction('createThingAction')).toBe(true);
    expect(isAction('createThing')).toBe(false);
    expect(isLoader('ThingLoader')).toBe(true);
    expect(isSchema('ThingInputSchema')).toBe(true);
    expect(isTestOnly(SLICE_ORACLE_EXPORT)).toBe(true);

    for (const suffix of COMPONENT_SUFFIXES) {
      expect(isComponent(`Thing${suffix}`)).toBe(true);
    }
    expect(isComponent('ThingCard')).toBe(false);
  });
});

describe('machine contract', () => {
  const contract = machineContract();

  it('lists exactly the runtime pieces an agent must author', () => {
    const names = contract.slice.exports.map((entry) => entry.name).join(' ');

    expect(names).toContain(ACTION_SUFFIX);
    expect(names).toContain(LOADER_SUFFIX);
    expect(names).toContain(SLICE_DDL_EXPORT);
    expect(names).toContain(SLICE_ORACLE_EXPORT);
    for (const suffix of COMPONENT_SUFFIXES) {
      expect(contract.slice.exports.some((entry) => entry.notes.includes(suffix) || entry.name.includes(suffix))).toBe(
        true
      );
    }
  });

  it('marks what is required', () => {
    const required = contract.slice.exports
      .filter((entry) => entry.required)
      .map((entry) => entry.kind)
      .sort();

    expect(required).toEqual(['action', 'oracle', 'schema']);
  });

  it('ships an example that uses the documented pieces', () => {
    for (const piece of [
      'InputSchema',
      SLICE_DDL_EXPORT,
      ACTION_SUFFIX,
      COMPONENT_SUFFIXES[0],
      SLICE_ORACLE_EXPORT,
      'requireAuth'
    ]) {
      expect(contract.slice.example).toContain(piece);
    }
  });

  it('states the HTTP mapping and the addressing rules', () => {
    expect(contract.results.httpStatus.UNAUTHORIZED).toBe('401');
    expect(contract.results.httpStatus.FORBIDDEN).toBe('403');
    expect(contract.addressing.rpc).toContain('/_synapse/rpc/<domain>/<name>');
    expect(contract.addressing.upload).toContain('/_synapse/files/<domain>/<name>');
    expect(contract.gates.map((gate) => gate.command).join(' ')).toContain('synapse build');
    expect(contract.sessions.headers.length).toBe(3);
    expect(contract.sessions.login).toContain('storeSession');
    expect(contract.sessions.login).toContain('clearSession');
  });

  it('lists the templates the scaffolder can emit', () => {
    expect(contract.templates.available).toEqual([
      'create',
      'list',
      'update',
      'delete',
      'login',
      'oauth-github',
      'auth-2fa',
      'crud'
    ]);
    expect(contract.shared.location).toBe('src/shared/<name>.ts');
    expect(contract.shared.atomicity).toContain('mock');
    expect(contract.templates.notes).toContain('allowlist');
  });

  it('renders a markdown view with the same tables', () => {
    const markdown = renderContractMarkdown();

    expect(markdown).toContain('# SynapseJS machine contract');
    expect(markdown).toContain(SLICE_ORACLE_EXPORT);
    expect(markdown).toContain('synapse split');
  });
});
