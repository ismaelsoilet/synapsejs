import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
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

  it('enumerates the realtime rejection codes with the status each is returned with', () => {
    expect(contract.realtime.rejections.UNAUTHENTICATED).toBe(401);
    expect(contract.realtime.rejections.TOPIC_NOT_FOUND).toBe(404);
    expect(contract.realtime.rejections.TOPIC_FORBIDDEN).toBe(403);
    expect(contract.realtime.rejections.RATE_LIMIT_EXCEEDED).toBe(429);
    expect(contract.realtime.rejections.REALTIME_LIMIT_EXCEEDED).toBe(429);
    expect(contract.realtime.rejections.ORIGIN_NOT_ALLOWED).toBe(403);
    expect(contract.realtime.rule).toContain('defineTopic');
    expect(contract.realtime.rule).toContain('origin');
  });

  it('states the script-readability of the browser-written session cookie', () => {
    expect(contract.sessions.cookieReality).toContain('document.cookie');
    expect(contract.sessions.cookieReality).toContain('HttpOnly');
    expect(contract.sessions.cookieReality).toContain('ctx.setCookie');
    expect(contract.sessions.cookieReality).toContain('readable by any script');
  });

  it('carries a migration note for each breaking change', () => {
    const changelog = fs.readFileSync(path.resolve(import.meta.dir, '../../../CHANGELOG.md'), 'utf-8');
    const unreleased = changelog.slice(0, changelog.indexOf('## 1.8.0'));

    expect((unreleased.match(/BREAKING/g) ?? []).length).toBeGreaterThanOrEqual(4);

    for (const subject of ['secure by default', 'declared topic', 'WebSocket upgrade', 'CDN is opt-in']) {
      expect(unreleased).toContain(subject);
    }

    // Each note states the previous behaviour, the new behaviour, and how to migrate.
    expect(unreleased).toContain('Previously');
    expect(unreleased).toContain('Migration:');
  });

  it('describes the upload path the way the implementation bounds it', () => {
    const upload = contract.addressing.upload;

    expect(upload).toContain('/_synapse/files/<domain>/<name>');
    expect(upload).toContain('multipart/form-data');
    expect(upload).toContain('byte ceiling');
    expect(upload).toContain('SYNAPSE_UPLOAD_ALLOWED_TYPES');
    expect(upload).toContain('matches the bytes actually received');
    expect(upload).toContain('does not serve the upload directory');
    expect(upload).not.toContain('not parsed');
  });

  it('names the containment failure codes consistently across every public surface', () => {
    const codes = Object.keys(contract.scaffolding.failureCodes);

    expect(codes).toContain('INVALID_PATH_SEGMENT');
    expect(codes).toContain('INVALID_FIELD_NAME');
    expect(contract.scaffolding.containment).toContain('path segment');
    expect(contract.scaffolding.containment).toContain('standard output');

    const agentGuide = fs.readFileSync(path.resolve(import.meta.dir, '../../../AGENTS.md'), 'utf-8');
    const packageReadme = fs.readFileSync(path.resolve(import.meta.dir, '../README.md'), 'utf-8');

    for (const code of ['INVALID_PATH_SEGMENT', 'INVALID_FIELD_NAME']) {
      expect(agentGuide).toContain(code);
      expect(packageReadme).toContain(code);
    }
  });
});
