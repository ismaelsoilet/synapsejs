# Proposal

## Why

A SureForge audit of this repository against five criteria — framework quality, real usage,
honest wins/losses, urgent improvements, production readiness — found that the *engineering
foundation is genuinely strong* while the *hardening layer and the evidence layer are largely
absent or false*. The gates are reproducibly green (427/427 tests, 0 typecheck errors, 10/10
slices split with zero leaks), yet the audit found:

- **Zero security response headers** anywhere in the repository — no CSP, no `nosniff`, no
  frame-ancestors, no Referrer-Policy — on any response, including `public/` static files and
  the SSR 500 page.
- **A default-on third-party JavaScript CDN** (`cdn.tailwindcss.com`, no SRI, no CSP) injected
  into every SSR page, executed in an origin that holds a JS-readable session cookie.
- **Three write/serve paths with no authorization**: the SSE gateway accepts any topic from any
  caller; the WebSocket origin allowlist is fail-*open* when `SYNAPSE_ALLOWED_ORIGINS` is unset;
  webhooks have no secret, no signature verification and no replay window.
- **A path traversal in the scaffolder** (`scaffoldSlice`/`scaffoldShared`) reachable from the
  CLI and from an MCP tool: a `.slice.tsx` planted in any sibling app's `src/slices/` is
  dynamically imported, its DDL auto-migrated, its jobs registered, and its actions exposed as
  RPC on that app's next boot. This is a prompt-injection escalation primitive for exactly the
  autonomous-agent workflow this framework is built for.
- **An OAuth template that links a GitHub identity to a pre-existing local user by
  unverified email and inherits that user's roles** into a signed session, with no CSRF
  `state`, and with the vulnerable region (`:1207-1252`) covered by zero tests.
- **A multipart upload path that is the only body reader in the framework without a size
  ceiling**, because `?? ''` yields `0` where the RPC/webhook paths use a `NaN` idiom.
- **Six documentation claims that are factually false**, three different test counts across
  three documents, a hardcoded `1.6.0` in the machine-readable `info` surface, a documented MCP
  tool name that is not registered, and a `stable` rating for a multipart guard that no test
  exercises. `AGENTS.md` §7 still states the release workflow has never run and nothing has
  been published, while 6 versions ship on npm and 43 CI runs are green.

The repo's own rule — *"Do not promote a feature to `stable` without a test that fails when the
feature breaks"* (`AGENTS.md` §6) — is written and then not applied: `synapse info` reports
36 of 37 features `stable` on a five-day-old, zero-star, zero-adopter project, and 8 of 50
claimed features have no behavioural test at all, two of which are stubs or absent.

Why now: the framework is published and installs from npm, so the cost of these defects
compounds with every adopter. Fixing the claims and the hardening is far cheaper now than after
a first real deployment.

## What Changes

**Security hardening (the priority):**

- Emit a baseline security header set on every response — `Content-Security-Policy`,
  `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` — with a
  strict default CSP that the documented Tailwind-via-CDN path can be reconciled against.
- Make the third-party CDN **opt-in** (`SYNAPSE_DISABLE_CDN` inverts to an explicit opt-in),
  and document the token-exposure consequence of the JS-readable cookie.
- Make the WebSocket origin check **fail-closed**; make the SSE gateway authorize subscribers
  and namespace topics per tenant; bound topic growth.
- Make `Secure`/`HttpOnly`/`SameSite=Lax` the **defaults** of `serializeCookie`, not opt-ins.
- Derive tenant identity **only** from a cryptographically verified token when
  `SYNAPSE_SESSION_SECRET` is set; stop falling back to `x-tenant-id`.
- Consult the session-revocation store at request time, and bound both the in-memory and
  persisted revocation sets (TTL / cap).
- Stop emitting `Cache-Control: public` for user-scoped SSR HTML; add `Vary`.
- Mask internal error messages in production on **all** paths, not just SSR; redact absolute
  paths and `DATABASE_URL` credentials from `/api/health`, CLI stderr and MCP error output.
- Bound and authenticate `/_synapse/images/optimize` (auth, rate limit, body cap, timeout,
  non-`undefined` domain allowlist); sign the S3 adapter's `delete()`; pin the SSRF-validated IP
  or stop claiming DNS-rebinding protection.
- Implement real in-flight request draining on shutdown (today: a capped 200 ms sleep), and
  close the gap between the advertised `drainTimeoutMs` and the behaviour.

**Containment of write paths:**

- Introduce one reusable path-segment validator in `core/` and apply it to the scaffolder
  (`domain`, `sliceName`, and shared-module `name`) and the multipart upload branch — retiring
  the class of "the guard exists on a sibling path and was not applied here", not just the two
  symptoms.

**Correctness of the OAuth template:**

- Add CSRF `state` generation and validation, require a *verified* email, stop inheriting roles
  from a linked local row, replace `Math.random()` identifiers with `crypto.randomUUID()`, and
  wire the generated UI to the action so the template can actually complete a login.

**Evidence and honesty:**

- Establish a single source of truth for version, test count, tool count and feature status, and
  derive `synapse info`, the README badges and `AGENTS.md` from it — or delete the false claims.
- Reclassify features that are stubs, untested or contradicted by their own code out of
  `stable`; remove the "Drizzle/Kysely compatible" and "DNS rebinding" claims.
- Reconcile the machine-readable contract (`contract.ts`) with the upload implementation, and
  the module docstring with both.
- Make the throughput and context-surface benchmarks measure real work (the concurrency bench
  currently runs a server with **zero** discovered slices against a static JSON endpoint), and
  remove or restate the `10.7x / 4,000+ req/s` claim that script cannot reproduce.
- Move the only real HTTP→SSR→RPC→DB roundtrip from a loose script into `bun:test`; add real
  coverage for the three untested client hooks, the PostgreSQL client and the PostgreSQL queue
  (the CI Postgres service already exists); add a coverage threshold; delete the tests that
  verify a test double or a third-party package.
- Add committed slices that actually exercise webhook, job, socket, `defineCache`, `sliceMeta`
  and `-- down:` blocks, so `synapse rollback` and the contract's optional items stop being
  undocumented in practice.

**Supply chain and CI:**

- `bun install --frozen-lockfile` in CI; pin third-party actions to commit SHAs; remove the
  unpinned `bunx jev-harness` invocation from the pull-request failure path; make the release
  workflow's credential story match its own comments; fix the scaffolder's `^1.1.1` template
  pin that silently installs a seven-minor-old framework into every new project.

**Breaking changes:** the third-party CDN becomes opt-in; `serializeCookie` defaults change;
the WebSocket upgrade is rejected when no origin allowlist is configured; SSE subscription
requires authentication. Each needs a migration note in `CHANGELOG.md`.

## Capabilities

### New Capabilities

- `http-response-hardening`: baseline security response headers on every response, CSP
  policy, third-party CDN opt-in, production error masking across all paths, redaction of
  filesystem paths and credentials from diagnostic surfaces.
- `realtime-access-control`: authenticated and tenant-namespaced SSE subscription, bounded
  topic registry, fail-closed WebSocket origin validation, RFC 6585 rate-limit parity between
  the two transports.
- `abuse-resistance`: spoof-resistant client-IP resolution, per-process scope explicitly
  declared, uncovered routes brought under the limiter, and a size ceiling on **every** body
  reader including multipart uploads.
- `session-integrity`: secure cookie defaults, tenant derived only from verified claims,
  request-time revocation with bounded storage, and fail-closed behaviour when
  `NODE_ENV=production` is set without a session secret.
- `write-path-containment`: one reusable path-segment validator applied to the scaffolder and
  the upload parser, closing traversal on the CLI and MCP write surfaces.
- `oauth-account-linking`: CSRF `state` round-trip, verified-email requirement, no role
  inheritance across identity link, CSPRNG identifiers, and a generated UI that completes the
  flow.
- `graceful-shutdown`: real in-flight request accounting and draining on `stop()`.
- `claim-integrity`: single-source-of-truth metadata (version, test count, tool count, feature
  status) for `synapse info`, README badges and `AGENTS.md`; removal of claims contradicted by
  code; benchmarks that measure the work they claim to measure.
- `verification-coverage`: real engine roundtrips inside `bun:test`, coverage thresholds for the
  browser hooks and the PostgreSQL adapters, and removal of tests that assert a test double or
  a third-party package.
- `feature-exercise-fixtures`: committed slices that exercise the optional contract items, so
  rollback, webhooks, jobs, sockets, ISR and SEO metadata are demonstrated rather than asserted.
- `supply-chain-and-ci`: reproducible installs, SHA-pinned actions, no unpinned execution on the
  pull-request path, and a template dependency pin that matches the published version.

### Modified Capabilities

None. `openspec/specs/` is empty; this repository has no prior spec baseline, so every
capability below is introduced new. (The behavioural contracts these deltas describe *do*
contradict statements in `AGENTS.md`, `README.md`, `CHANGELOG.md` and
`packages/synapse/src/compiler/contract.ts`; those files are updated as part of the
implementation of the corresponding capability, and the specs become the source of truth they
should have been.)

## Impact

**Code (primary):**
`packages/synapse/src/runtime/server.ts` (headers, CDN, WS origin, SSE authz, error masking,
health redaction, in-flight tracking, `Bun.serve` options), `runtime/uploads.ts` (multipart
ceiling, response redaction), `runtime/network-guard.ts` (validated-IP pinning),
`runtime/rate-limiter.ts` + `runtime/server.ts` (IP resolution, bucket eviction),
`runtime/event-hub.ts` (topic bound, ACL), `runtime/server.ts` (`stop()` draining),
`core/action-context.ts` (cookie defaults), `core/session-token.ts` (request-time revocation,
bounded set), `core/storage.ts` (signed `delete`, shared path-segment validator),
`core/config.ts` (fail-loud config load), `core/database-factory.ts` (credential redaction),
`compiler/scaffolder.ts` (traversal), `compiler/fields-parser.ts` (field-name validation),
`compiler/slice-templates.ts` (`oauth-github` hardening, `new-shared` name), `compiler/contract.ts`
(upload sentence), `compiler/context-bench.ts` / `compiler/impact-analyzer.ts` (false-green),
`compiler/db-schema-generator.ts` + `compiler/slice-splitter.ts` (quadratic regexes),
`mcp/server.ts` (output caps, redaction, tool-name truth), `bin/synapse.ts` (version/status
single source, `UNKNOWN_FLAG` parity, `impact` exit code, `new` directory confinement).

**Tests:** new/extended coverage in `runtime-server.test.ts`, `uploads.test.ts`, `scaffolder.test.ts`,
`security-hardening.test.ts`, `production-hardening.test.ts`, `session-security.test.ts`,
`machine-types.test.ts`, `contract.test.ts`, plus a new browser-hook suite and a new real-Postgres
queue/client suite; removal of `jev-integration` tests that cover the third-party package and of
the `useAction` test that exercises a function defined in its own body.

**Docs/config:** `AGENTS.md`, `README.md`, `README.pt-BR.md`, `CHANGELOG.md`,
`packages/synapse/README.md`, `packages/synapse/package.json`, `templates/starter/package.json`,
`scripts/bench-concurrency.ts`, `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`,
`.github/workflows/release.yml`.

**Compatibility:** four breaking behaviour changes (CDN opt-in, cookie defaults, WS origin
fail-closed, SSE authz) plus the removal of the `^1.1.1` scaffold pin. `SchemaErrorCode`-style
unions gain members (`ScaffoldErrorCode`); `bun run test:all` and the publish rehearsal remain the
acceptance gates.
