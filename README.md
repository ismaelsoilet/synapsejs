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
  <a href="packages/synapse/test"><img src="https://img.shields.io/badge/Tests-388%20Passing%20(100%25)-emerald?style=for-the-badge&logo=checkmarx" alt="388 Tests Passing"></a>
  <a href="src/mcp"><img src="https://img.shields.io/badge/MCP%20Server-15%20Native%20Tools%20(11+4)-purple?style=for-the-badge&logo=anthropic" alt="MCP Server: 15 Native Tools"></a>
  <a href="https://github.com/ismaelsoilet/jev-harness"><img src="https://img.shields.io/badge/System%201-Jev%20Harness%20Active-brightgreen?style=for-the-badge&logo=shield" alt="Jev System One"></a>
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

An AST-driven **Isomorphic Splitter** separates server code (SQL, credentials, actions) from client code (React, RPC stubs) at build time with **compiler-enforced AST isolation and automated leak verification gates**.

---

## 🚀 30-Second Quickstart

Get a production-grade SynapseJS application running in less than 30 seconds:

```bash
# 1. Scaffold a new application
bunx @ismaelsoilet/synapsejs new my-saas-app

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

## 🌟 The 7 Architectural Pillars

| Pillar | How SynapseJS Solves It |
|---|---|
| **⚡ High-Throughput Engine** | Built directly on native **Bun** (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). Delivers **53,191 req/s** baseline HTTP routing with sub-millisecond p50 latency under high concurrency. |
| **🛡️ AST Isolation & Leak Gates** | Type-checker reachability partitions slices into `shared.tsx`, `server.ts`, and `client.tsx`. Automated compiler verification gates detect and block SQL, secrets, server modules, or Bun globals from reaching the browser bundle. |
| **🤖 Native MCP Server (15 Tools)** | First-class **Model Context Protocol** server (`bun run mcp`) exposing 15 native tools (11 core System 2 architectural tools + 4 Jev System 1 reflex triage tools). AI agents inspect codebase skeletons (<3k tokens), detect schema drift, calculate blast radius impact, run tests via standard JSON-RPC, and invoke semantic gates (`synapse_test_gate`, `synapse_abort_check`, `synapse_verify_completion`, `synapse_reasoning_effort`). |
| **🧠 System 1 + System 2 Symbiosis** | Native integration with [Jev System One](https://github.com/ismaelsoilet/jev-harness) non-autoregressive decision harness. Triages test failures in 70-300ms (<500µs local), halts circular refactoring doom loops, and dynamically modulates reasoning effort (Astra-Jev). |
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
  defineAction,
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

// 5. Server Action (Fail-Closed by default, automatic TypeBox validation & RPC stub compilation)
export const createTicketAction = defineAction({
  input: TicketInputSchema,
  auth: ['support'], // Fail-Closed: requires authenticated session with 'support' role. Use auth: 'public' for open endpoints.
  handler: async ({ input, db, session }): Promise<TicketOutput> => {
    if (!db) return Err('NO_DATABASE');
    const ticketId = crypto.randomUUID();

    await db.query(
      `INSERT INTO tickets (id, subject, priority, status) VALUES ($1, $2, $3, 'OPEN')`,
      [ticketId, input.subject, input.priority]
    );

    return Ok({ ticketId });
  }
});

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

## 🧠 Dual Cognitive Architecture: SynapseJS + Jev System One

Software engineering with autonomous AI coding agents (Claude, Cursor, Windsurf, Antigravity) faces two systemic pitfalls:
1. **System 2 Structural Friction:** Layered architectures scatter code across 5 to 7 directories, forcing agents to burn 15,000+ context tokens on hallucinated imports and cross-file coordination. SynapseJS eliminates this with **Locality of Behavior ($N = 1$)** and contiguous vertical slices (`*.slice.tsx`).
2. **System 1 Cognitive Waste:** When an agent encounters a transient environment failure, missing dependency, or trivial syntax issue, standard autoregressive LLMs waste tens of thousands of tokens in circular "deep thought" loops trying to refactor already-working business logic.

SynapseJS pairs natively with **[Jev System One](https://github.com/ismaelsoilet/jev-harness)** to provide the industry's first dual-cognitive framework for AI-assisted engineering:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT / CODING LLM                              │
└───────────────────▲────────────────────────────────▲───────────────────┘
                    │                                │
       [Reflex Decisions & Gating]         [Execution & Locality N=1]
                    │                                │
┌───────────────────┴────────────────┐  ┌────────────┴───────────────────┐
│        JEV-HARNESS                 │  │          SYNAPSEJS             │
│        (System 1 Reflex)           │  │          (System 2 Structure)  │
├────────────────────────────────────┤  ├────────────────────────────────┤
│ • Semantic decisions in 70-300ms   │  │ • Locality of Behavior (N = 1) │
│ • Local heuristics (< 500µs)       │  │ • Vertical slices (*.slice.tsx)│
│ • Non-autoregressive test-gate     │  │ • Fast-Check PBT oracles       │
│ • Circular loop abort-check        │  │ • Zero-Leak AST Splitter       │
│ • Astra-Jev reasoning modulation   │  │ • Native MCP Server (15 tools) │
│ • Zero-token waste on env failures │  │ • Slices DDL & auto migrations │
└────────────────────────────────────┘  └────────────────────────────────┘
```

### ⚡ Non-Autoregressive Test Gating (`synapse test --gate`)

When executing property test oracles, the `--gate` flag (or presence of `.jev.json`) triggers immediate non-autoregressive triage:

```bash
# Run slice oracles with Jev System One semantic triage
bun run synapse test --gate
```

If a test fails due to environment or missing dependencies, Jev System One flags `skipLlm = true` with high confidence ($>0.85$), prescribing deterministic fixes (e.g. `bun install`) without wasting tens of thousands of LLM reasoning tokens:

```json
{
  "operation": "PBT_ORACLE_TEST_SUITE",
  "status": "FAIL",
  "triage": {
    "category": "env_missing",
    "confidence": 1.0,
    "skipLlm": true,
    "skipLlmProb": 0.86,
    "severityScore": 0.73,
    "actionRecommendation": "AUTO-ACTION: Install missing dependency or check environment configuration (Do NOT call LLM)."
  }
}
```

### 🛡️ Zero-Config Offline Fallback
When no remote Jev endpoint or API key is configured, Jev-Harness seamlessly falls back to **sub-millisecond local deterministic heuristics (<500µs)**, guaranteeing that your local builds, Git pre-commit hooks, and CI/CD pipelines never stall or fail.

📖 *For complete architectural specifications, Astra-Jev reasoning modulation, and provider configurations, see [docs/jev-integration.md](docs/jev-integration.md).*

---

## 🤖 Built for AI Coding Agents: Native Model Context Protocol (MCP)

SynapseJS is the first framework built from day one to be consumed and operated by **autonomous AI agents** (Cursor, Claude Code, Windsurf, Antigravity).

Instead of forcing an LLM to blindly grep thousands of files, SynapseJS exposes **15 native MCP tools** over stdio JSON-RPC 2.0:

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

### The 15 Native MCP Tools

| MCP Tool | Domain | Capability |
|---|---|---|
| `synapse_get_repo_map` | System 2 | Returns compressed codebase skeleton AST (`.codebase/repo-map.d.ts`, <3000 tokens). |
| `synapse_get_db_schema` | System 2 | Returns centralized database schema catalog (`.codebase/db-schema.d.ts`) for instant query context. |
| `synapse_check` | System 2 | Runs machine diagnostics returning exact error coordinates (`file`, `line`, `col`, `code`). |
| `synapse_split` | System 2 | Runs AST splitter and asserts 0-leak client/server verification gates. |
| `synapse_run_pbt` | System 2 | Executes Fast-Check property-based tests across slices and reports broken invariants. |
| `synapse_scaffold_slice` | System 2 | Scaffolds slices using templates and the `--fields` grammar. |
| `synapse_migrate` | System 2 | Applies declarative DDL migrations idempotently to SQLite or PostgreSQL. |
| `synapse_rollback` | System 2 | Transactionally rolls back migration statements matching down blocks. |
| `synapse_contract` | System 2 | Returns the framework authoring contract, HTTP semantics, and discovery rules. |
| `synapse_check_db_drift` | System 2 | Inspects live database against slice DDLs for missing/orphan tables and columns. |
| `synapse_diff_impact` | System 2 | Computes cross-slice blast radius for code, schema, and shared module changes. |
| `synapse_test_gate` | **System 1 (Jev)** | Executes PBT oracles and immediately triages failures with non-autoregressive gating to prevent LLM token waste. |
| `synapse_abort_check` | **System 1 (Jev)** | Evaluates proposed plans and error history to detect circular refactoring loops and doomed trajectories. |
| `synapse_verify_completion` | **System 1 (Jev)** | Adversarially verifies slice implementation and test outputs against acceptance criteria before committing. |
| `synapse_reasoning_effort` | **System 1 (Jev)** | Dynamically modulates agent reasoning effort (Astra-Jev) to low/medium/high to conserve tokens during mechanical tasks. |

---

## 📊 Empirical Benchmarks & Measured Evidence

To eliminate vaporware, all metrics below are generated by automated benchmark scripts included in this repository:

### 1. HTTP Concurrency & Baseline Routing (`bun run bench:concurrency`)
Testing local `Bun.serve` HTTP server baseline routing (`/_synapse/api/health`) under 50 concurrent connections over 1,000 real HTTP requests:

```text
🚀 Concurrency Benchmark Results (Baseline HTTP Routing):
────────────────────────────────────────────
Throughput:          53,191 requests/sec
Latency (p50):       0.53 ms
Latency (p95):       7.81 ms
Latency (p99):       8.00 ms
Failed Requests:     0 (0.00%)
Memory Delta:        < 6 MB
────────────────────────────────────────────
```
*Note: For fullstack end-to-end benchmarks exercising React 19 SSR, TypeBox input validation, and real SQLite mutations under concurrency, run `bun run bench:production`.*

### 2. Context Surface Benchmark (`bun run bench`)
Comparing two identical enterprise features ("open ticket" and "assign ticket") implemented in vertical slices versus conventional layered architecture:

| Architecture | Files Touched / Feature | App Token Surface | Total Coordination Cost |
|---|---|---|---|
| **SynapseJS Vertical Slices** | **1 file** | **~1,400 tokens** | $\mathcal{O}(1)$ contiguous context |
| **Conventional Layered Architecture** | **5 files** | **~1,830 tokens** | $\mathcal{O}(N)$ scattered across folders |

### 3. Test Suite Pass Rate
```text
388 pass
0 fail
1452 expect() calls
Ran 388 tests across 54 files. (100% Green Gates)
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
synapse test [--gate]               # Executes Fast-Check property test oracles (with optional Jev System 1 gating)

# Database & Migrations
synapse migrate                     # Applies pending slice DDL statements idempotently
synapse rollback [slice] [--steps]  # Transactionally rolls back migrations matching down blocks
synapse db-drift                    # Compares live database schema against slice DDL ASTs
synapse impact <target>             # Calculates blast radius across FKs, tables, and imports

# Code Generation & AI
synapse new-slice <domain> <name>   # Scaffolds vertical slice (templates: create, list, crud, login, 2fa, oauth)
synapse skeleton                    # Regenerates .codebase/repo-map.d.ts & .codebase/db-schema.d.ts
synapse mcp                         # Starts native Model Context Protocol stdio server (15 tools incl. Jev System 1)
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
3. **Application-Level Multi-Tenancy**: Tenant isolation is deterministically enforced at the application boundary via `requireTenant` and signed session tokens. For PostgreSQL deployments with strict database-level isolation, Row Level Security (RLS) policies are recommended.
4. **Realtime Scope**: Realtime is powered by Server-Sent Events (SSE) via `EventHub` and `useSubscription`. Bidirectional raw WebSockets are not part of the core kernel.
5. **Fail-Closed Security by Default**: Actions created with `defineAction` reject unauthenticated callers by default (`UNAUTHORIZED`). Open endpoints must explicitly declare `auth: 'public'`. The server runtime includes CORS origin filtering, CSRF protection, and HMAC-signed session cookie validation (`SYNAPSE_SESSION_SECRET`).
6. **Declarative Migration DAG**: Slice table dependencies and foreign keys are parsed into an acyclic dependency graph (`orderSlicesByDag`) to ensure parents are created before child tables. Incremental schema alterations across running production databases should be sequenced as declarative migration statements.

---

## 📄 License & Author

Released under the **[MIT License](LICENSE)**.

Created by **[Ismael Soilet](https://github.com/ismaelsoilet)**. Built for resilient, machine-verifiable, human-auditable software engineering.
