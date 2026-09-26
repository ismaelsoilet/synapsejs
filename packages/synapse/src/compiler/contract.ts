/**
 * SynapseJS - Machine Contract
 *
 * The framework describes itself, in one call, in the shape an agent consumes.
 * Everything an agent must know to author a slice without guessing lives here:
 * export names and suffixes the runtime detects, file locations, the Result and
 * HTTP semantics, session rules, addressing, and the gates it can run.
 *
 * This is not documentation for humans — it is the contract the runtime actually
 * enforces. Tests assert that the suffix lists below are the very constants the
 * discovery and the splitter use, so the description cannot drift from behavior.
 */

import {
  ACTION_SUFFIX,
  COMPONENT_SUFFIXES,
  LOADER_SUFFIX,
  SLICE_DDL_EXPORT,
  SLICE_ORACLE_EXPORT
} from '../runtime/discovery-rules';
import { SLICE_EXTENSION } from './slice-discovery';

export interface SliceContractExport {
  name: string;
  required: boolean;
  kind: 'schema' | 'ddl' | 'action' | 'ui' | 'loader' | 'oracle';
  signature: string;
  notes: string;
}

export interface MachineContract {
  framework: string;
  slice: {
    location: string;
    extension: string;
    namingRule: string;
    oneFeaturePerFile: string;
    exports: SliceContractExport[];
    example: string;
  };
  results: {
    shape: string;
    errorsAreValues: string;
    httpStatus: Record<string, string>;
  };
  sessions: {
    headers: string[];
    signed: string;
    anonymous: string;
  };
  addressing: {
    page: string;
    rpc: string;
    ambiguity: string;
  };
  serverRendering: {
    props: string;
    hydration: string;
    isolation: string;
  };
  gates: Array<{ command: string; proves: string }>;
}

export function machineContract(): MachineContract {
  return {
    framework: 'synapsejs',
    slice: {
      location: 'src/slices/<domain>/<name>.slice.tsx',
      extension: SLICE_EXTENSION,
      namingRule: '<name> is kebab-case; it becomes <Name> in PascalCase for types and components',
      oneFeaturePerFile:
        'A feature is one file. Do not split a slice across modules, and do not import one slice from another.',
      exports: [
        {
          name: '<Name>InputSchema',
          required: true,
          kind: 'schema',
          signature: 'Type.Object({...}) validated with Value.Check',
          notes: 'Any export ending in "Schema" is treated as the input contract.'
        },
        {
          name: SLICE_DDL_EXPORT,
          required: false,
          kind: 'ddl',
          signature: 'string (template literal with SQL statements)',
          notes:
            'Each statement runs once and is recorded individually: an ALTER TABLE applies exactly once. Omit it when the table belongs to another slice. Use portable SQL (TIMESTAMP, not DATETIME).'
        },
        {
          name: `<name>${ACTION_SUFFIX}`,
          required: true,
          kind: 'action',
          signature: `(payload: unknown, db?: DatabaseClient, session?: SessionContext) => Promise<Result<T, E>>`,
          notes:
            'db is optional so the same call site is valid on both sides: the server passes the connection, the browser gets an RPC stub. Authorize with requireAuth(session, ["role"]) and return Err(auth.error).'
        },
        {
          name: `<Name>${COMPONENT_SUFFIXES[0]}`,
          required: false,
          kind: 'ui',
          signature: 'React component receiving the query string plus whatever the loader returned',
          notes: `Detected suffixes: ${COMPONENT_SUFFIXES.join(', ')}. The runtime passes onSubmitAction: the real action on the server, the RPC call in the browser.`
        },
        {
          name: `<Name>${LOADER_SUFFIX}`,
          required: false,
          kind: 'loader',
          signature: '(context: { url, params, db, session }) => Promise<Record<string, unknown>>',
          notes:
            'Runs on the server on every render. Its result is merged with the query string and passed to the component, then serialized for hydration. A loader that throws is rendered in the page.'
        },
        {
          name: SLICE_ORACLE_EXPORT,
          required: true,
          kind: 'oracle',
          signature: '{ description?: string, cases: Array<{ name: string, run: () => unknown | Promise<unknown> }> }',
          notes:
            'Assert domain behavior, not the validation library. Executed by `synapse test` under bun:test; dropped from both runtime bundles by the splitter.'
        }
      ],
      example: [
        "import { Type, Static } from '@sinclair/typebox';",
        "import { Value } from '@sinclair/typebox/value';",
        "import { Ok, Err, type DatabaseClient, type Result, type SessionContext, createSession, requireAuth, MockDatabaseClient } from 'synapsejs';",
        '',
        'export const ThingInputSchema = Type.Object({ name: Type.String({ minLength: 2 }) });',
        'export type ThingInput = Static<typeof ThingInputSchema>;',
        '',
        'export const sliceSchema = `',
        '  CREATE TABLE IF NOT EXISTS things (id TEXT PRIMARY KEY, name TEXT NOT NULL);',
        '`;',
        '',
        "export type ThingOutput = Result<{ id: string }, 'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED'>;",
        '',
        'export async function createThingAction(payload: unknown, db?: DatabaseClient, session?: SessionContext): Promise<ThingOutput> {',
        "  const auth = requireAuth(session, ['writer']);",
        '  if (!auth.ok) return Err(auth.error);',
        "  if (!db) return Err('NO_DATABASE');",
        "  if (!Value.Check(ThingInputSchema, payload)) return Err('INVALID_SCHEMA');",
        '  const input = payload as ThingInput;',
        '  const id = crypto.randomUUID();',
        '  await db.query(`INSERT INTO things (id, name) VALUES ($1, $2)`, [id, input.name]);',
        '  return Ok({ id });',
        '}',
        '',
        'export function ThingTrigger({ onSubmitAction }: { onSubmitAction?: (payload: unknown) => Promise<ThingOutput> }) {',
        '  return <form onSubmit={async (e) => { e.preventDefault(); await onSubmitAction?.({ name: "x" }); }}><button>criar</button></form>;',
        '}',
        '',
        'export const sliceTests = {',
        '  cases: [',
        "    { name: 'sem sessão retorna UNAUTHORIZED', run: async () => {",
        '      const result = await createThingAction({ name: "x" }, new MockDatabaseClient());',
        "      if (result.ok || result.error !== 'UNAUTHORIZED') throw new Error('esperava UNAUTHORIZED');",
        '    } }',
        '  ]',
        '};'
      ].join('\n')
    },
    results: {
      shape: 'type Result<T, E> = { ok: true, value: T } | { ok: false, error: E }',
      errorsAreValues:
        'Actions never throw for domain failures: they return Err(code). The code is the contract; declare every code in the output type.',
      httpStatus: {
        UNAUTHORIZED: '401',
        FORBIDDEN: '403',
        '*_NOT_FOUND': '404',
        'DUPLICATE_*, ALREADY_*': '409',
        'INVALID_*, MALFORMED*': '422',
        'NO_DATABASE, PERSISTENCE_FAILED, *_FAILED': '500',
        'anything else': '400'
      }
    },
    sessions: {
      headers: ['Authorization: Bearer <token>', 'x-user-id', 'x-user-roles'],
      signed:
        'With SYNAPSE_SESSION_SECRET set, a bearer token must be a signed session (signSessionToken) and its claims win: role headers are ignored.',
      anonymous: 'A request with none of them is anonymous: requireAuth returns Err("UNAUTHORIZED").'
    },
    addressing: {
      page: 'GET /<domain>/<name>',
      rpc: 'POST /_synapse/rpc/<domain>/<name> with Content-Type: application/json',
      ambiguity:
        'A bare name resolves only while it is unique across domains; otherwise the dispatcher answers 409 listing the candidates.'
    },
    serverRendering: {
      props: 'params (query string) merged with the loader result',
      hydration:
        'The server builds a browser bundle per slice from the splitter output, hydrates the component and wires onSubmitAction to the RPC endpoint. The same props are serialized into the page.',
      isolation:
        'A client bundle never contains SQL, db access, process.env or Bun globals; the splitter gates fail the build if it does.'
    },
    gates: [
      {
        command: 'synapse check [arquivo]',
        proves: 'types; fails with coordinates, never reports PASS when nothing matched'
      },
      { command: 'synapse test', proves: 'every named invariant, under bun:test, with per-case results' },
      { command: 'synapse migrate', proves: 'each DDL statement applied once, idempotently' },
      { command: 'synapse skeleton', proves: 'the repo map is regenerated deterministically' },
      { command: 'synapse split', proves: 'the emitted modules compile and the client leaks no server code' }
    ]
  };
}

export function renderContractJson(): string {
  return JSON.stringify(machineContract(), null, 2);
}

export function renderContractMarkdown(): string {
  const contract = machineContract();
  const lines: string[] = ['# SynapseJS machine contract', ''];

  lines.push(`Slice: \`${contract.slice.location}\` — ${contract.slice.oneFeaturePerFile}`, '');
  lines.push('| export | required | signature | notes |', '|---|---|---|---|');
  for (const entry of contract.slice.exports) {
    lines.push(`| \`${entry.name}\` | ${entry.required ? 'yes' : 'no'} | \`${entry.signature}\` | ${entry.notes} |`);
  }

  lines.push('', '## Gates', '', '| command | proves |', '|---|---|');
  for (const gate of contract.gates) {
    lines.push(`| \`${gate.command}\` | ${gate.proves} |`);
  }

  return lines.join('\n');
}
