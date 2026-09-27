# AGENTS.md — SynapseJS

Instructions for autonomous coding agents working **in this repository**.

For the framework's user-facing documentation see [`README.md`](./README.md) and
[`packages/synapse/README.md`](./packages/synapse/README.md).

---

## 1. What this repository is

A Bun-only fullstack framework built around one idea: **a feature is a single contiguous file**
(`*.slice.tsx`) holding its input contract, database DDL, server action, React UI and test oracle.
The surrounding tooling exists to keep that invariant usable by a machine: structured diagnostics,
AST-driven migrations, a compressed repo map, an MCP server and a gated client/server splitter.

Scale: ~3k LOC of framework, one example app, one starter template. It is not a platform.

## 2. Layout — where things actually are

```
packages/synapse/src/         framework source
  core/                       Result/Option, DatabaseClient, SQLite, Postgres, session, RPC client
  compiler/                   slice-discovery, migration-runner, scaffolder, splitter, repo-map, diagnostics
  runtime/server.ts           Bun.serve router + SSR shell + RPC dispatcher
  mcp/server.ts               MCP stdio server (5 tools)
packages/synapse/bin/synapse.ts   the CLI (single entry point)
packages/synapse/templates/starter/   the starter template that `synapse new` copies
packages/synapse/test/        bun:test suite (+ fixtures/ for splitter, oracle and bench fixtures)
examples/enterprise-crm/      reference app (3 slices + live e2e suite)
examples/helpdesk-slices/     2-slice app in another domain (tickets)
examples/helpdesk-conventional/  the same two features layered without the framework (adoption + benchmark comparator)
.synapse/                     generated output (gitignored): sqlite db, split artifacts, oracle wrappers
.codebase/                    generated repo map (committed, per app)
```

There is **no** root `src/` directory. Anything that references `src/slices` at the repo root is
stale — slice discovery resolves through `packages/synapse/src/compiler/slice-discovery.ts`.

## 3. Commands and their contracts

Every command prints **JSON on stdout** and sets the exit code. `stderr` is for unexpected
failures only, so a machine consumer can always parse stdout.

| Command | Success | What to read |
|---|---|---|
| `bun run lint` | exit 0 | Biome; 17 `noExplicitAny` warnings are accepted |
| `bun run test` | exit 0 | `bun test` output (framework suite) |
| `bun run check` | `{"status":"PASS","errorCount":0,...}` | `issues[]` with `{file,line,column,errorCode,message}` |
| `bun run skeleton` | `{"status":"PASS","totalModules":N,...}` | writes `.codebase/repo-map.d.ts`; `EMPTY_REPO_MAP` when nothing mapped |
| `bun run split` | `{"status":"PASS","slices":[{status,diagnostics,leaks}]}` | gates per slice, for both slice apps |
| `bun run test:slices` | `{"status":"PASS","totalCases":N,...}` | per-invariant results for the CRM example |
| `bun run test:helpdesk` | same shape | per-invariant results for the help-desk slice app |
| `bun run test:helpdesk-conventional` | exit 0 | the adoption app's own `bun test` suite |
| `bun run test:postgres` | `{"status":"PASS","checks":{...}}` | PostgreSQL parity; FAILs without `TEST_DATABASE_URL` |
| `bun run test:e2e` | exit 0 | live HTTP/SSR/RPC/RBAC integration |
| `bun run bench` | markdown table / `--json` | context surface per feature, both apps |
| `bun run mcp` | stdio JSON-RPC | targets `examples/enterprise-crm` via `--cwd` |
| `synapse worker` | continuous JSON log | background queue worker processing SQLite `.synapse/queue.sqlite` |

### Static files, CORS and logs

`public/` is served when it exists, and only `public/` — the path is normalized and refused if it
escapes the directory. Cross-origin is closed by default: `SYNAPSE_ALLOWED_ORIGINS` (comma separated,
or `*`) is the only way to get CORS headers, and the RPC endpoint requires
`Content-Type: application/json`, which a cross-origin HTML form cannot send. `SYNAPSE_LOG=json`
writes one JSON line per request (`formatLogLine`). `synapse dev --watch` restarts on file changes.

### Evolving a schema

`sliceSchema` is applied **statement by statement**, and each statement is recorded once in
`_synapse_migration_statements`. Editing the DDL applies only what is new, so an `ALTER TABLE`
runs exactly once even though the slice text changes:

```ts
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS customers (...);
  ALTER TABLE customers ADD COLUMN phone TEXT;   -- runs once, never again
`;
```

A statement that fails is **not** recorded and the report is `FAIL` with its error, so fixing it
and running again works; nothing fails silently. Caveat for existing databases: the first
`migrate` after this change re-executes every statement once, because the previous tracking only
stored a hash per slice. Idempotent DDL (`CREATE ... IF NOT EXISTS`) is unaffected; a
non-idempotent statement that the old runner had already applied will fail once, loudly.

### Failure codes you must handle

Discovery never silently succeeds. When nothing was verified, the command **fails**:

- `NO_SLICES_DIR` — no `src/slices` found; `candidates[]` lists every path examined.
- `AMBIGUOUS_SLICES_DIR` — several workspace members own slices; set `SYNAPSE_ROOT` or run inside the target app.
- `TARGET_FILE_NOT_FOUND` — `synapse check <file>` matched nothing.
- `UNKNOWN_FLAG` — an unrecognised flag was passed.
- `REPO_MAP_MISSING` — MCP `synapse_get_repo_map` before `synapse skeleton`.
- `SLICE_EXISTS` / `WRITE_FAILED` — scaffolder outcomes (`Err` values, never thrown).

An empty successful result is a bug. If you see `PASS` with `totalSlices: 0`, report it.

## 4. The slice contract (N = 1)

One file per feature, at `<app>/src/slices/<domain>/<name>.slice.tsx`, exporting:

1. `<Name>InputSchema` — TypeBox contract, validated with `Value.Check`.
2. `sliceSchema` — DDL string; discovered by AST, hashed, applied idempotently.
3. `<Output>` — `Result<T, 'ERROR_A' | 'ERROR_B'>`, no throwing.
4. `<name>Action(payload, db?, session?)` — `db` **optional** so the same call site is valid on the
   server (which injects the connection) and on the client (where the call becomes an RPC stub).
   Authorize with `requireAuth(session, ['role'])` and return `Err(auth.error)`.
5. `<Name>Trigger|View|Form|Component` — React UI. It receives the query string plus whatever the
   slice's loader returned; nothing is injected by the framework.
6. `<Name>Loader(context)` — **optional** server-side data for the component, called on every SSR
   request with `{ url, params, db, session }`. This is how a page shows real rows instead of demo
   props; a loader that throws is rendered in the page and logged, never swallowed.
7. `sliceTests` — invariants, as named cases: `{ description, cases: [{ name, run }] }`. `run()` alone
   still works and is reported as a single case. The runner registers each case with `bun:test` from a
   generated wrapper under `.synapse/oracles/`, so slices never import a test library.
8. `<Name>Webhook(event, ctx)` — **optional** endpoint at `POST /_synapse/webhooks/<domain>/<name>`,
   preserving `event.rawBody: Uint8Array` for HMAC signature validation (e.g. Stripe, GitHub) and parsed JSON.
9. `defineJob<TPayload>({ name, perform, retryLimit, backoffSeconds })` — **optional** background job contract,
   enqueued with `ctx.enqueue(job, payload)` and processed continuously by `synapse worker`.
10. `_layout.tsx` — **optional** root layout at `src/slices/_layout.tsx`, wrapping SSR slice components.
    Turbo Morphing SPA router (`/_synapse/turbo-router.js`) provides seamless client-side navigation.

`sliceTests` is test-only: the splitter drops it and `fast-check` from both runtime bundles.
A property that generates floats must pass `noNaN: true` (and `noDefaultInfinity: true`) to
`fc.double`: a NaN the schema rejects becomes a failing property that reports nothing wrong with the
code — the exact flake `generate-invoice` had.

### Authoring a slice without guessing

`synapse contract` prints the whole authoring contract as JSON (the MCP tool `synapse_contract` does
the same), and `synapse new-slice <domain> <name> --template=list|update|delete|crud` emits the shape
instead of leaving it to be invented: `list` paginates with a parameterized filter, `update` is
partial and builds its SET clause from a column allowlist, `delete` checks existence first. The
suffix rules live in `runtime/discovery-rules.ts`, read by the runtime, the splitter and the
contract, so the description cannot drift from behavior.

**A slice never imports another slice.** `SLICE_IMPORTS_SLICE` fails the split when it happens,
transitively, and points at `src/shared/`: a plain module that receives the `DatabaseClient` by
parameter and opens `db.transaction` itself. A shared module may throw; the action that calls it
turns the failure into `Err`, so the no-throw contract of an action survives a transaction. The mock
database does not roll back — atomicity is proven against a real engine, never with the mock.

Slice endpoints are addressed by `<domain>/<name>`: `POST /_synapse/rpc/tickets/create-ticket`. A bare
slice name still works while it is unique across domains; when two domains own the same name the
dispatcher answers **409** listing them instead of guessing. A slice that fails to import never
disappears silently — it is listed in `/_synapse/api/health` under `loadErrors` and shown on the hub.

**Sessions come from any one of three headers:** `Authorization: Bearer <token>`, `x-user-id` or
`x-user-roles`. A request carrying none of them is anonymous. With `SYNAPSE_SESSION_SECRET` set, a
bearer token must be a signed session (`signSessionToken` / `verifySessionToken`) and its claims win:
the role headers are ignored, so they stop being forgeable. Without the secret the header behaviour
above is what applies — convenient locally, not safe in production, and said out loud here. The browser path is the cookie one: the
SSR shell reads `synapse_token` and `synapse_roles` and forwards them as those headers, so
`document.cookie = 'synapse_roles=sales'` is enough to exercise a role-protected screen during
development — and nothing more than that. There is no login flow; a real deployment puts a signed
session behind the same headers.

## 5. The splitter contract

`synapse split` partitions each slice by **reachability resolved through the type checker**:

- `shared.tsx` — type contracts (erased at runtime) plus any value they reference (`typeof Schema`).
- `server.ts` — database access, DDL, action bodies.
- `client.tsx` — React UI plus an RPC stub (`rpcCall`) for any action the UI calls directly.

Two gates decide PASS/FAIL, and both must be green before you claim the split works:

1. **Compilation** — the three emitted modules are typechecked under the project's own tsconfig.
2. **No leak** — the client module must not contain SQL, `db.query`, `sliceSchema`, `process.env`
   or `Bun.`. Type-only references to `DatabaseClient` are allowed (they are erased).

A server action referenced by a component contributes **only its wire signature** to the client
(payload + return type) — never its body.

## 6. Working rules for this repo

- **No claim without a green test.** `README.md` and `synapse info` list every feature with
  `status` (`stable` | `experimental` | `roadmap`) and `evidence`. Do not promote a feature to
  `stable` without a test that fails when the feature breaks. Do not add a claim you cannot point
  at a test for.
- **Tests live in `packages/synapse/test/`** (`bun:test`). Run them with `bun test packages/synapse/test`.
  Slice-level oracles are executed by `synapse test`, not by `bun test`.
- **Never synthesise module imports** in generated code — pass the source's own imports through.
  The one exception is the splitter's `rpcCall`, which belongs to the stub it generates.
- **Iterate local shell only after reading.** Every change here must keep `bun run check`,
  `bun test packages/synapse/test` and `bun run split` green.
- Deliberately broken fixtures live in `packages/synapse/test/fixtures/` and are excluded from the
  project typecheck on purpose (they exercise the splitter's failure gates).
- Machine-readable JSON uses English field names; human-readable `message` strings are pt-BR. Keep it that way.
- PT-BR appears in UI copy and console output. Code identifiers and JSON keys stay English.

## 7. What does NOT exist (do not assume it)

- No incremental diagnostics daemon. `check --fast` was removed: measured **slower** than the full
  check (2.5s vs 1.9s) because the `.tsbuildinfo` cache was never read back across processes.
- No production bundling of the *whole app* into one artifact: `synapse build` pre-builds one browser
  bundle per slice (plus `.synapse/client/manifest.json`), which is what a deploy serves. There is no
  asset hashing or CDN story beyond that.
- No auth/login flow in the framework itself. RBAC is enforced and the signed-token primitive is
  shipped, but the login is a slice: `synapse new-slice auth login --template=login` emits one that
  verifies with `Bun.password.verify`, signs with `signSessionToken` and returns the token, which the
  browser stores with `storeSession(token, roles)` and clears with `clearSession()` (both from the
  package, both touching only `document.cookie`). The generated oracle proves the token the action
  issues is accepted by `verifySessionToken`, the same function the server uses — `apps/crm` carries a
  generated copy. Credentials otherwise come from `Authorization`/`x-user-id`/`x-user-roles` headers
  (or the `synapse_token` / `synapse_roles` cookies the browser shell forwards).
- **CI runs on push** (`.github/workflows/ci.yml`, three jobs: suite, PostgreSQL parity, publish
  rehearsal). The first real execution is green; before it, every result in this repo had been
  produced locally by hand.
- **The release workflow has never executed.** `release.yml` fires on a `v*` tag, and no tag has been
  pushed, so `npm publish` has never run — that is the remaining unknown of the release path.
- **Lint and format are enforced** (`bun run lint`, Biome pinned to `2.5.14` at the repo root — a
  floating `@latest` turned an unrelated release into a red gate mid-session, so the version is part
  of the build now). 21 warnings are accepted: 19 `noExplicitAny` for the dynamic boundaries
  (postgres.js options, MCP params, JSON-RPC payloads, the SQL boundary) plus 2 `noUnusedImports`
  that are a Biome 2.5.14 false positive (a `type` specifier inside a mixed import that the typecheck
  proves is used — `Cannot find name 'Static'` when removed), silenced in place with a
  `biome-ignore` that states the reason. `useNodejsImportProtocol` is
  off on purpose: bare specifiers are the documented form in a Bun-only framework.
- The generated `.codebase/repo-map.d.ts` is a **signature digest, not compilable TypeScript**: it has
  no imports and the same name (`sliceSchema`, `<Name>InputSchema`) repeats across modules. Its own
  header says so.
- No CI for publishing. `packages/synapse` ships TS source (`main: src/index.ts`) and requires Bun.

## 8. Verifying a change

```bash
bun install
bun run lint                        # Biome: 0 errors, 17 accepted `any` warnings
bun test packages/synapse/test      # framework suite
bun run check                       # whole monorepo typecheck
bun run check:template              # the starter template typechecks as a consumer
bun run skeleton                    # regenerate the repo map
bun run split                       # splitter + both gates, for both slice apps
bun run test:all                    # framework suite + oracles of both apps + adoption app + live e2e
bun run bench                       # context surface of the same two features, both stacks
TEST_DATABASE_URL=postgres://... bun run test:postgres   # parity against a real PostgreSQL
```

If you touched discovery, migrations, the scaffolder or the splitter, also run the negative cases:
a directory with no slices must produce `FAIL`/`NO_SLICES_DIR`, and
`packages/synapse/test/fixtures/slices/reports/leaky-report.slice.tsx` must trip the leak gate.

## 9. Versioning and compatibility

- **0.x:** a minor bump may break. Every break is listed in `CHANGELOG.md`; nothing has been
  published to npm yet, so no external contract exists.
- **1.0 will freeze three surfaces:** the CLI command names and their JSON field names, the slice
  contract exports (`<Name>InputSchema`, `sliceSchema`, `<name>Action`, `<Name>Trigger|View|Form|Component`,
  `sliceTests` with named cases), and the package entry exports asserted by
  `packages/synapse/test/machine-types.test.ts` (the "public contract" block).
- Removing a public export requires one minor release of deprecation first.
- Publishing happens only through `.github/workflows/release.yml`, on a `v*` tag whose version matches
  `packages/synapse/package.json`. The pipeline runs every gate plus the publish rehearsal before
  `npm publish`.
