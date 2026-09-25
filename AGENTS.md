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
packages/synapse/test/        bun:test suite (+ fixtures/ for splitter fixtures)
examples/enterprise-crm/      the reference app (3 slices + live e2e suite)
.synapse/                     generated output (gitignored): sqlite db, split artifacts
.codebase/                    generated repo map (committed, per app)
```

There is **no** root `src/` directory. Anything that references `src/slices` at the repo root is
stale — slice discovery resolves through `packages/synapse/src/compiler/slice-discovery.ts`.

## 3. Commands and their contracts

Every command prints **JSON on stdout** and sets the exit code. `stderr` is for unexpected
failures only, so a machine consumer can always parse stdout.

| Command | Success | What to read |
|---|---|---|
| `bun run test` | exit 0 | `bun test` output (framework suite) |
| `bun run check` | `{"status":"PASS","errorCount":0,...}` | `issues[]` with `{file,line,column,errorCode,message}` |
| `bun run skeleton` | `{"status":"PASS","totalSlices":N,...}` | writes `.codebase/repo-map.d.ts` |
| `bun run split` | `{"status":"PASS","slices":[{status,diagnostics,leaks}]}` | gates per slice |
| `bun run test:slices` | `{"status":"PASS","totalSlices":N,"results":[...]}` | per-slice oracle output |
| `bun run test:e2e` | exit 0 | live HTTP/SSR/RPC/RBAC integration |
| `bun run mcp` | stdio JSON-RPC | targets `examples/enterprise-crm` via `--cwd` |

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
5. `<Name>Trigger|View|Form|Component` — React UI.
6. `sliceTests` — invariants. Assert real domain behaviour, not the TypeBox library.

`sliceTests` is test-only: the splitter drops it and `fast-check` from both runtime bundles.

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
- No PostgreSQL test coverage. The client exists; parity is unverified.
- No production bundling step. `split` emits modules; feeding `Bun.build` is on the roadmap.
- No auth/login flow in the example. RBAC is enforced, but credentials come from
  `Authorization`/`x-user-id`/`x-user-roles` headers (or the `synapse_token` / `synapse_roles`
  cookies the browser shell forwards).
- No CI for publishing. `packages/synapse` ships TS source (`main: src/index.ts`) and requires Bun.

## 8. Verifying a change

```bash
bun install
bun test packages/synapse/test      # framework suite
bun run check                       # whole monorepo typecheck
bun run check:template              # the starter template typechecks as a consumer
bun run skeleton                    # regenerate the repo map
bun run split                       # splitter + both gates
bun run test:all                    # framework suite + slice oracles + live e2e
```

If you touched discovery, migrations, the scaffolder or the splitter, also run the negative cases:
a directory with no slices must produce `FAIL`/`NO_SLICES_DIR`, and
`packages/synapse/test/fixtures/slices/reports/leaky-report.slice.tsx` must trip the leak gate.
