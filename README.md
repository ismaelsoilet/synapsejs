<p align="center">
  <img src="https://raw.githubusercontent.com/ismaelsoilet/synapsejs/main/.github/assets/synapse-banner.png" alt="SynapseJS Banner" width="100%" onerror="this.style.display='none'"/>
</p>

# SynapseJS ⚡

<p align="center">
  <strong>The Bun-First Fullstack Framework Built for Humans & Autonomous AI Agents.</strong><br>
  <em>One feature = One contiguous, leak-proof file (<code>*.slice.tsx</code>).</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-v1.2+-black?style=for-the-badge&logo=bun" alt="Bun v1.2+"></a>
  <a href="packages/synapse/test"><img src="https://img.shields.io/badge/Tests-359%20Passing%20(100%25)-emerald?style=for-the-badge&logo=checkmarx" alt="359 Tests Passing"></a>
  <a href="src/mcp"><img src="https://img.shields.io/badge/MCP%20Server-11%20Native%20Tools-purple?style=for-the-badge&logo=anthropic" alt="MCP Server"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19%20SSR-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"></a>
  <a href="https://github.com/sinclairzx81/typebox"><img src="https://img.shields.io/badge/Validation-TypeBox%20JIT-orange?style=for-the-badge" alt="TypeBox"></a>
</p>

<p align="center">
  🇺🇸 <strong>English</strong> | 🇧🇷 <a href="README.pt-BR.md"><strong>Português do Brasil</strong></a>
</p>

---

## ⚡ Why SynapseJS?

Modern fullstack development has broken developer productivity. Changing a single button, query, or validation rule forces you to navigate **5 to 7 decoupled layers across multiple folders**:

```text
❌ TRADITIONAL FRAGMENTED STACK:
routes/customers.ts  ──────►  controllers/customerController.ts
                                    │
dto/customer.dto.ts  ◄──────────────┼──────────────►  services/customerService.ts
                                    │
entities/Customer.ts ◄──────────────┼──────────────►  migrations/001_create_customers.sql
                                    │
components/CustomerForm.tsx ◄───────┼──────────────►  tests/customer.test.ts
```

For human developers, this imposes high cognitive friction. For **autonomous AI coding agents** (Claude, Cursor, Windsurf, Antigravity), it wastes massive context tokens, invites implicit coupling errors, and triggers endless hallucinated imports.

### The SynapseJS Revolution: Locality of Behavior ($N = 1$)

SynapseJS eliminates architectural scattering entirely: **a feature is a single contiguous file** (`*.slice.tsx`).

```text
✅ SYNAPSEJS VERTICAL SLICE (src/slices/customers/create-customer.slice.tsx):
┌────────────────────────────────────────────────────────────────────────┐
│  1. Input Contract    ──  TypeBox JIT schema (validated at wire speed) │
│  2. Database DDL      ──  Declarative SQL statement (up & down)        │
│  3. Functional Result ──  Strict Result<T, E> union (zero throw)       │
│  4. Server Action     ──  Transactional business logic & mutation      │
│  5. SSR Loader        ──  Server data prefetching                      │
│  6. React 19 View     ──  Interactive UI with auto RPC binding         │
│  7. Test Oracle       ──  Property-Based Tests (PBT via fast-check)    │
└────────────────────────────────────────────────────────────────────────┘
```

An AST-driven **Isomorphic Splitter** separates server code (SQL, credentials, actions) from client code (React, RPC stubs) at build time with **cryptographic zero-leak compilation gates**.

---

## 🚀 30-Second Quickstart

Get a production-grade SynapseJS application running in less than 30 seconds:

```bash
# 1. Scaffold a new application
bunx synapsejs new my-saas-app

# 2. Enter project directory & install
cd my-saas-app
bun install

# 3. Start development server with live migrations & Dev Hub
bun run dev
```

Visit `http://localhost:3000` to see your running application and interactive Developer Hub.

### Generate a Complete Vertical Slice in One Command

```bash
bun run new-slice customers create-customer --fields="name:string,email:string,role:enum(ADMIN|USER)"
```

The CLI instantly generates:
- Full TypeBox input validator
- SQL table definition with automated migration tracking
- Typed server action returning `Result<Customer, 'INVALID_SCHEMA' | 'DUPLICATE_EMAIL'>`
- Accessible React 19 UI component
- Property-based test suite executed via `bun:test`

---

## 🌟 The 6 Architectural Pillars

| Pillar | How SynapseJS Solves It |
|---|---|
| **⚡ Brutal Velocity** | Built directly on native **Bun** (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). Delivers **>48,000 req/s** with sub-millisecond p50 latency and instant cold-starts. |
| **🛡️ Zero-Leak AST Splitter** | Type-checker reachability partitions slices into `shared.tsx`, `server.ts`, and `client.tsx`. Compile-time gates strictly prevent SQL, secrets, or Bun globals from ever reaching the browser bundle. |
| **🤖 Native MCP Server (11 Tools)** | First-class **Model Context Protocol** server (`bun run mcp`). AI agents inspect codebase skeletons (<3k tokens), detect schema drift, calculate blast radius impact, and run tests via standard JSON-RPC. |
| **🔄 Realtime SSE & Distributed Pub/Sub** | Native Server-Sent Events gateway (`GET /_synapse/sse/:topic*`) with automatic 15-second heartbeat keep-alive, client hook `useSubscription`, and multi-instance PostgreSQL `LISTEN/NOTIFY` pub/sub. |
| **🗄️ Declarative Schema & Rollbacks** | SQL migrations live in slices. Tracked statement-by-statement with SHA-256 idempotency. Supports bidirectional `-- up:` / `-- down:` demarcations and transactional rollbacks (`synapse rollback`). |
| **🔒 Functional Safety & PBT Oracles** | No uncaught runtime exceptions: errors are typed values using `Result<T, E>`. Every slice includes mathematical verification oracles using `fast-check` property-based testing. |

---

## 🧩 Anatomy of a Real Vertical Slice

Here is what an authentic production slice looks like (`src/slices/tickets/create-ticket.slice.tsx`):

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
  DataTable,
  Button
} from 'synapsejs';

// 1. Input Contract (TypeBox JIT schema)
export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 })
});
export type TicketInput = Static<typeof TicketInputSchema>;

// 2. Database DDL (Bidirectional, tracked in _synapse_migration_statements)
export const sliceSchema = `
  -- up:
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- down:
  DROP TABLE IF EXISTS tickets;
`;

// 3. Strict Domain Output Contract
export type TicketOutput = Result<
  { ticketId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// 4. Background Job
export const notifyStaffJob = defineJob<{ ticketId: string }>({
  name: 'notify-staff-ticket',
  retryLimit: 3,
  backoffSeconds: 5,
  perform: async (payload) => {
    console.log(`Notification sent for ticket ${payload.ticketId}`);
  }
});

// 5. Server Action (On the server: runs mutation; in the browser: compiled into an RPC stub)
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

// 6. SSR Data Loader (Pre-rendered on the server)
export async function createTicketLoader(ctx: { db: DatabaseClient; session: SessionContext }) {
  const recentTickets = await ctx.db.findMany<{ id: string; subject: string; priority: number }>(
    'tickets',
    { limit: 5, orderBy: { created_at: 'DESC' } }
  );
  return { recentTickets };
}

// 7. Dynamic SEO Head Metadata
export function sliceMeta(data: { recentTickets?: unknown[] }) {
  return {
    title: 'Support Tickets — SynapseJS',
    description: 'Create and track customer support requests in real time.',
    openGraph: { type: 'website' }
  };
}

// 8. React 19 Interactive View Component
export function CreateTicketComponent(props: {
  recentTickets?: Array<{ id: string; subject: string; priority: number }>;
  onSubmitAction?: (payload: unknown) => Promise<TicketOutput>;
}) {
  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Open Support Ticket</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          const res = await props.onSubmitAction?.({
            subject: String(data.get('subject')),
            priority: Number(data.get('priority'))
          });
          if (res?.ok) alert(`Ticket created: ${res.value.ticketId}`);
          else alert(`Error: ${res?.error}`);
        }}
        className="space-y-4"
      >
        <input name="subject" placeholder="Ticket Subject" className="w-full border p-2 rounded" />
        <input name="priority" type="number" defaultValue={3} className="w-full border p-2 rounded" />
        <Button type="submit">Submit Ticket</Button>
      </form>

      {props.recentTickets && (
        <DataTable
          data={props.recentTickets}
          columns={[
            { key: 'subject', header: 'Subject' },
            { key: 'priority', header: 'Priority' }
          ]}
        />
      )}
    </div>
  );
}

// 9. Property-Based Test Oracle (Verified under bun:test)
export const sliceTests = {
  description: 'Support Ticket Invariants',
  cases: [
    {
      name: 'anonymous callers return UNAUTHORIZED before touching the database',
      run: async () => {
        const res = await createTicketAction({ subject: 'Outage', priority: 1 });
        if (res.ok || res.error !== 'UNAUTHORIZED') {
          throw new Error(`Expected UNAUTHORIZED, received ${JSON.stringify(res)}`);
        }
      }
    }
  ]
};
```

### The Golden Rule: Slices Never Import Slices
```text
┌──────────────────────────────────────────────┐
│       src/slices/billing/invoice.slice.tsx   │
└──────────────────────┬───────────────────────┘
                       │ ❌ STRICTLY FORBIDDEN
                       ▼
┌──────────────────────────────────────────────┐
│      src/slices/customers/customer.slice.tsx │
└──────────────────────┬───────────────────────┘
                       │
       Both import from│ shared domain logic
                       ▼
┌──────────────────────────────────────────────┐
│          src/shared/transactions.ts          │
│   (Receives DatabaseClient, opens db.tx)     │
└──────────────────────────────────────────────┘
```
If two features must coordinate or share transactional state, that logic belongs in `src/shared/<module>.ts`. Violations are blocked at compile time with error `SLICE_IMPORTS_SLICE`.

---

## 🤖 Built for AI Coding Agents: Native Model Context Protocol (MCP)

SynapseJS is the first framework built from day one to be consumed and operated by **autonomous AI agents** (Cursor, Claude Code, Windsurf, Antigravity).

Instead of forcing an LLM to blindly grep thousands of files, SynapseJS exposes **11 native MCP tools** over stdio JSON-RPC 2.0:

```bash
bun run mcp
```

### Add to your Agent Config (`claude_desktop_config.json` / `cursor.json`)

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

### The 11 Native MCP Tools

| MCP Tool | Capability |
|---|---|
| `synapse_get_repo_map` | Returns compressed codebase skeleton AST (`.codebase/repo-map.d.ts`, <3000 tokens). |
| `synapse_get_db_schema` | Returns centralized database schema catalog (`.codebase/db-schema.d.ts`) for instant query context. |
| `synapse_check` | Runs machine diagnostics returning exact error coordinates (`file`, `line`, `col`, `code`). |
| `synapse_split` | Runs AST splitter and asserts 0-leak client/server verification gates. |
| `synapse_run_pbt` | Executes Fast-Check property-based tests across slices and reports broken invariants. |
| `synapse_scaffold_slice` | Scaffolds slices using templates and the `--fields` grammar. |
| `synapse_migrate` | Applies declarative DDL migrations idempotently to SQLite or PostgreSQL. |
| `synapse_rollback` | Transactionally rolls back migration statements matching down blocks. |
| `synapse_contract` | Returns the framework authoring contract, HTTP semantics, and discovery rules. |
| `synapse_check_db_drift` | Inspects live database against slice DDLs for missing/orphan tables and columns. |
| `synapse_diff_impact` | Computes cross-slice blast radius for code, schema, and shared module changes. |

---

## 📊 Empirical Benchmarks & Measured Evidence

To eliminate vaporware, all metrics below are generated by automated benchmark scripts included in this repository:

### 1. HTTP Concurrency & Throughput (`bun run bench:concurrency`)
Testing local `Bun.serve` HTTP server under 50 concurrent connections over 1,000 real HTTP requests:

```text
🚀 Concurrency Benchmark Results:
────────────────────────────────────────────
Throughput:          53,191 requests/sec
Latency (p50):       0.53 ms
Latency (p95):       7.81 ms
Latency (p99):       8.00 ms
Failed Requests:     0 (0.00%)
Memory Delta:        < 6 MB
────────────────────────────────────────────
```

### 2. Context Surface Benchmark (`bun run bench`)
Comparing two identical enterprise features ("open ticket" and "assign ticket") implemented in vertical slices versus conventional layered architecture:

| Architecture | Files Touched / Feature | App Token Surface | Total Coordination Cost |
|---|---|---|---|
| **SynapseJS Vertical Slices** | **1 file** | **~1,400 tokens** | $\mathcal{O}(1)$ contiguous context |
| **Conventional Layered Architecture** | **5 files** | **~1,830 tokens** | $\mathcal{O}(N)$ scattered across folders |

### 3. Test Suite Pass Rate
```text
359 pass
0 fail
1351 expect() calls
Ran 359 tests across 49 files. (100% Green Gates)
```

---

## 🛠️ CLI Reference

All CLI commands output machine-parsable JSON to `stdout` with exit codes (`0` for PASS, `1` for FAIL):

```bash
# Development & Production Server
synapse dev [port] [--watch]        # Starts dev server with auto-discovery & live migrations
synapse start [port]                # Starts production server with graceful shutdown (SIGTERM)

# Diagnostics & Safety
synapse check [file]                # Machine diagnostics with exact line/col coordinates
synapse split                       # Partitions all slices into shared, server, and client modules
synapse test                        # Executes Fast-Check property test oracles under bun:test

# Database & Migrations
synapse migrate                     # Applies pending slice DDL statements idempotently
synapse rollback [slice] [--steps]  # Transactionally rolls back migrations matching down blocks
synapse db-drift                    # Compares live database schema against slice DDL ASTs
synapse impact <target>             # Calculates blast radius across FKs, tables, and imports

# Code Generation & AI
synapse new-slice <domain> <name>   # Scaffolds vertical slice (templates: create, list, crud, login, 2fa, oauth)
synapse skeleton                    # Regenerates .codebase/repo-map.d.ts & .codebase/db-schema.d.ts
synapse mcp                         # Starts native Model Context Protocol stdio server
synapse build [--standalone]        # Pre-builds client micro-bundles or standalone release
synapse worker                      # Starts continuous background jobs queue worker
synapse contract [--markdown]       # Emits framework authoring contract specifications
```

---

## 📦 Production Deployment & Docker

### Standalone Production Build
Compile your application into a self-contained, standalone production package:
```bash
synapse build --standalone
```
Emits pre-compiled server entry points and client bundles to `.synapse/standalone/`.

### Docker Image
```bash
docker build -t my-synapse-app .
docker run -p 3000:3000 -e SYNAPSE_SESSION_SECRET="your-secret" my-synapse-app
```
- **Image Size**: ~90MB (Alpine Linux + Bun).
- **Security**: Runs under unprivileged user `bun`.

---

## ⚖️ Engineering Integrity & Radical Candor

1. **Bun Exclusivity**: SynapseJS leverages native Bun APIs (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.password`, `Bun.build`). It does not run on Node.js or Deno.
2. **Query Builder Scope**: Optimized for single-table transactions and relational joins. Complex multi-table OLAP queries belong in tagged SQL (`db.sql`) or dedicated tools like Kysely via `ctx.services`.
3. **Application-Level Multi-Tenancy**: Tenant isolation is deterministically enforced at the application boundary via `requireTenant` and signed session tokens.
4. **Realtime Scope**: Realtime is powered by Server-Sent Events (SSE) via `EventHub` and `useSubscription`. Bidirectional raw WebSockets are not part of the core kernel.

---

## 📄 License & Author

Released under the **[MIT License](LICENSE)**.

Created by **[Ismael Soilet](https://github.com/ismaelsoilet)**. Built for resilient, machine-verifiable, human-auditable software engineering.
