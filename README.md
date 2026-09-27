# SynapseJS ⚡

> **English** | [Português do Brasil](README.pt-BR.md)

A Bun-first fullstack framework designed around a single architectural invariant: **a feature is a single contiguous file** (`*.slice.tsx`). Input contract, database DDL, server action, React UI, and test oracle live together in one place, supported by machine-verifiable tooling: structured diagnostics, AST-driven migrations, a compressed repo map, an MCP server, and a gated client/server splitter.

~3k LOC of framework core, one reference application, one starter template. It is **not** a platform, and it is **not** an "Agentic OS" — that claim (along with the mathematical formula that accompanied it) was removed in 0.4.0, along with any promised features that were not fully functional or verifiable.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-v1.2+-black)](https://bun.sh)
[![Tests](https://img.shields.io/badge/Tests-359%20passing-brightgreen)](packages/synapse/test)
[![MCP](https://img.shields.io/badge/MCP-11%20Tools-purple)](src/mcp)

---

## Table of Contents

1. [Core Philosophy: Locality of Behavior (N = 1)](#1-core-philosophy-locality-of-behavior-n--1)
2. [What SynapseJS Is and What It Is NOT](#2-what-synapsejs-is-and-what-it-is-not)
3. [Status & Feature Verification Matrix](#3-status--feature-verification-matrix)
4. [Repository Topology](#4-repository-topology)
5. [Quick Start & Prerequisites](#5-quick-start--prerequisites)
6. [Anatomy of a Slice (*.slice.tsx)](#6-anatomy-of-a-slice-slicetsx)
7. [The Isomorphic Splitter & Leak-Proof Gates](#7-the-isomorphic-splitter--leak-proof-gates)
8. [Persistence & Isomorphic Query Builder](#8-persistence--isomorphic-query-builder)
9. [Declarative Migrations, Schema DAG, Drift & Impact](#9-declarative-migrations-schema-dag-drift--impact)
10. [Background Jobs & Distributed Queue Engine](#10-background-jobs--distributed-queue-engine)
11. [Unified Object Storage & Webhooks Gateway](#11-unified-object-storage--webhooks-gateway)
12. [Security, RBAC, Multi-Tenancy & Social Auth](#12-security-rbac-multi-tenancy--social-auth)
13. [Declarative UI Primitives, Layouts & Turbo Morphing](#13-declarative-ui-primitives-layouts--turbo-morphing)
14. [Native Model Context Protocol (MCP) Server](#14-native-model-context-protocol-mcp-server)
15. [CLI Reference](#15-cli-reference)
16. [Production Deployment & Observability](#16-production-deployment--observability)
17. [Empirical Benchmarks & Measured Evidence](#17-empirical-benchmarks--measured-evidence)
18. [Known Limitations & Engineering Boundaries](#18-known-limitations--engineering-boundaries)
19. [Public Package API Contract](#19-public-package-api-contract)
20. [License & Credits](#20-license--credits)

---

## 1. Core Philosophy: Locality of Behavior (N = 1)

In traditional fullstack architectures, implementing or modifying a single user-facing feature requires coordinating across 5 to 7 decoupled layers:
- HTTP route definition (`routes/customers.ts`)
- Controller / Request Handler (`controllers/customerController.ts`)
- Validation Schema / DTO (`dto/customer.dto.ts`)
- Business Domain Service (`services/customerService.ts`)
- Database Model / Entity / Migration (`entities/Customer.ts`, `migrations/001_create_customers.sql`)
- Client API Client / Fetch Stub (`client/api/customers.ts`)
- React Component / View (`components/CustomerForm.tsx`)
- Unit & E2E Tests (`tests/customer.test.ts`)

This scattered topology creates high cognitive load for human developers and severely penalizes LLM coding agents. An autonomous agent must search across multiple directories, infer undocumented implicit couplings, juggle multiple open files within its context window, and hope that changes in one file do not silently break contracts in another.

**SynapseJS enforces Locality of Behavior (LoB):**
$$\text{Feature Cost} = \mathcal{O}(1) \text{ contiguous file}$$

Every vertical slice (`src/slices/<domain>/<name>.slice.tsx`) encapsulates:
1. **Input Contract**: TypeBox schema validated JIT.
2. **Database DDL**: SQL statement defining or evolving the required table.
3. **Domain Error Types**: Strict union types via `Result<T, E>`.
4. **Server Action**: Backend business logic and transactional mutation.
5. **React UI Component**: Declarative form/view rendered on both server and client.
6. **SSR Loader**: Server-side data query executed before HTML rendering.
7. **Test Oracle**: Property-based and deterministic invariants executed by `bun:test`.
8. **Webhook Handler**: Optional webhook endpoint with raw byte preservation.
9. **Background Jobs**: Optional asynchronous worker tasks.

### The Golden Invariant: Slices Never Import Slices
```
┌──────────────────────────────────────────────┐
│       src/slices/billing/invoice.slice.tsx   │
│  [Schema] [DDL] [Action] [UI] [Test Oracle]  │
└──────────────────────┬───────────────────────┘
                       │ ❌ CANNOT IMPORT
                       ▼
┌──────────────────────────────────────────────┐
│      src/slices/customers/customer.slice.tsx │
│  [Schema] [DDL] [Action] [UI] [Test Oracle]  │
└──────────────────────┬───────────────────────┘
                       │
       Both import from│ shared logic
                       ▼
┌──────────────────────────────────────────────┐
│          src/shared/transactions.ts          │
│   (Receives DatabaseClient, opens db.tx)     │
└──────────────────────────────────────────────┘
```
A vertical slice **never imports another slice**. If two features must coordinate or share transactional state, that logic belongs in `src/shared/<module>.ts`. Violations are caught at build time by the compiler's AST analyzer with error code `SLICE_IMPORTS_SLICE`.

---

## 2. What SynapseJS Is and What It Is NOT

### What It IS:
- **A Bun-native fullstack framework**: Tailored specifically for Bun `>= 1.2`, leveraging `bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.password`, and `Bun.build`.
- **A machine-centric architecture**: Every CLI command emits structured JSON to `stdout` with exit codes (`0` for PASS, `1` for FAIL). Errors include precise coordinates (`file`, `line`, `col`, `code`).
- **An anti-hype codebase**: Every claim is backed by an automated test in `packages/synapse/test/` that fails if the claim breaks.
- **A Locality-of-Behavior enforcer**: Compiles, verifies, splits, tests, and migrates applications feature-by-feature.

### What It Is NOT:
- **Not an "Agentic OS"**: There are no autonomous magic loops, unbounded agent swarms, or self-modifying runtime hallucinations in this core. It is predictable infrastructure that makes AI agents effective and auditable.
- **Not Node.js or Deno compatible**: SynapseJS relies strictly on Bun primitives for performance and packaging.
- **Not a global asset bundler**: Synapse pre-builds isolated client bundles per slice (`synapse build`), leaving routing to the SSR engine.
- **Not an ORM platform**: The framework provides an isomorphic query builder (`findMany`, `findOne`, `insert`, `update`, `delete`, relational joins) and tagged SQL (`db.sql`), not a heavy multi-tier relational mapper. Complex OLAP queries belong in tagged SQL or external tools like Kysely plugged into `ctx.services`.

---

## 3. Status & Feature Verification Matrix

Every single feature below is accompanied by the exact command that fails if it breaks. No feature enters **stable** status without automated test evidence.

### Stable (Verified in CI & Monorepo)

| Feature | Description | Verification Command |
|---|---|---|
| **Vertical Slices (N = 1)** | One feature per file, Locality of Behavior | `bun test packages/synapse/test/locality.test.ts` |
| **`Result<T, E>` Control Flow** | Strict functional error handling, no throwing public helpers | `bun test packages/synapse/test/machine-types.test.ts` |
| **TypeBox JIT Contracts** | Validation via `@sinclair/typebox` and `Value.Check` | `bun test packages/synapse/test/slice-contract.test.ts` |
| **Declarative Migrations** | AST-discovered DDL, statement-by-statement idempotency | `bun test packages/synapse/test/migration-runner.test.ts` |
| **Schema DAG & Foreign Keys** | Topological sorting (Kahn's algorithm) for DDL execution | `bun test packages/synapse/test/schema-dag.test.ts` |
| **Schema Drift Detection** | Live catalog vs slice AST comparison (`synapse db-drift`) | `bun test packages/synapse/test/schema-drift.test.ts` |
| **Blast Radius & Impact Analysis** | Cross-slice FK, shared module, and table impact (`synapse impact`) | `bun test packages/synapse/test/impact-analyzer.test.ts` |
| **Domain-to-HTTP Mapping** | Deterministic mapping (`UNAUTHORIZED` → 401, `FORBIDDEN` → 403, `NOT_FOUND` → 404, etc.) | `bun test packages/synapse/test/runtime-server.test.ts` |
| **Isomorphic Client/Server Splitter** | Reachability analysis into `shared`, `server`, and `client` modules | `bun test packages/synapse/test/slice-splitter.test.ts` |
| **Zero-Leak Compilation Gate** | Client bundle strictly verified for absence of SQL, DB, Bun globals | `bun test packages/synapse/test/slice-splitter.test.ts` |
| **Embedded SQLite Engine** | WAL mode, statement cache, transaction mutex, CTE safety | `bun test packages/synapse/test/sqlite-client.test.ts` |
| **PostgreSQL Parity** | Real connection pooling (`postgres.js`), transaction rollbacks | `bun run test:postgres` (requires `TEST_DATABASE_URL`) |
| **Isomorphic Query Builder** | Relational queries (`findMany`, `insert`, `update`, `delete`, joins) | `bun test packages/synapse/test/query-builder.test.ts` |
| **Relational Joins & Nesting** | Joined rows nested into sub-objects via `nestJoinedRow` | `bun test packages/synapse/test/query-builder-joins.test.ts` |
| **Tagged SQL Template** | Parameterized query interpolation with `db.sql` and `db.sqlOne` | `bun test packages/synapse/test/sql-tagged.test.ts` |
| **Signed Sessions & RBAC** | Cryptographic token signing, `requireAuth(session, roles)` | `bun test packages/synapse/test/runtime-server.test.ts` + `bun test packages/synapse/test/session-cookie.test.ts` |
| **B2B Multi-Tenancy & IDOR** | Session tenant validation via `requireTenant` | `bun test packages/synapse/test/multi-tenancy.test.ts` |
| **Declarative UI Primitives** | `<DataTable>`, `<DataForm>`, `<Button>`, `<Card>`, `<Badge>`, etc. | `bun test packages/synapse/test/client-primitives.test.ts` |
| **UI Layouts & Turbo Morphing** | Hierarchical `_layout.tsx` and rehydrated morphing navigation | `bun test packages/synapse/test/layouts-morphing.test.ts` |
| **Realtime Declarative SSE** | Server-Sent Events via `EventHub` and client `useSubscription` | `bun test packages/synapse/test/sse-gateway.test.ts` + `event-hub.test.ts` |
| **Unified Object Storage** | Local filesystem + AWS S3 / Cloudflare R2 with SigV4 presigned URLs | `bun test packages/synapse/test/storage.test.ts` |
| **Distributed PostgreSQL Queue** | Atomic `FOR UPDATE SKIP LOCKED`, exponential backoff, DLQ | `bun test packages/synapse/test/postgres-queue.test.ts` |
| **SQLite Queue & Worker** | In-slice `defineJob` and dedicated runner via `synapse worker` | `bun test packages/synapse/test/jobs-queue.test.ts` |
| **Webhooks Gateway** | Preserves `rawBody: Uint8Array` for cryptographic HMAC verification | `bun test packages/synapse/test/webhooks.test.ts` |
| **Slice Scaffolder** | AST generator with `--fields` grammar and multiple templates | `bun test packages/synapse/test/scaffolder.test.ts` + `fields-parser.test.ts` |
| **Model Context Protocol (MCP)** | Stdio JSON-RPC 2.0 server with 11 native tools for AI agents | `bun test packages/synapse/test/mcp-server.test.ts` |
| **Skeleton Map Generator** | Compressed AST digest (`.codebase/repo-map.d.ts`, <3000 tokens) | `bun test packages/synapse/test/repo-map.test.ts` |
| **Centralized Schema Catalog** | Generated types for database tables (`.codebase/db-schema.d.ts`) | `bun test packages/synapse/test/db-schema-generator.test.ts` |
| **Standalone Packaging** | Compiles deployable package into `.synapse/standalone/` | `bun test packages/synapse/test/standalone-builder.test.ts` |
| **Property-Based Oracles** | Fast-Check PBT and named invariants executed under `bun:test` | `bun test packages/synapse/test/oracle-runner.test.ts` |
| **Observability & Logging** | Structured JSON logs (`SYNAPSE_LOG=json`) & Prometheus endpoint | `bun test packages/synapse/test/observability-metrics.test.ts` |
| **Live E2E Integration Suite** | 12 real HTTP checks covering SSR, RPC, RBAC, Idempotency | `bun run test:e2e` |
| **Publish Rehearsal** | Validates package tarball as an external consumer would install | `bun run rehearse:publish` |
| **Bidirectional DDL & Rollbacks** | `-- up:` and `-- down:` demarcation, transactional schema rollback (`synapse rollback`) | `bun test packages/synapse/test/onda2.test.ts` |
| **Vendor Code-Splitting** | Splits React/ReactDOM into shared `_vendor.js`, slice micro-bundles (< 500B) via `importmap` | `bun test packages/synapse/test/onda1.test.ts` |
| **Dynamic Head Metadata** | Slices export `sliceMeta(data, ctx)` for dynamic title, description, and Open Graph tags | `bun test packages/synapse/test/onda1.test.ts` |
| **Hierarchical Domain Layouts** | Nested domain layouts `src/slices/<domain>/_layout.tsx` wrapped in root layout | `bun test packages/synapse/test/onda1.test.ts` |
| **Token Bucket Rate Limiting** | Sliding-window `TokenBucketRateLimiter` with strict RFC 6585 headers | `bun test packages/synapse/test/onda2.test.ts` |
| **Streaming Upload Guard** | Memory-safe multipart parser with early HTTP 413 rejection preventing OOM DoS | `bun test packages/synapse/test/onda2.test.ts` |
| **Distributed Event Hub** | `PostgresEventHub` with dedicated persistent `LISTEN` connection and large payload offloading | `bun test packages/synapse/test/onda3.test.ts` |
| **Isomorphic i18n Routing** | `createTranslator` primitive and localized URL routes (`/:locale/*`) with `<html lang>` | `bun test packages/synapse/test/onda3.test.ts` |
| **Advanced `<DataForm>` Primitives** | Dot-notation nested fields (`user.profile.bio`), file inputs, and inline `fieldErrors` | `bun test packages/synapse/test/onda4.test.ts` |
| **Session Token Revocation** | Cryptographic token revocation blacklist (`TOKEN_REVOKED`) with memory cache & DB | `bun test packages/synapse/test/onda4.test.ts` |
| **TOTP 2FA Authentication** | Scaffolding template (`auth-2fa`) with base32 secret generation and TOTP verification | `bun test packages/synapse/test/onda4.test.ts` |
| **On-Demand Image Optimizer** | Image resizing endpoint (`/_synapse/images/optimize`) with dynamic sharp & safe fallback | `bun test packages/synapse/test/onda4.test.ts` |
| **Plugin Lifecycle Hooks** | Infrastructure hooks in `defineConfig` (`onBootstrap`, `onRequest`, `onResponse`, `onMigrate`) | `bun test packages/synapse/test/onda4.test.ts` |

### Experimental

| Feature | Current State | What Is Missing |
|---|---|---|
| **SSR Cookie Credential Forwarding** | Reads `synapse_token` and `synapse_roles` cookies to forward as auth headers | Convenient for browser testing; production requires fully signed session cookies behind TLS. |

### Roadmap

| Feature | Scope & Goal |
|---|---|
| **Distributed Multi-Region Cache** | Redis / Dragonfly adapters for multi-instance invalidation. |

---

## 4. Repository Topology

```text
packages/synapse/
  src/core/            Result/Option, DatabaseClient, SQLite, Postgres, QueryBuilder, Storage, PostgresQueue, Session, RPC
  src/client/          Declarative UI primitives (DataTable, DataForm, Button, Card, Badge, Pagination, hooks, i18n)
  src/compiler/        Slice discovery, migration runner, schema generator, fields parser, scaffolder, splitter, repo-map, standalone builder
  src/runtime/         Bun.serve router, SSR shell, RPC dispatcher, SynapseProvider, Turbo Morphing script, PostgresEventHub, RateLimiter
  src/mcp/             Native Model Context Protocol (MCP) stdio JSON-RPC 2.0 server (11 tools)
  bin/synapse.ts       Main CLI entry point
  templates/starter/   Starter template copied by `synapse new` (standalone packaging + Dockerfile)
  test/                Framework test suite (359 tests, 49 files) + splitter and oracle fixtures
Dockerfile             Production multi-stage Dockerfile (Bun on Alpine, ~90MB)
examples/enterprise-crm/       Reference application: 3 vertical slices + live E2E test suite (12 checks)
examples/helpdesk-slices/      2 features implemented using vertical slices
examples/helpdesk-conventional/ The exact same 2 features implemented in layered architecture (comparator)
.synapse/              Generated artifacts (gitignored): SQLite DB, split modules, oracle wrappers
.codebase/             Generated repo map and DB schema catalog (committed per app)
AGENTS.md              Machine-level technical instructions and SureForge quality rules
STUDY.md               Pre-registered empirical study comparing slices vs layered architecture
```

---

## 5. Quick Start & Prerequisites

### Prerequisites
- **Bun >= 1.2.0** installed on your system.
```bash
curl -fsSL https://bun.sh/install | bash
```

### Installation & Scaffolding
Create a new project using the official CLI:
```bash
bunx synapsejs new my-saas-app
cd my-saas-app
bun install
```

### Running Development Server
Start the Bun development server with auto-discovery, live migrations, and the interactive Dev Hub:
```bash
bun run dev
# Server running at http://localhost:3000
```

### Scaffolding Your First Slice
Generate a complete vertical slice with TypeBox contracts, SQL DDL, Server Action, React UI, and test oracles:
```bash
bun run new-slice customers create-customer --fields="name:string,email:string,role:enum(ADMIN|USER)"
```

### Running Checks and Oracles
```bash
bun run check        # Run machine diagnostics
bun run test         # Execute slice invariants & property-based tests
bun run split        # Verify client/server reachability and 0-leak gates
```

---

## 6. Anatomy of a Slice (`*.slice.tsx`)

A slice is a single file located at `src/slices/<domain>/<name>.slice.tsx`.

Here is an authentic, production-grade slice demonstrating contracts, DDL, action, UI, loader, test oracle, and background job:

```tsx
import {
  Type,
  type Static,
  Value,
  Ok,
  Err,
  type Result,
  type DatabaseClient,
  type SessionContext,
  requireAuth,
  defineJob,
  type ActionContext,
  DataTable,
  Button
} from 'synapsejs';

// 1. Input Contract (TypeBox JIT schema)
export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 })
});
export type TicketInput = Static<typeof TicketInputSchema>;

// 2. Database DDL (Applied once per statement, tracked in _synapse_migration_statements)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// 3. Output Contract (Strict functional Result, no throwing)
export type TicketOutput = Result<
  { ticketId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// 4. Background Job Definition
export const notifyStaffJob = defineJob<{ ticketId: string }>({
  name: 'notify-staff-ticket-created',
  retryLimit: 3,
  backoffSeconds: 5,
  perform: async (payload, ctx) => {
    // Background worker task (executed via `synapse worker`)
    console.log(`Notifying staff about ticket ${payload.ticketId}`);
  }
});

// 5. Server Action
// Notice: `db` and `session` are optional parameters.
// On the server, the runtime injects them. On the client, this call becomes an RPC stub.
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
  const ticketId = crypto.randomUUID();

  await db.query(
    `INSERT INTO tickets (id, subject, priority, status) VALUES ($1, $2, $3, 'OPEN')`,
    [ticketId, input.subject, input.priority]
  );

  return Ok({ ticketId });
}

// 6. SSR Data Loader (Executed on server prior to rendering)
export async function createTicketLoader(ctx: { db: DatabaseClient; session: SessionContext }) {
  const recentTickets = await ctx.db.findMany<{ id: string; subject: string; priority: number }>(
    'tickets',
    { limit: 5, orderBy: { created_at: 'DESC' } }
  );
  return { recentTickets };
}

// 7. React UI Component
export function CreateTicketComponent(props: {
  recentTickets?: Array<{ id: string; subject: string; priority: number }>;
  onSubmitAction?: (payload: unknown) => Promise<TicketOutput>;
}) {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Open Support Ticket</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const formData = new FormData(form);
          const payload = {
            subject: String(formData.get('subject')),
            priority: Number(formData.get('priority'))
          };
          const res = await props.onSubmitAction?.(payload);
          if (res?.ok) alert(`Ticket created: ${res.value.ticketId}`);
          else alert(`Error: ${res?.error}`);
        }}
        className="space-y-4"
      >
        <input name="subject" placeholder="Subject" className="w-full border p-2 rounded" />
        <input name="priority" type="number" defaultValue={3} className="w-full border p-2 rounded" />
        <Button type="submit">Submit Ticket</Button>
      </form>

      {props.recentTickets && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Recent Tickets</h2>
          <DataTable
            data={props.recentTickets}
            columns={[
              { key: 'subject', header: 'Subject' },
              { key: 'priority', header: 'Priority' }
            ]}
          />
        </div>
      )}
    </div>
  );
}

// 8. Test Oracle (Executed via `synapse test` using bun:test)
export const sliceTests = {
  description: 'Support Ticket Invariants',
  cases: [
    {
      name: 'anonymous requests return UNAUTHORIZED before touching DB',
      run: async () => {
        const result = await createTicketAction({ subject: 'Network Down', priority: 1 });
        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(`Expected UNAUTHORIZED, received ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'payload failing schema returns INVALID_SCHEMA',
      run: async () => {
        // Authenticated mock session
        const session = { userId: 'u1', roles: ['support'] };
        const mockDb = { query: async () => [] } as unknown as DatabaseClient;
        const result = await createTicketAction({ subject: 'ab', priority: 10 }, mockDb, session);
        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`Expected INVALID_SCHEMA, received ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
```

### Discovery & Naming Conventions
The framework runtime automatically resolves slice exports by suffix rules:
- **Input Contract**: Ends with `Schema` (e.g. `TicketInputSchema`).
- **DDL Statement**: Exported as `sliceSchema`.
- **Server Action**: Named `<name>Action` (e.g. `createTicketAction`).
- **React Component**: Suffix `Trigger`, `View`, `Form`, or `Component` (e.g. `CreateTicketComponent`).
- **SSR Loader**: Suffix `Loader` (e.g. `createTicketLoader`).
- **Test Oracle**: Named `sliceTests` (contains `{ cases: [...] }`).
- **Webhook Endpoint**: Suffix `Webhook` (e.g. `stripeWebhook`).
- **Background Jobs**: Any export created with `defineJob`.

---

## 7. The Isomorphic Splitter & Leak-Proof Gates

When you run `synapse split` or `synapse build`, the AST compiler analyzes the slice's dependency graph via TypeScript type-checker reachability and partitions it into three artifacts:

```text
src/slices/tickets/create-ticket.slice.tsx
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   shared.tsx     │   │    server.ts     │   │   client.tsx     │
│ TypeBox schemas, │   │ DDL, SQL queries,│   │ React component, │
│ TypeScript types │   │ action bodies, DB│   │ RPC stub wrapper │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

### Two Mandatory Verification Gates
To guarantee safety and prevent server leakage into client bundles, two gates must pass:

1. **Compilation Gate**: Emitted `shared.tsx`, `server.ts`, and `client.tsx` modules are typechecked against the application's actual `tsconfig.json`.
2. **Zero-Leak Gate**: The emitted `client.tsx` is AST-scanned. It is strictly forbidden from referencing:
   - SQL keywords or raw query strings
   - `db.query`, `db.findMany`, etc.
   - `sliceSchema`
   - `process.env`
   - Bun globals (`Bun.serve`, `Bun.password`, `Bun.spawn`, etc.)

If server actions are called from the UI, the splitter generates a wire-only RPC stub:
```ts
// Emitted inside client.tsx
export async function createTicketAction(payload: unknown): Promise<TicketOutput> {
  return rpcCall<TicketOutput>('/_synapse/rpc/tickets/create-ticket', payload);
}
```

---

## 8. Persistence & Isomorphic Query Builder

SynapseJS includes database clients for both embedded development and enterprise production:

### 1. Embedded SQLite (`SqliteDatabaseClient`)
- Native Bun binding (`bun:sqlite`).
- Automatic WAL (Write-Ahead Logging) mode.
- In-memory statement cache (bounded LRU, 256 prepared statements).
- Mutex-serialized concurrent write transactions.
- CTE-safe read queries.

### 2. PostgreSQL Parity (`PostgresDatabaseClient`)
- Backed by `postgres.js` with true connection pooling.
- Verified in CI against real `postgres:16-alpine`.
- Identical transactional semantic guarantees (`db.transaction`).

### 3. Isomorphic Query Builder
Write type-safe, parameterized queries without writing raw SQL strings:

```ts
// Find multiple rows with relational operators, pagination, and sorting
const customers = await db.findMany<Customer>('customers', {
  where: {
    status: { eq: 'ACTIVE' },
    creditScore: { gte: 700 },
    country: { in: ['BR', 'US', 'CA'] }
  },
  limit: 20,
  offset: 0,
  orderBy: { created_at: 'DESC' }
});

// Parameterized relational JOINs with sub-object row nesting
const ordersWithCustomer = await db.findMany('orders', {
  join: [
    {
      table: 'customers',
      on: { customer_id: 'id' },
      select: ['name', 'email'],
      as: 'customer'
    }
  ]
});
// Result automatically nested:
// [{ id: 'ord_1', total: 100, customer: { name: 'Acme Corp', email: 'billing@acme.com' } }]

// Insert, Update, Delete
await db.insert('customers', { id: 'c1', name: 'John Doe', status: 'ACTIVE' });
await db.update('customers', { status: 'INACTIVE' }, { id: { eq: 'c1' } });
await db.delete('customers', { id: { eq: 'c1' } });
```

### 4. Tagged SQL Interpolation
When raw SQL is needed, use `db.sql` and `db.sqlOne`. They automatically parameterize template variables:

```ts
const user = await db.sqlOne<User>`
  SELECT id, email, created_at 
  FROM users 
  WHERE email = ${inputEmail} AND tenant_id = ${session.tenantId}
`;
```

---

## 9. Declarative Migrations, Schema DAG, Drift & Impact

### Idempotent Statement-by-Statement Migrations
`sliceSchema` strings are tokenized into individual SQL statements. Each statement is executed and recorded in `_synapse_migration_statements` with its SHA-256 hash.
- Running `synapse migrate` executes only new statements.
- An `ALTER TABLE customers ADD COLUMN phone TEXT;` runs exactly once.
- If a statement fails, it is not recorded, and the runner outputs a machine-readable failure report.

### Bidirectional Migrations & Transactional Rollback (`synapse rollback`)
`sliceSchema` supports optional `-- up:` and `-- down:` demarcations for reversible schema migrations:

```sql
export const sliceSchema = `
  -- up:
  ALTER TABLE customers ADD COLUMN nickname TEXT;

  -- down:
  ALTER TABLE customers DROP COLUMN nickname;
`;
```

Running `synapse rollback [targetSlice] [--steps=N]` or calling the MCP tool `synapse_rollback`:
- Executes corresponding down statements in reverse chronological order within an atomic transaction.
- Cleans up tracked statements from `_synapse_migration_statements`.
- Prevents database corruption or stranded schema state during failed deployments.

### Schema DAG (Topological Sorting)
When slices have Foreign Key references, Kahn's algorithm topologically orders migrations so parent tables are created before dependent child tables.

### Schema Drift Detection (`synapse db-drift`)
Checks live SQLite or PostgreSQL tables and columns against slice `sliceSchema` declarations:
```bash
synapse db-drift
```
Emits structured JSON detecting:
- `missingTables`: Tables declared in slices but not yet created in the database.
- `missingColumns`: Columns declared in slices missing from live tables.
- `orphanTables`: Tables residing in the database not claimed by any vertical slice.

### Blast Radius & Impact Analysis (`synapse impact <target>`)
Analyzes cross-slice dependencies across Foreign Keys, shared module imports, and database tables:
```bash
synapse impact src/slices/customers/create-customer.slice.tsx
```
Output:
```json
{
  "status": "PASS",
  "operation": "IMPACT_ANALYSIS",
  "target": "src/slices/customers/create-customer.slice.tsx",
  "totalImpacted": 2,
  "impactedSlices": [
    {
      "sliceName": "create-customer",
      "domain": "customers",
      "reason": "DIRECT",
      "detail": "Target slice directly modified"
    },
    {
      "sliceName": "generate-invoice",
      "domain": "billing",
      "reason": "FOREIGN_KEY_DEPENDENCY",
      "detail": "Table 'customers' referenced via foreign key"
    }
  ],
  "recommendedCommands": ["synapse check", "synapse split", "synapse db-drift", "synapse migrate", "synapse test"]
}
```

---

## 10. Background Jobs & Distributed Queue Engine

Background processing is defined natively inside vertical slices using `defineJob`.

### Job Declaration & Enqueueing
```ts
export const processPaymentJob = defineJob<PaymentPayload>({
  name: 'process-payment',
  retryLimit: 5,
  backoffSeconds: 10,
  perform: async (payload, ctx) => {
    await ctx.services.paymentGateway.charge(payload);
  }
});

// Enqueue inside any Server Action:
await ctx.enqueue(processPaymentJob, { amount: 5000, currency: 'USD' });
```

### Dedicated Worker Process
Run the queue worker in a dedicated process or container:
```bash
synapse worker
```

### PostgreSQL Distributed Concurrency (`PostgresQueueEngine`)
For multi-instance deployments, the PostgreSQL queue engine provides:
- **Atomic distributed popping**: Uses `FOR UPDATE SKIP LOCKED` so concurrent workers never process the same job.
- **Exponential backoff with full jitter**: Prevents thundering herds on third-party service recovery.
- **Dead-Letter Queue (`_synapse_jobs_dlq`)**: Automatically routes exhausted jobs to the DLQ after `retryLimit` failures.
- **Worker crash recovery**: Recovers orphaned jobs if a worker process dies mid-execution (visibility timeout).

---

## 11. Unified Object Storage & Webhooks Gateway

### Object Storage Abstraction (`getStorage()`)
Switch between local development and cloud production with zero code changes:
- `LocalStorageAdapter`: Stores uploads locally under `.synapse/storage/` with strict directory traversal prevention.
- `S3StorageAdapter`: Connects to AWS S3, Cloudflare R2, or MinIO, computing authentic HMAC-SHA256 AWS SigV4 signatures for presigned upload and download URLs.

```ts
const storage = getStorage();

// Put an object directly
await storage.put('invoices/inv-001.pdf', pdfBuffer, 'application/pdf');

// Generate a presigned upload URL (valid for 15 minutes)
const uploadUrl = await storage.createPresignedUploadUrl('avatars/user-123.png', 900);
```

### Webhooks Gateway with Raw Body Preservation
External payment webhooks (Stripe, GitHub, Shopify) require cryptographic HMAC signature validation against the unmodified raw request body.

Export a `<Name>Webhook` handler:
```ts
export async function stripeWebhook(event: WebhookEvent, ctx: ActionContext) {
  const signature = event.headers.get('stripe-signature');
  // event.rawBody is a Uint8Array containing the pristine bytes
  const verified = stripe.webhooks.constructEvent(event.bodyText, signature, webhookSecret);
  return { received: true };
}
```
Available at: `POST /_synapse/webhooks/<domain>/<name>`

---

## 12. Security, RBAC, Multi-Tenancy & Social Auth

### Session Authentication & Signed Tokens
Synapse resolves sessions from any of three request headers:
- `Authorization: Bearer <token>`
- `x-user-id`
- `x-user-roles`

In production, set `SYNAPSE_SESSION_SECRET`. Bearer tokens are cryptographically validated HMAC-SHA256 signatures (`signSessionToken` / `verifySessionToken`). Once configured, raw role headers are ignored, eliminating header-forgery attacks.

### Explicit Role-Based Access Control (RBAC)
No magic annotations. Authorize explicitly and return deterministic errors:
```ts
const auth = requireAuth(session, ['admin', 'billing']);
if (!auth.ok) return Err(auth.error); // Returns Err('UNAUTHORIZED') or Err('FORBIDDEN')
```

### B2B Multi-Tenancy & IDOR Prevention
The framework resolves `tenantId` from `x-tenant-id`, subdomains, or session claims:
```ts
const tenant = requireTenant(session, resource.tenantId);
if (!tenant.ok) return Err(tenant.error); // Returns Err('FORBIDDEN') deterministically
```

### Social Auth Scaffolding
Generate an end-to-end OAuth2 authentication slice in one command:
```bash
synapse new-slice auth github --template=oauth-github
```

---

## 13. Declarative UI Primitives, Layouts & Turbo Morphing

### Zero-Bloat Declarative UI Primitives
Synapse ships accessible, typed React primitives designed for zero bundle bloat:
- `<DataTable data={rows} columns={cols} />`
- `<DataForm schema={InputSchema} onSubmit={action} />` (supports dot-notation fields e.g. `user.profile.bio`, file uploads, and inline `fieldErrors`)
- `<Button variant="primary">Submit</Button>`
- `<Card>`, `<Badge>`, `<Pagination>`
- Hooks: `useAction`, `useLoaderData`, `useSubscription`, `useSession`

### Root & Hierarchical Domain Layouts (`_layout.tsx`)
Create `src/slices/_layout.tsx` to wrap all SSR pages with common navigation, sidebars, and branding. For domain-specific layout hierarchies (e.g. admin panels or billing portals), create `src/slices/<domain>/_layout.tsx` to wrap domain slices without duplicating root layout chrome.

### Dynamic SEO & Open Graph Metadata (`sliceMeta`)
Slices can export an optional `sliceMeta(data, context)` function to define page `<title>`, `<meta>`, canonical links, and Open Graph tags during SSR:
```tsx
export function sliceMeta(data: CustomerOutput, ctx: LoaderContext) {
  return {
    title: `${data.name} — Customer Profile`,
    description: `Manage customer ${data.name} and billing subscriptions.`,
    openGraph: {
      title: data.name,
      type: 'profile'
    }
  };
}
```
The client/server splitter erases `sliceMeta` from client-side bundles with zero leaks.

### Isomorphic i18n Routing & Localization
Synapse supports isomorphic internationalization via `createTranslator` and localized URL routing (`/:locale/*`, e.g. `/en/tickets`, `/pt-BR/tickets`):
```tsx
import { createTranslator } from 'synapsejs/client';

const t = createTranslator({
  en: { welcome: 'Welcome, {name}!' },
  'pt-BR': { welcome: 'Bem-vindo, {name}!' }
}, 'pt-BR');

console.log(t('welcome', { name: 'Alice' })); // "Bem-vindo, Alice!"
```

### Turbo Morphing SPA Router
Every SSR shell includes `/_synapse/turbo-router.js`. Client-side page navigation fetches the server-rendered HTML and morphs the `#synapse-root` DOM in place. Users experience instant SPA transitions with zero full-page white flashes, while keeping complete SEO server-rendering.

### Realtime SSE Gateway
Broadcast and subscribe to real-time events without managing WebSocket state:
```ts
// Server action:
ctx.broadcast('orders', { orderId: 'ord_123', status: 'PAID' });

// React component:
useSubscription('orders', (event) => {
  console.log('Order update received:', event);
});
```

---

## 14. Native Model Context Protocol (MCP) Server

SynapseJS ships a native Model Context Protocol (MCP) stdio server over JSON-RPC 2.0, exposing 11 specialized tools to autonomous AI coding agents (Cursor, Claude Code, Windsurf, Antigravity):

```bash
bun run mcp
```

### Host Configuration (`mcpServers`)
```json
{
  "mcpServers": {
    "synapsejs": {
      "command": "bunx",
      "args": ["synapse", "mcp"],
      "cwd": "/path/to/your/synapse-project"
    }
  }
}
```

### The 11 MCP Tools

| Tool | Purpose |
|---|---|
| `synapse_get_repo_map` | Returns compressed codebase skeleton AST (`.codebase/repo-map.d.ts`, <3000 tokens). |
| `synapse_get_db_schema` | Centralized database schema catalog (`.codebase/db-schema.d.ts`) for query context. |
| `synapse_check` | Machine diagnostics returning exact coordinates (`file`, `line`, `col`, `code`). |
| `synapse_split` | Runs slice splitter and leak verification gates. |
| `synapse_run_pbt` | Executes Fast-Check property-based tests across slices. |
| `synapse_scaffold_slice` | Scaffolds slices using templates and the `--fields` grammar. |
| `synapse_migrate` | Applies declarative DDL migrations to the active database idempotently. |
| `synapse_rollback` | Transactionally rolls back migration statements matching down blocks. |
| `synapse_contract` | Returns the framework authoring contract, HTTP semantics, and naming rules. |
| `synapse_check_db_drift` | Inspects live database against slice DDLs for missing/orphan tables and columns. |
| `synapse_diff_impact` | Computes cross-slice blast radius for code, schema, and shared changes. |

---

## 15. CLI Reference

All CLI subcommands output valid JSON to `stdout` and exit with `0` on success, `1` on failure.

| Command | Arguments / Flags | Description |
|---|---|---|
| `synapse dev` | `[port] [--watch]` | Starts local HTTP server with auto-discovery, live migrations, and Dev Hub. |
| `synapse start` | `[port]` | Starts production server with graceful shutdown (`SIGTERM`/`SIGINT`). |
| `synapse check` | `[file]` | Runs TypeScript diagnostics, printing issues with line/col coordinates. |
| `synapse migrate` | — | Applies pending slice DDL statements idempotently. |
| `synapse rollback` | `[targetSlice] [--steps=N]` | Transactionally rolls back migration statements matching down blocks. |
| `synapse db-drift` | — | Compares live database schema against slice DDL ASTs. |
| `synapse impact` | `<target>` | Calculates blast radius across FKs, shared modules, and tables. |
| `synapse mcp` | — | Starts the Model Context Protocol stdio server. |
| `synapse skeleton` | — | Generates `.codebase/repo-map.d.ts` and `.codebase/db-schema.d.ts`. |
| `synapse db-schema` | — | Generates standalone database catalog DAG. |
| `synapse split` | — | Partitions all slices into `shared`, `server`, and `client` modules. |
| `synapse test` | — | Executes Fast-Check property test oracles under `bun:test`. |
| `synapse new-slice` | `<domain> <name> [--template=...] [--fields=...]` | Scaffolds a vertical slice. Templates: `create`, `list`, `update`, `delete`, `login`, `auth-2fa`, `oauth-github`, `crud`. |
| `synapse build` | `[--standalone]` | Pre-builds client bundles or packages a standalone release into `.synapse/standalone/`. |
| `synapse worker` | — | Starts the continuous background jobs queue worker. |
| `synapse contract` | `[--markdown]` | Emits machine contract specifications as JSON or Markdown. |
| `synapse info` | — | Emits machine metadata and verified evidence for every feature. |

---

## 16. Production Deployment & Observability

### Standalone Production Build
Compile your application into a self-contained, standalone production package:
```bash
synapse build --standalone
```
Artifacts are emitted to `.synapse/standalone/`, including pre-compiled server entry points and client bundles.

### Docker Image
The repository includes a production multi-stage `Dockerfile` built on Alpine Linux and Bun:
- **Image Size**: ~90MB.
- **Security**: Runs under unprivileged user `bun`.
```bash
docker build -t my-synapse-app .
docker run -p 3000:3000 -e SYNAPSE_SESSION_SECRET="your-secret" my-synapse-app
```

### Observability & Prometheus Metrics
- **Prometheus Endpoint**: `GET /_synapse/api/metrics` (or with `Accept: text/plain`) exports request counts, latencies, and uptime.
- **Structured JSON Logging**: Set `SYNAPSE_LOG=json` to output newline-delimited JSON logs per request.
- **CDN Air-Gap Mode**: Set `SYNAPSE_DISABLE_CDN=1` to suppress external Tailwind and Google Fonts CDNs for strictly air-gapped or offline enterprise environments.

---

## 17. Empirical Benchmarks & Measured Evidence

To adhere to the SureForge Protocol and Anti-Hype rules, all numbers below are produced by automated benchmark scripts in this repository.

### 1. Framework Test Suite
```text
320 pass
0 fail
1182 expect() calls
Ran 320 tests across 45 files.
```
Executed via: `bun test packages/synapse/test`

### 2. Context Surface Benchmark (`bun run bench`)
Comparing two features ("open ticket", "assign ticket") implemented in vertical slices versus conventional layered architecture:

| Application | Feature | Files (App) | Tokens (App, Est.) | Files (Total) | Tokens (Total, Est.) |
|---|---|---|---|---|---|
| **helpdesk-slices** | open ticket | **1** | **1,627** | 46 | 94,971 |
| **helpdesk-slices** | assign ticket | **1** | **1,393** | 46 | 94,738 |
| **helpdesk-conventional** | open ticket | 5 | 1,832 | 5 | 1,832 |
| **helpdesk-conventional** | assign ticket | 5 | 1,832 | 5 | 1,832 |

#### What the benchmark proves:
- Vertical slices reduce the number of files coordinated per feature from **5 to 1**.
- Application token surface for the feature drops from 1,832 to 1,627 (~11% reduction).

#### What the benchmark does NOT prove:
- The `Total` column for slices includes the framework type barrel reached via `paths` (~94k tokens), paid once and shared across features.
- We do **not** claim that fewer files automatically makes an AI agent faster or smarter; that is behavioral and requires empirical agent trajectory testing.

### 3. Concurrency Benchmark (`bun run bench:concurrency`)
Testing local `Bun.serve` HTTP throughput under 50 concurrent connections over 1,000 requests:
- **Throughput**: >53,000 requests/sec.
- **Latencies**: p50 = 0.53ms, p95 = 7.81ms, p99 = 8.00ms.
- **Errors**: 0.

### 4. Controlled Empirical Study Summary (`STUDY.md`)
A pre-registered pilot study measured changes across 3 maintenance tasks:
- **Supported claim**: A change touches **1.0 file** on average in slices vs **3.7 files** in conventional layered architecture.
- **Unsupported claim**: Slices do *not* require fewer lines of code. In fact, slices wrote **more lines** (+197 vs +151 lines) because schemas, actions, UI, and oracles are declared together in the feature file.
- **Unmeasured claims**: Agent token consumption and task completion speed were not measured and are not claimed.

---

## 18. Known Limitations & Engineering Boundaries

In the spirit of **Radical Candor**, we explicitly document what SynapseJS does not do:

1. **Bun Exclusivity**: Relies directly on Bun APIs (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). It does not run on Node.js, Deno, or Cloudflare Workers without a Bun runtime.
2. **Query Builder Scope**: Optimized for single-table transactions and parameterized relational joins. For complex analytical multi-table queries or OLAP workloads, use `db.sql` or plug Kysely via `services`.
3. **Reversible Migrations Scope**: Slices support bidirectional migrations via `-- up:` and `-- down:` demarcations paired with `synapse rollback`. For legacy slices or statements without an explicit `-- down:` directive, migrations remain forward-only and require compensating statements.
4. **Application-Level Multi-Tenancy**: Multi-tenancy is enforced deterministically at the application layer via `requireTenant` and verified session tokens. There is no transparent database-level Row-Level Security (RLS) injection without explicit tenant passing.
5. **Realtime Protocol**: Realtime is handled via Server-Sent Events (SSE) through `EventHub` and `useSubscription`. Full-duplex bidirectional WebSockets are not part of the core kernel.

---

## 19. Public Package API Contract

The following public exports are frozen and asserted by `packages/synapse/test/machine-types.test.ts`:

```typescript
import {
  // Functional Error Handling
  Result, Ok, Err, isOk, isErr, map, mapErr, unwrapOr, Option, Some, None,

  // Runtime, Database & Context
  SynapseServer, getDatabase, resetDatabaseInstance,
  SqliteDatabaseClient, PostgresDatabaseClient, MockDatabaseClient,
  type DatabaseClient, compileTaggedSql,
  type ActionContext, createActionContext,
  defineConfig, loadSynapseConfig,

  // Object Storage & Optimization
  type StorageClient, getStorage, LocalStorageAdapter, S3StorageAdapter,
  optimizeImage,

  // Background Jobs & Distributed Queue
  defineJob, QueueEngine, PostgresQueueEngine, type JobRecord, type JobDefinition,

  // Isomorphic RPC & Sessions
  rpcCall, rpcTransportFailure, type RpcTransportError,
  AnonymousSession, createSession, requireAuth, requireTenant,
  hasRole, hasAnyRole, type SessionContext,
  storeSession, clearSession, currentRoles, sessionCookie,
  revokeSessionToken, isSessionTokenRevoked,

  // JIT Validation & PBT
  Type, type Static, type TSchema, Value, fc,

  // Declarative UI Primitives, Hooks & i18n
  DataTable, DataForm, Button, Card, Badge, Pagination,
  SynapseProvider, useAction, useLoaderData, useSubscription, useSession, useSynapseContext,
  createTranslator,

  // Realtime SSE Gateway
  EventHub, getEventHub, resetEventHub,

  // Compiler, Migrations, DAG & Drift
  runSliceMigrations, rollbackSliceMigrations, runMachineVerifications,
  orderSlicesByDag, parseTableDependencies, generateDatabaseSchemaCatalog,
  checkSchemaDrift, analyzeImpact, nestJoinedRow,
  resolveSlicesDir, findSliceFiles, SLICE_EXTENSION,
  splitSlice, verifySplit, writeSplitArtifacts, artifactDirectory,
  scaffoldSlice, scaffoldCrud, parseFields, compressRepositoryAST, buildStandalone,

  // Native MCP Server
  SynapseMcpServer
} from 'synapsejs';
```

---

## 20. License & Credits

Released under the **MIT License**.

Designed and created by **[Ismael Soilet](https://github.com/ismaelsoilet)**. Built for resilient, machine-verifiable, human-auditable software engineering.
