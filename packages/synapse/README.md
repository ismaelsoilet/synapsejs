# SynapseJS ⚡

> Bun-only fullstack framework where **a feature is a single contiguous file** (`*.slice.tsx`):
> input contract, database DDL, server action, React UI and test oracle together.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-v1.2+-black)](https://bun.sh)

## Requirements

- Bun **>= 1.2** — this package ships TypeScript source (`main: src/index.ts`), uses `bun:sqlite`,
  `Bun.serve`, `Bun.CryptoHasher` and `Bun.spawn`. It does not run on Node.

```bash
bun add synapsejs
```

## Status

Features are listed with the command that fails when they break. Nothing is documented as stable
without one — see the repository's `AGENTS.md` for the full contract.

**Stable:** vertical slices (N = 1) · `Result<T, E>` flows · TypeBox JIT contracts · declarative
`sliceSchema` migrations with DAG topological ordering · bidirectional `-- up:` / `-- down:` rollbacks (`synapse rollback`) · embedded SQLite (WAL, tuned busy_timeout & cache pragmas delivering 4,000+ req/s, CTE-safe) ·
full-duplex WebSockets (`defineSocket` + `useWebSocket`) · hierarchical sub-slice composition & outlets (`<SubSlice>`, `<SliceOutlet>`) · in-memory SSR micro-cache & ISR (`defineCache`) ·
vendor bundle code-splitting via Import Maps (`compiler.vendorChunks`) · standardized shared domain modules (`synapse new-shared`) ·
isomorphic Query Builder with parameterized relational joins and sub-object nesting (`nestJoinedRow`) · centralized Schema Catalog (`.codebase/db-schema.d.ts`) ·
declarative UI primitives & hooks (`DataTable`, `DataForm`, `useAction`, `useLoaderData`, `useSubscription`, `SynapseProvider`) ·
realtime SSE gateway (`EventHub` + `ctx.broadcast`) · schema drift detector (`synapse db-drift`) · AST diff & cross-slice impact analysis (`synapse impact`) ·
unified Object Storage (Local + S3/R2/MinIO with SigV4 presigned URLs) · distributed PostgreSQL queue (`FOR UPDATE SKIP LOCKED`) ·
native Tagged SQL (`db.sql` / `db.sqlOne`) · background jobs engine (`defineJob` + `synapse worker`) · webhooks gateway
with rawBody preservation · B2B multi-tenancy & IDOR prevention (`requireTenant`) · hierarchical UI layouts (`_layout.tsx`)
and Turbo Morphing router · explicit RBAC via `requireAuth(session, roles)` · zero-wiring routing + SSR + RPC · slice discovery
that never reports PASS with zero slices · isomorphic splitter with compile and leak gates · typed AST skeleton map ·
scaffolder with `--fields` grammar and templates (create, list, update, delete, login, oauth-github, crud) · standalone production bundler (`synapse build --standalone`) ·
MCP stdio server with 18 native tools (11 Synapse + 7 Jev) · slice invariants under `bun:test` with per-invariant reporting · PostgreSQL parity · real concurrency & load stress benchmarks ·
SSRF & Network Guard (`validateExternalUrl`, `isPrivateOrReservedIp`) · anti-spoofing & bounded LRU rate limiting · bounded LRU SSR micro-cache with parameter normalization · strict payload size guards (RPC 5MB, Webhook 10MB) & malformed JSON protection · SQLite queue zombie job recovery with `locked_at` visibility timeout · HTTP 500 SSR error isolation & bundle suppression · secure HttpOnly cookies (`ctx.setCookie`) · graceful HTTP shutdown (`server.stop` with connection drain) ·
Prototype Pollution Shield (`setNestedProperty`, `expandNestedObject`) · Parameterized Query Operator Allowlist (`VALID_WHERE_OPERATORS`) · Reentrant SQLite Savepoints (`txDepth` + `SAVEPOINT`) · Atomic Queue Poison-Pill Neutralization (claim increment & DLQ timeout) · Strict Multi-Tenant Context Derivation (spoofing-proof token claims) · Streaming Upload & Chunked DoS Armor (`readBodyWithinLimit`) · Origin-Validated WebSocket Upgrades (`SYNAPSE_ALLOWED_ORIGINS`) · Safe SSR Serialization (`<script type="application/json">`) & Cookie CRLF Guard.

**Roadmap:** multi-node distributed cache adapters (Redis/Dragonfly cluster sync), multi-host worker clustering.

The repository README carries a measured context-surface benchmark of the same two features
implemented with and without the slice convention, including what the numbers do not show.

## API stability

`fc` and `MockDatabaseClient` are deliberate parts of the contract, not accidents: slices declare their
invariants with `fc`, and the oracles use the mock. Both are asserted by
`packages/synapse/test/machine-types.test.ts` ("public contract"), together with every other export this
README lists. The same block is the list of what 1.0 will freeze. In 0.x a minor bump may still break;
every break is in [CHANGELOG.md](../CHANGELOG.md).

## Quick start

```bash
bunx synapsejs new my-app
cd my-app && bun install
bun run dev
bun run new-slice users register-user
```

## A slice

```tsx
import { Type, Static, Value, Ok, Err, type Result, type DatabaseClient, createSession, requireAuth, type SessionContext } from 'synapsejs';

export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 })
});
export type TicketInput = Static<typeof TicketInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL
  );
`;

export type TicketOutput = Result<
  { ticketId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// `db` is optional so the same call site is valid on the server (connection injected)
// and on the client (where the call becomes an RPC stub).
export async function createTicketAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<TicketOutput> {
  const auth = requireAuth(session, ['support']);
  if (!auth.ok) return Err(auth.error);
  if (!db) return Err('NO_DATABASE');
  if (!Value.Check(TicketInputSchema, payload)) return Err('INVALID_SCHEMA');

  const input = payload as TicketInput;
  await db.query(`INSERT INTO tickets (id, subject, priority) VALUES ($1, $2, $3)`, [
    crypto.randomUUID(), input.subject, input.priority
  ]);
  return Ok({ ticketId: 'ticket-1' });
}

export function CreateTicketTrigger() {
  return <form>{/* UI lives in the same file */}</form>;
}

// Invariants run under Bun's real test runner via `synapse test`; the framework
// generates the wrapper, so slices never import a test library.
export const sliceTests = {
  description: 'Ticket invariants',
  cases: [
    {
      name: 'an anonymous caller is rejected before touching the database',
      run: async () => {
        const result = await createTicketAction({ subject: 'printer', priority: 2, requesterEmail: 'a@b.com' });
        if (result.ok || result.error !== 'UNAUTHORIZED') throw new Error('expected UNAUTHORIZED');
      }
    }
  ]
};
```

## MCP server

```bash
bun run mcp     # JSON-RPC 2.0 over stdio
```

Tools: `synapse_get_repo_map`, `synapse_get_db_schema`, `synapse_check`, `synapse_split`,
`synapse_run_pbt`, `synapse_scaffold_slice`, `synapse_migrate`, `synapse_rollback`, `synapse_contract`,
`synapse_check_db_drift`, `synapse_diff_impact`, `synapse_test_gate`, `synapse_abort_check`,
`synapse_verify_step`, `synapse_reasoning_effort`, `synapse_triage_error`, `synapse_route_task`, `synapse_evaluate_nudge`.
Slice-dependent tools fail with `NO_SLICES_DIR` (listing the paths they examined) instead of reporting an empty success.

Client configuration for an agent host:

```json
{
  "mcpServers": {
    "synapsejs": { "command": "bunx", "args": ["synapse", "mcp"], "cwd": "/path/to/your-app" }
  }
}
```

## Client / server isolation

`synapse split` partitions each slice into `shared.tsx`, `server.ts` and `client.tsx` by
**reachability resolved through the type checker**, then enforces two gates: the emitted modules must
typecheck under your tsconfig, and the client module must not contain SQL, `db.query`, `sliceSchema`,
`process.env` or `Bun.`. A server action referenced by a component contributes only its wire
signature (payload + return type) to the client — never its body.

## Package API

For comprehensive documentation, see [README.md](../../README.md) (English) or [README.pt-BR.md](../../README.pt-BR.md) (Português do Brasil).

```typescript
import {
  // Functional error handling
  Result, Ok, Err, isOk, isErr, map, mapErr, unwrapOr, Option, Some, None,

  // Runtime, Database & Action Context
  SynapseServer, getDatabase, resetDatabaseInstance,
  SqliteDatabaseClient, PostgresDatabaseClient, MockDatabaseClient,
  type DatabaseClient, compileTaggedSql,
  type ActionContext, createActionContext,
  defineConfig, loadSynapseConfig,

  // Object Storage & Optimization
  type StorageClient, getStorage, LocalStorageAdapter, S3StorageAdapter,
  optimizeImage,

  // Background Jobs & Queue Engines
  defineJob, QueueEngine, PostgresQueueEngine, type JobRecord, type JobDefinition,

  // RPC boundary & Session
  rpcCall, rpcTransportFailure, type RpcTransportError,
  AnonymousSession, createSession, requireAuth, requireTenant,
  hasRole, hasAnyRole, type SessionContext,
  storeSession, clearSession, currentRoles, sessionCookie,
  revokeSessionToken, isSessionTokenRevoked,

  // JIT validation & PBT
  Type, type Static, type TSchema, Value, fc,

  // Declarative UI Primitives, Hooks & i18n
  DataTable, DataForm, Button, Card, Badge, Pagination,
  SliceOutlet, SliceOutletProvider, SubSlice,
  SynapseProvider, useAction, useLoaderData, useSubscription, useWebSocket, useSession, useSynapseContext,
  createTranslator,

  // Realtime & Cache Gateways
  EventHub, getEventHub, resetEventHub,
  defineSocket, defineCache,

  // Compiler, Scaffolding, Schemas, Drift & Diagnostics
  runSliceMigrations, rollbackSliceMigrations, runMachineVerifications,
  orderSlicesByDag, parseTableDependencies, generateDatabaseSchemaCatalog,
  checkSchemaDrift, analyzeImpact, nestJoinedRow,
  resolveSlicesDir, findSliceFiles, SLICE_EXTENSION,
  splitSlice, verifySplit, writeSplitArtifacts, artifactDirectory,
  scaffoldSlice, scaffoldCrud, scaffoldShared, parseFields, compressRepositoryAST, buildStandalone,

  // MCP
  SynapseMcpServer
} from 'synapsejs';
```

## License

MIT © [Ismael Soilet](https://github.com/ismaelsoilet)
