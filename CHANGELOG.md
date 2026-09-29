# Changelog

## 1.6.0 — Production Hardening, Zero-Trust Resilience & Operational Reliability (Wave 8)

- **Network Guard & SSRF Protection (Component 1)**:
  - Added `packages/synapse/src/runtime/network-guard.ts` with `isPrivateOrReservedIp` and `validateExternalUrl`.
  - Blocks DNS rebinding, loopback, private IPv4/IPv6 CIDRs, and cloud metadata endpoints (`169.254.169.254`, AWS IMDSv1/v2, GCP, Azure, Oracle Cloud).
  - Hardened static image optimization (`/_synapse/images/optimize`) with strict domain allowlisting and directory containment preventing path traversal.

- **Anti-Spoofing & Bounded Rate Limiting (Component 2)**:
  - Implemented bounded bucket storage within `TokenBucketRateLimiter` (default 10,000 buckets) with deterministic LRU eviction.
  - Hardened IP address resolution against header spoofing via `trustProxy` configuration, preventing shared anonymous bucket DoS.

- **Bounded LRU SSR Micro-Cache & Normalization (Component 3)**:
  - Bounded in-memory SSR micro-cache storage with deterministic LRU eviction (default 1,000 entries).
  - Added URL normalization via `normalizeCacheKey`: sorts query parameters and strips ad/tracking tokens (`utm_*`, `fbclid`, `gclid`).

- **Strict Payload Guards & Malformed JSON Protection (Component 4)**:
  - Added payload size limits: `maxRpcPayloadBytes` (5MB) and `maxWebhookPayloadBytes` (10MB) returning HTTP 413 Payload Too Large.
  - Safe body parsing returning HTTP 400 Bad Request with `INVALID_JSON_PAYLOAD` on malformed JSON bodies.

- **SQLite Queue Zombie Job Recovery (Component 5)**:
  - Added `locked_at INTEGER` timestamp column and `idx_synapse_jobs_stale` index to SQLite `_synapse_jobs` table.
  - `claimNextJob` automatically detects and reclaims orphaned/crashed worker tasks past visibility timeout.

- **HTTP 500 SSR Error Isolation & Hydration Safety (Component 6)**:
  - Server-side loader and React rendering exceptions return HTTP 500 status code.
  - Injects `X-Robots-Tag: noindex, nofollow` to prevent search engine indexing of error states.
  - Suppresses client bundle script tag to avoid client-side hydration crashes on unrecoverable server errors.

- **Secure HttpOnly Cookie Authentication (Component 7)**:
  - Added `ctx.setCookie(name, value, options)` and `serializeCookie` in `action-context.ts`.
  - Propagates cookies with `HttpOnly`, `SameSite=Lax`, and `Secure` attributes directly in RPC response headers via `Set-Cookie`.

- **Graceful HTTP Shutdown & Docker Production Script (Component 8 & 9)**:
  - Enhanced `server.stop(drainTimeoutMs)` with in-flight connection draining window (5000ms default).
  - Added root and package `"start"` scripts: `synapse start` launching production server with graceful SIGTERM/SIGINT handling.

- **Test Suite Pass Rate**:
  - Expanded test suite to **414 automated tests** across **55 files** (100% green gates).
  - Added `packages/synapse/test/production-hardening.test.ts` covering all 8 hardening components.

## 1.5.0 — Real-Time WebSockets, Sub-Slice Composition, SSR Micro-Cache & High-Concurrency SQLite (Wave 7)

- **SQLite Write Concurrency & Throughput Acceleration (Deficiência 1)**:
  - Configured optimized SQLite connection pragmas in `sqlite-client.ts`: `PRAGMA synchronous = NORMAL;`, `busy_timeout = 5000;`, `temp_store = MEMORY;`, `cache_size = -64000;`, and `mmap_size = 268435456;`.
  - Mutexed transaction locking ensures serialize-safe execution without collision.
  - Production benchmark (`bun scripts/bench-production.ts`): Throughput escalated from **375.01 req/s** to **4,001.28 req/s** (**10.7x throughput increase**), with p50 latency dropping from **24.99 ms** to **1.10 ms** (**22.7x latency reduction**).

- **Sub-Slices & Composable Nested Outlets (Deficiência 2)**:
  - `<SliceOutletProvider />` and `<SliceOutlet name="..." fallback={...} />`: Provides flexible, named layout slots for parallel sub-panels, headers, sidebars, and nested views.
  - `<SubSlice domain="..." name="..." component={...} />`: Enables embedding child slices into layouts and dashboards while automatically wiring wire-compatible RPC endpoints (`action`, `onSubmitAction`) to props.
  - Fully adheres to Locality of Behavior ($N = 1$): fatias never import another slice directly.

- **Native Bidirectional WebSockets (Deficiência 3)**:
  - Introduced `defineSocket` contract and `sliceSocket` convention with `onOpen`, `onMessage`, and `onClose` handlers.
  - Added native Bun WebSocket upgrade routing at `GET /_synapse/ws/:domain/:name` with session context propagation.
  - Added isomorphic client hook `useWebSocket(pathOrSlice, options)` supporting automatic reconnection, typed JSON messaging, connection state tracking, and cleanup.

- **SSR Micro-Cache & Incremental Static Regeneration (Deficiência 4)**:
  - Introduced `defineCache` contract and `sliceCache` convention with `ttlSeconds`, `staleWhileRevalidateSeconds`, and invalidation `tags`.
  - HTTP Server automatically evaluates cache policies on GET requests, serving sub-millisecond cached HTML with `X-Synapse-Cache: HIT`, handling background revalidation with `X-Synapse-Cache: STALE`, and caching fresh renders with `X-Synapse-Cache: MISS`.
  - Atomic tag invalidation available server-side via `server.invalidateCache(tags)` and in action handlers via `ctx.invalidateCache(tags)`.

- **Third-Party Vendor Code-Splitting (Deficiência 5)**:
  - Added `compiler.vendorPackages: string[]` to `SynapseConfig`.
  - Configured packages (e.g. `lucide-react`, `canvas-confetti`) are bundled into `_vendor.js` and exposed via browser-native `<script type="importmap">`, maintaining client micro-bundles (< 1KB) with zero duplicate bundle bloat.

- **Shared Module Scaffolding & Cross-Slice Ergonomics (Deficiência 6)**:
  - Added CLI command `synapse new-shared <name>` and `scaffoldShared` function in `scaffolder.ts`, generating safe transactional modules in `src/shared/<name>.ts`.
  - Enriched `SLICE_IMPORTS_SLICE` diagnostics with actionable guidance recommending `synapse new-shared <name>`.

- **Test Suite & Rigor**:
  - Monorepo test suite expanded to 397 automated tests across 54 test files (100% green).
  - Dedicated verification test suite added in `packages/synapse/test/onda7-deficiencies.test.tsx` verifying all 6 structural solutions.

## 1.4.0 — Security Hardening, Fail-Closed Actions & Ground-Truth Benchmarks (Wave 6)

- **Fail-Closed Actions by Default (`defineAction`)**:
  - Introduced the `defineAction` primitive in `packages/synapse/src/core/action-definition.ts` and exported it from the package root.
  - Fail-Closed by default: actions require an authenticated session and matching roles unless explicitly configured with `auth: 'public'`. Omission of auth rejects calls with `UNAUTHORIZED` or `FORBIDDEN` before executing the handler.
  - Automatic TypeBox JIT schema validation: incoming payloads are validated against the declared TypeBox schema before entering the action handler, eliminating repetitive manual `Value.Check` and unsafe type casting.

- **Adversarial Hardening of the AST Splitter**:
  - Enhanced leak detection patterns in `slice-splitter.ts` against obfuscated access to secrets (`process['env']`, `const { env } = process`), Node.js server module imports (`node:fs`, `child_process`, etc.), dynamic code evaluation (`eval()`, `new Function()`), and leaked DDL statements (`ALTER/DROP TABLE`).
  - Added comprehensive adversarial test suite (`packages/synapse/test/splitter-adversarial.test.ts`) covering 5 adversarial injection scenarios.

- **Topological Schema DAG Robustification**:
  - Sanitized DDL parsing in `schema-dag.ts` by stripping single-line (`--`) and multi-line (`/* */`) SQL comments before dependency graph generation, preventing false circular dependency cycles.
  - Added support for PostgreSQL/SQLite schema-qualified and quoted identifiers (`public."users"`, `REFERENCES auth."accounts"`).

- **Ground-Truth Production Benchmarks**:
  - Implemented `scripts/bench-production.ts` and `bun run bench:production` measuring real under-load performance on React 19 SSR with layouts and RPC database mutations with SQLite and TypeBox validation under concurrency.

- **Documentation & Metrics Alignment**:
  - Synchronized README badges and test counters to the real monorepo test suite (388 tests, 100% passing across 54 files).
  - Clarified MCP architecture: 15 native tools (11 System 2 architecture tools + 4 System 1 Jev cognitive reflex tools).
  - Documented built-in production security mechanisms: CORS, CSRF, signed session tokens (`SYNAPSE_SESSION_SECRET`), and topological migration ordering.

## 1.3.0 — UI Freedom, Layout Hydration & Developer Autonomy (Wave 5)

- **Neutral HTML Shell for Custom UI & Theming**:
  - When a root layout (`_layout.tsx`) or domain layout is present, `renderHtmlShell` outputs a neutral, unconstrained container (`<html class="min-h-full">`, `<body class="min-h-full flex flex-col">`) without hardcoded Tailwind dark classes (`bg-slate-950 text-slate-100`) or default machine headers/footers.
  - The application layout owns 100% of the viewport, enabling seamless light/dark theme switches and bespoke design systems without CSS `!important` specificity wars.
  - The developer showcase shell with top bar, max-width card, and machine footer is preserved automatically whenever no custom layout is detected.

- **Isomorphic Layout Hydration in Client Bundles**:
  - `client-bundler.ts` and `client-entry.ts` now detect root and domain layouts and generate client entrypoints that hydrate the complete tree: `SynapseProvider` -> `RootLayout` -> `DomainLayout` -> `SliceComponent`.
  - Interactive elements inside layouts (theme toggles, navbar dropdowns, notifications, profile popovers) are fully hydrated with React event listeners in the browser.
  - Eliminates React hydration mismatch warnings between server SSR and client runtime.

- **Universal `useAction` Hook with Context Auto-Discovery**:
  - `useAction()` exported from `synapsejs/client` can now be invoked without arguments (`useAction()`), automatically resolving the active slice's server action from `SynapseContext`.
  - Added support for optional lifecycle options: `useAction(actionFn, { onSuccess: (data) => ..., onError: (err) => ... })`.
  - Full reactive state management: `execute`, `isSubmitting`, `data`, `error`, `isSuccess`, `isError`, and `reset()`.

- **Structured Schema Diagnostics & Tolerant Contracts**:
  - Introduced `validateSchema(schema, payload)` returning typed `Ok(value)` or descriptive `Err('INVALID_SCHEMA: campo "/field": ...')` with the exact path and error reason.
  - Updated scaffolder templates (`scaffolder.ts`, `slice-templates.ts`) to configure `Type.Object(..., { additionalProperties: true })`, preventing form submission failures caused by synthetic events or ancillary fields.

- **Cache-Busting for Slices & Bundles**:
  - Added timestamp-based query parameters (`?v=<timestamp>`) to client bundle script tags in `ensureClientBundle`, guaranteeing browsers and SPA morphers fetch the latest bundle immediately when a slice is edited.
  - Added mtime cache-busting to dynamic imports in `discoverSlices()`, ensuring hot-reloading always loads the fresh module code in Bun.

- **Test Suite Expansion**:
  - Monorepo test suite expanded to 372 automated tests across 51 test files, verifying all 1.3.0 features and maintaining 100% green gates.

## 1.2.0 — Jev System One Cognitive Integration & OpenSpec 1.13.2

- **Jev-Harness Cognitive Architecture**:
  - Deep integration of Jev System One fast semantic decisions into SynapseJS test gates, oracle runner, and MCP server.
  - Native tools for triage, failure recovery, circular trajectory detection, and reasoning effort modulation.
- **OpenSpec 1.13.2 Specification Framework**:
  - Full suite of workflows and skills for spec-driven development (`opsx-*`) across Claude, Gemini, and Cursor environments.
- **SureForge Protocol**:
  - Autonomous agent quality control system with anti-hype guidelines, radical candor verification, and zero-mock runtime policy.

## 1.1.0 — Resilience, Scalability & Advanced Composition (Waves 1-4)

- **Wave 1: Routing, SSR Shell & Bundling**:
  - **Vendor Code-Splitting & Micro-Bundles**: `client-bundler.ts` splits React, ReactDOM, and common dependencies into a shared `_vendor.js` chunk. Slice bundles are compiled as micro-bundles (< 500B), resolving external imports via browser-native `<script type="importmap">`.
  - **Dynamic SEO & Open Graph Metadata (`sliceMeta`)**: Slices can export `sliceMeta(data, context)` returning title, description, keywords, canonical URLs, and Open Graph / Twitter card tags. The SSR shell evaluates `sliceMeta` on server render and the client splitter strips it with zero leaks.
  - **Hierarchical Domain Layouts**: Support for nested layouts at `src/slices/<domain>/_layout.tsx`, wrapping domain-specific slices within domain navigation/sidebars while preserving the root layout `src/slices/_layout.tsx`.

- **Wave 2: Database Resilience & Network Defense**:
  - **Bidirectional DDL Migrations & Transactional Rollbacks**: `sliceSchema` supports optional `-- up:` and `-- down:` demarcations. Added CLI `synapse rollback [targetSlice] [--steps=N]` and native MCP tool `synapse_rollback` to roll back schema changes transactionally and clean up `_synapse_migration_statements`.
  - **Sliding-Window Token Bucket Rate Limiting**: Built-in `TokenBucketRateLimiter` protecting RPC, webhook, and SSR routes with strict RFC 6585 compliance (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`). Configurable via `SynapseConfig.rateLimit`.
  - **Streaming Multipart File Upload Protection**: Memory-safe streaming parser rejecting oversized uploads via early `Content-Length` inspection (HTTP 413 Payload Too Large) before consuming body buffers, preventing OOM DoS attacks.

- **Wave 3: Distributed Scale & i18n**:
  - **PostgreSQL Distributed Event Hub (`PostgresEventHub`)**: Native multi-instance pub/sub using a dedicated persistent PostgreSQL connection for `LISTEN/NOTIFY` (preventing transaction-pooler eviction like PgBouncer in transaction mode). Automatically offloads payloads exceeding 8KB to `_synapse_event_payloads` table with automatic TTL cleanup, with per-instance deduplication via `instanceId`.
  - **Isomorphic i18n Routing & Primitives**: First-class internationalization via `createTranslator(dictionary, locale)` primitive and localized URL prefix routing (`/:locale/*` e.g. `/en/...`, `/pt-BR/...`) with automatic `<html lang="...">` injection and cookie/header negotiation.

- **Wave 4: UI Primitives, Auth & DX**:
  - **Advanced `<DataForm>` Primitives**: Full support for nested dot-notation fields (`user.profile.bio`), file inputs (`<input type="file">`), and granular inline field-level validation errors (`fieldErrors`).
  - **Session Token Revocation Blacklist**: Cryptographic session revocation mechanism (`TOKEN_REVOKED`) backed by an in-memory TTL cache and durable `_synapse_session_blacklist` database table. Revocation methods `revokeSessionToken(token)` and `isSessionRevoked(token)`.
  - **TOTP Two-Factor Authentication Slice Template**: `synapse new-slice auth 2fa --template=auth-2fa` scaffolding complete TOTP 2FA enrollment, QR-compatible base32 secret generation, and verification action.
  - **On-Demand Image Optimizer**: Secure dynamic sharp image transformation endpoint `GET /_synapse/images/optimize?url=...&w=...&h=...&q=...&fmt=webp` with domain allowlist, path traversal guards, dynamic sharp import, and air-gapped passthrough fallback when sharp is not installed.
  - **Infrastructure Plugin Lifecycle Hooks**: Extensible application hooks in `defineConfig`: `onBootstrap`, `onRequest`, `onResponse`, and `onMigrate`.

- **Tooling & Test Suite Expansion**:
  - MCP Server expanded to 11 native tools (added `synapse_rollback`).
  - Test suite expanded from 320 to 359 automated tests across 49 test files with 100% green gates.

## 1.0.0 — Production Release (Freeze & Realtime Parity)

- **Realtime Declarative SSE Gateway (`EventHub`)**:
  - `GET /_synapse/sse/:topic*` native streaming gateway powered by `ReadableStream` with automatic 15-second heartbeat comments to preserve connection liveness through reverse proxies, graceful client disconnect cleanup, and optional tenant-scoped topic partitioning.
  - In-action broadcast dispatcher: `ctx.broadcast(topic, payload)` in `ActionContext`.
  - Browser hook: `useSubscription(topic, onEvent)` exported from `synapsejs/client` with automatic reconnect and unmount teardown.
- **Relational Joins & Row Nesting in QueryBuilder**:
  - Type-safe, declarative join queries: `db.findMany(table, { join: [{ table, on, type, select, as }] })` supporting `INNER`, `LEFT`, and `RIGHT` joins with parameterized column aliasing.
  - `nestJoinedRow` transforms flattened join results into nested object/array domain structures without ORM bloat.
  - Verified across SQLite, PostgreSQL, and Mock test doubles.
- **Automated Schema Drift Detection**:
  - CLI `synapse db-drift` and MCP tool `synapse_check_db_drift`.
  - Compares live database catalogs (`pragma_table_info` in SQLite, `information_schema` in PostgreSQL) against slice AST `sliceSchema` declarations to surface `missingTables`, `missingColumns`, and `orphanTables`.
- **AST Cross-Slice Impact Analysis**:
  - CLI `synapse impact <target>` and MCP tool `synapse_diff_impact`.
  - Calculates exact blast radius when modifying a slice, shared module, or table across Foreign Key references, table usage, and module imports.
- **OAuth2 Social Authentication Template**:
  - `synapse new-slice <domain> <name> --template=oauth-github`.
  - Scaffolds a complete GitHub OAuth flow: code-for-token exchange, user profile lookup, upsert into `oauth_accounts`, and signed session token issuance.
- **Concurrency Stress Benchmark**:
  - `bun run bench:concurrency` (`scripts/bench-concurrency.ts`) executing 1,000 real HTTP requests at 50 concurrency against Bun's native HTTP server: measures real throughput (>48,000 req/s), latency percentiles (p50: 0.53ms, p99: 9.95ms), and memory delta (<6 MB).
- **Native MCP Server Expansion (10 Tools)**:
  - Added `synapse_check_db_drift` and `synapse_diff_impact` to the JSON-RPC 2.0 stdio server (`bun run mcp`).
- **Contract & Machine Surface Freeze**:
  - Public exports and runtime contracts frozen and validated by `packages/synapse/test/machine-types.test.ts`.
  - Full monorepo and isolated consumer project verified with 0 errors (`bun run check`, `bun run check:template`, `bun run split`, `bun run lint`).

## 0.7.0 — machine-native surface

- `src/shared/` is the sanctioned path for work two features must do together: a plain module that
  receives the `DatabaseClient` by parameter and opens `db.transaction` itself. A slice that imports
  another slice now fails with `SLICE_IMPORTS_SLICE`, transitively, and the message says where to put
  the code instead. The suite proves rollback with a real SQLite database (two tables, two features,
  nothing half-written); the mock database does not roll back and the contract says so.

- `synapse contract` and the MCP tool `synapse_contract`: the framework describes itself in one
  call — every slice export with suffix and signature, the Result/HTTP mapping, session rules,
  addressing, SSR behavior, the gates, the templates, and a copyable example. The suffix rules
  moved to `runtime/discovery-rules.ts` so runtime, splitter and contract read the same constants
  and cannot drift.
- `synapse new-slice --template=create|list|update|delete|crud`: list paginates with a parameterized
  filter, update is partial and builds its SET clause from a column allowlist, delete checks
  existence first. Each generated file passes the splitter gates in the test suite.
- Documented trap: `fc.double` without `noNaN: true` produced a flaky oracle in `generate-invoice`.
- `synapse build` pre-builds the browser bundle of every slice that renders a component and writes
  `.synapse/client/manifest.json`; the runtime serves the artifact straight from the manifest and only
  rebuilds when the slice changes. A slice that cannot be imported is reported `FAIL` with its reason
  instead of crashing the build, and a slice with no UI is `SKIP`, not a failure.
- `POST /_synapse/files/<domain>/<name>?name=arquivo.pdf` accepts raw bytes: it requires a session,
  refuses a name containing a directory (it never silently rewrites one) and stops reading the moment
  the body passes `SYNAPSE_MAX_UPLOAD_BYTES` (5 MiB by default) instead of buffering it first.
- Login as a slice, logout as a cookie: `--template=login` emits an action that verifies with
  `Bun.password.verify` (with a decoy hash so a missing user costs the same time), signs with
  `signSessionToken` and returns the token. The framework gained `storeSession` / `clearSession` /
  `currentRoles` (browser only, `document.cookie` only). The oracle proves the token the action
  issues is accepted by `verifySessionToken`, and `apps/crm` carries the generated slice.


Todas as mudanças relevantes deste projeto. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

**Nada foi publicado no npm ainda.** O `synapsejs` existe apenas neste repositório; as versões abaixo
descrevem o que cada corte contém, não releases públicas. O primeiro `npm publish` está descrito em
`RELEASE-CHECKLIST.md`.

## [Unreleased]

### Adicionado

- **Hidratação React de verdade.** O componente só rodava no servidor: o browser recebia HTML e um
  script inline que sequestrava o formulário. Agora o servidor gera, por fatia, um bundle de browser a
  partir do artefato do **splitter** (que deixa de ser gate decorativo e passa a ser o que mantém SQL
  fora do cliente), hidrata o mesmo componente e liga `onSubmitAction` ao endpoint RPC. No servidor
  essa prop é a própria action: o mesmo ponto de chamada vale dos dois lados.
- `synapsejs/client`, um entry browser-safe (o pacote agora declara `exports`), para o cliente não
  arrastar compilador, postgres e CLI para dentro do bundle.
- `public/` servido (só `public/`, com o caminho normalizado), CORS fechado por padrão
  (`SYNAPSE_ALLOWED_ORIGINS`), RPC exigindo `application/json` (o que fecha CSRF por construção) e
  log estruturado opcional (`SYNAPSE_LOG=json`).
- **Sessão assinada** (`signSessionToken`/`verifySessionToken`): com `SYNAPSE_SESSION_SECRET`, os papéis
  vêm da assinatura e os headers de papel deixam de valer — antes qualquer cliente forjava `x-user-roles`.
- `synapse dev --watch`.

### Corrigido

- **Evolução de schema era um beco sem saída.** O runner re-executava *todos* os statements
  quando o texto do DDL mudava, então um `ALTER TABLE` aplicado uma vez voltava a rodar na
  próxima edição e falhava para sempre (`duplicate column name`). Cada statement agora é
  registrado individualmente (`_synapse_migration_statements`) e só o que é novo roda:
  adicionar uma coluna virou declarar o `ALTER` no `sliceSchema`. Um statement que falha não é
  registrado, então corrigir e rodar de novo funciona.
- **Todo erro de domínio respondia HTTP 400.** Um cliente não conseguia distinguir sessão
  expirada (401) de proibido (403), de registro inexistente (404), de conflito (409) ou de
  contrato inválido (422). O status agora é derivado do código de erro; códigos desconhecidos
  seguem 400.
- O gate de vazamento do splitter confundia a tag HTML `<select>` com um `SELECT` de SQL e
  quebrava o build de qualquer app com dropdown.
- Sessão só nascia com `Authorization` ou `x-user-id`: mandar apenas `x-user-roles` (o que o
  fluxo de cookie do browser produz) virava sessão anônima em silêncio.

## [0.6.0] — release candidate

### Corrigido

- **O pacote não era instalável por ninguém fora deste monorepo.** `typescript` estava em
  `devDependencies`, mas o CLI e os módulos de compilador o importam em runtime: qualquer comando
  de um consumidor quebrava com `Cannot find package 'typescript'`. Passou a dependência de runtime.
- **O `.gitignore` do template não chegava ao tarball** (empacotadores descartam esse nome). Todo
  projeto criado a partir do pacote publicado nasceria sem ignore, commitando `.synapse/`,
  `.codebase/`, `dist/` e `node_modules/`. O template envia o arquivo como `gitignore` e o
  `synapse new` restaura o nome ao copiar.
- Os scripts do `package.json` raiz ganharam `rehearse:publish`, e o CI passou a rodar o ensaio.

### Adicionado

- **Ensaio de publicação** (`bun run rehearse:publish`): empacota, instala o tarball fora do
  monorepo e exercita cada ponto de entrada — import, `info`, `new`, `check`, `test`, `skeleton`,
  `migrate`, `new-slice` (com o slice gerado typecheckando e passando os dois gates do splitter) e o
  handshake do MCP. Rodou em CI e encontrou os dois bugs acima na primeira execução.
- **Estudo comportamental** (`scripts/study/`, relatório em `STUDY.md`): protocolo pré-registrado e
  piloto de 3 tarefas × 2 stacks, com métricas derivadas do git e contagem de tentativas pelo runner.
- **CHANGELOG, política de versionamento e checklist de release.**

## [0.5.0]

### Adicionado

- **Segundo app de referência** em outro domínio (`examples/helpdesk-slices`, 2 fatias) e
  **exemplo de adoção sem o framework** (`examples/helpdesk-conventional`, as mesmas features em
  camadas). Escrever o segundo expôs cola que o framework dá de graça: o TypeBox só valida
  `format: 'email'` quando o formato é registrado.
- **Benchmark de superfície de contexto** (`bun run bench`): mede o fecho de imports de cada feature
  nas duas stacks e reporta dois números, porque a fronteira do fecho muda a resposta.
- **Paridade PostgreSQL** (`bun run test:postgres`): DDL num servidor fresco, idempotência de migração
  e round-trip de action, contra `postgres:16`; job de CI com service container.

### Corrigido

- DDL portável: `DATETIME` (só SQLite) virou `TIMESTAMP` no runner de migrações, no scaffolder e em
  todas as fatias — sem isso a migração falha num banco PostgreSQL vazio.
- `getDatabase` recusa esquema de URL não suportado em vez de abrir SQLite em silêncio, o que faria
  um teste de paridade passar contra o motor errado.
- Avisos do PostgreSQL silenciados no cliente: `stdout` carrega apenas o JSON do comando.

## [0.4.0]

### Adicionado

- **Invariantes das fatias sob `bun:test`** (`synapse test`): um wrapper gerado registra cada caso
  nomeado, o runner produz JUnit e o resultado sai em JSON por invariante, com nome e mensagem.
- `AGENTS.md`: contrato de fatia, contrato do splitter, contratos de comando/JSON, códigos de falha e
  uma lista explícita do que **não** existe.
- Teste da invariante de localidade e teste de contrato dos slices reais.

### Corrigido

- **Falsos verdes eliminados.** `test`, `migrate`, `synapse_run_pbt` (MCP) e `check <arquivo>`
  retornavam `PASS` sem ter verificado nada; agora falham com `NO_SLICES_DIR`,
  `TARGET_FILE_NOT_FOUND`, `NO_FILES_MATCHED`, `EMPTY_REPO_MAP` ou `NO_CASES`.
- **Splitter reescrito** por alcançabilidade via type checker, em três módulos, com imports passados
  adiante e dois gates no CI: compilação do emitido e ausência de vazamento no cliente. O output
  anterior não compilava.
- RBAC passou a ser aplicado de verdade na fatia de fatura, com e2e provando `UNAUTHORIZED` e
  `FORBIDDEN`.
- Repo map emite o contrato real (sem `any`), é determinístico e verificado no CI.
- SQLite: leitura de CTE não cai mais no caminho de escrita perdendo linhas; statements cacheados;
  singleton duplicado removido.
- `unwrap()` removido da superfície pública; `check --fast` removido (**medido** mais lento que o
  check completo: 2.5s vs 1.9s).
- README reescrito como estável/experimental/roadmap, cada linha apontando para o teste que falha
  quando a feature quebra.
