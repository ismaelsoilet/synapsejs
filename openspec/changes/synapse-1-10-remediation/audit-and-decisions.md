# Audit and decisions (SureForge)

## State

| Field | Value |
| --- | --- |
| Task ID | `synapse-1.10-remediation` |
| Owner | Ismael Soilet (maintainer) |
| Tier and reason | **Standard** — planejamento documental, reversível, sem execução de código; a entrega é um plano e specs, não um deploy |
| Current phase / gate | Phase 1 (research) **READY**; Phase 2 (plan) **READY**; execution **local scope complete** — `bash scripts/run-gates.sh` passed **21/21**; the 1.10.0 commit is being created; release certification pending the PostgreSQL/Docker CI gates, the operator's branch-protection confirmation and the tag |
| Contract version | v5 (2026-10-31, committed) |
| Artifact snapshot | the 1.10.0 commit (`HEAD`) — 55 tracked files changed plus the new source/test/docs/evidence files; `git show --stat HEAD` is the inventory |
| Environment | Bun 1.4.2, TypeScript 5.9.3 (lockfile), React 19.3.0, happy-dom 20.14.5, Linux x64, SQLite local; PostgreSQL only via CI service |
| Next authorized action | Run the PostgreSQL/Docker gates and confirm branch protection in CI, then replay `verify-release-evidence.ts` on the clean commit and tag `v1.10.0` |

## Blocking decisions (authoritative)

This is the single list other artifacts reference. `unanswered` is not approval. Execution stays
blocked until every item is `approved` or `rejected` with a recorded reversal path.

| ID | Decision | Recommendation | State | Reversal / scope effect |
| --- | --- | --- | --- | --- |
| D1 | Release the eight waves as 1.10.0 (vs 1.9.1) | **1.10.0** | approved (execution instruction) | A patch release changes the changelog and tag; features remain |
| D3 | Make `HAVING` portable by accepting aggregate expressions and rejecting alias-only conditions | **Accept aggregate expression** | approved (execution instruction) | Breaking for callers that relied on SQLite-only aliases; migration note required |
| D4 | Cron PostgreSQL parity now vs explicit `CRON_UNSUPPORTED_ENGINE` in 1.10 | **Explicit error; parity in 1.11** | approved (execution instruction) | Choosing parity now adds a distributed scheduler design and tasks |
| D5 | CSS as a documented copy/bundle vs a full Tailwind compiler | **Copy/bundle; no hardcoded theme** | approved (execution instruction) | A compiler adds a build dependency and a larger scope |
| D6 | Error boundary default-on with opt-out vs primitive only | **Default-on with opt-out** | approved (execution instruction) | Default-off restores today's behavior but weakens the claim |
| D7 | `new-domain` becomes transactional and returns `Err` on partial failure | **Transactional** | approved (execution instruction) | Breaking for callers that treated partial Ok as success |
| D10 | Pin/vendor TS 5.9 + guardrail in 1.10; migrate to TS 7 in 1.11 | **Pin + guardrail; migrate in 1.11** | approved (execution instruction) | Migrating now is a rewrite of eight compiler modules |

**Execution authorization (2026-10-31).** The maintainer instructed: “execute o plano e nao
pretendo extrair o framework para mcp e split, deixe como esta, depois podemos pensar em
ferramentas novas (inclsuive acoplando em outros frameworks)”. This is an explicit execution
instruction, not silence: the seven defaults above are the plan's defaults and were accepted for
this execution. The strategic recommendation to extract `synapse-mcp`/`synapse-split` is
**rejected for now** (D-STRAT-01); the framework stays as a monolith, and new tools/coupling to
other frameworks are a future track. The execution is still reported honestly per gate: a task is
only marked done when its verification passes.



## Understanding memo

**Original request.** "Com sureforge fazer as specs e o plano mestre de correção e melhorias,
coloque suas recomendações." The user supplied a report claiming the eight waves were approved
without reservations.

**Intended outcome and recipient.** The maintainer needs a reviewable, executable plan that turns
the eight waves into a reproducible 1.10.0 release, plus a strategic recommendation on whether and
how to continue. The artifacts are for the maintainer and for a fresh-context reviewer; they are
not a release approval.

**Deliverables.** `proposal.md`, eight capability specs, `design.md`, `tasks.md`, this memo/
decision log, `recommendations.md`, `review-triage.md`, `coverage-ledger.csv`, and
`requirement-map.csv`.

**Acceptance criteria for this planning task.**

- Every confirmed audit finding is mapped to a spec requirement and a task with a verification.
- The plan distinguishes what is already true, what is broken, and what is a recommendation.
- Decisions that change scope are recorded with options and a recommendation, not silently assumed.
- The plan can be executed without hidden environment variables.
- The strategic recommendation is explicit and falsifiable.

**Scope and exclusions.** In scope: the eight waves, the release gates, the documentation, the
TypeScript 7 guardrail. Out of scope: new features, PostgreSQL cron parity in 1.10, full TS 7
migration, product pivot, agent benchmark execution.

**Inspection units.** The working tree diff; the eight specs; `tasks.md`; the source files named in
the proposal; the commands that produce evidence; SQLite and PostgreSQL environments; browser/DOM
(happy-dom); TypeScript 5.9 and 7.

**Permissions.** File changes: create the OpenSpec artifacts (done); no source changes were made.
Delegation: not used. Network: one primary source for the PostgreSQL `HAVING` rule. Spending,
publishing, destructive actions: none.

**Tools and missing capabilities.** Local shell, Bun, OpenSpec CLI, web search/fetch. Missing: a
running PostgreSQL instance in this session (the plan uses the CI service); a fresh-context
reviewer (self-review-only for now); a real browser (happy-dom only).

**Budget.** No explicit time/token cap was given. The review budget follows SureForge: at most
three rounds per gate. Unknown costs remain unknown; no numeric estimate is invented.

**Stop/recovery conditions.** Stop if a provisional decision changes the scope, if a required
reviewer is unavailable for an explicitly required review, if PostgreSQL evidence is required but
unavailable, or if a gate stays red after three rounds. Each phase is revertible by commit; the
breaking changes land one per commit with migration notes.

## Evidence measured (2026-10-31)

These are observations from the working tree, not claims from the report:

| Check | Result |
| --- | --- |
| `bun test packages/synapse/test` (no env) | **Not stable across runs**: owner run 563 pass / 6 skip / 9 fail; reviewer run 559 pass / 6 skip / 13 fail + **1 error**. 578 tests / 71 files. Record actual totals and failing names; never freeze a count. |
| `NODE_ENV=development` or `NODE_ENV=test` suite | Owner run 572/6/0; reviewer run 570/6/2 + 1 error. The harness fix is necessary but not sufficient; timeout-sensitive tests remain. |
| `NODE_ENV=development bun run test:all` | exit 0; **636 pass = 572 framework pass + 57 oracle cases + 7 e2e**. The 6 skipped framework tests are not part of the 636; total suite tests are 578. |
| `bun run docs:check` | **FAIL** — `README.md:16,399,419` and `README.pt-BR.md:16,420` still say 18 tools; `AGENTS.md`, `RELEASE-CHECKLIST.md` and `docs/releases/1.9.0.md` say 69 warnings (actual 67); the checklist says 568/70 (actual 578/71). |
| `bun run check` | PASS |
| `bun run check:template` | PASS |
| `bun run split` | PASS, 0 leaks |
| `bun run skeleton` | PASS, no diff in `.codebase` |
| `synapse db-drift` / `synapse impact customers` | PASS |
| `bun test docs-claims.test.ts mcp-server.test.ts` | 23 pass |
| `bun run lint` | exit 0, 67 warnings, 1 info |
| e2e | 7/7 |
| MCP tools | 19 registered |
| Cron DOM/DOW | **AND**, not POSIX OR (`cron-parser.ts`) |
| `runAt` | accepted by `defineJob`, **never consumed**; `enqueue` only derives a local `run_at` from `delaySeconds` |
| `HAVING` | test emits `HAVING total_amount > $2`; PostgreSQL rejects output aliases; the builder only sanitizes identifiers, so it cannot express `SUM(amount) > $1` |
| `exists` | implemented as a full `COUNT(*)` on every client; O(n) where a limited lookup would do |
| `MockDatabaseClient.aggregate` | delegates to `findMany` and ignores `aggregations`/`groupBy`; real SQLite/PostgreSQL aggregate works through `findMany` (the query-builder test passes). Only the mock is wrong. |
| CSS bundle | `buildCssBundle` only called from the CSS route; the link is only emitted if the file exists — deadlock on first boot |
| `SliceErrorBoundary` | exported, not used by the runtime/templates; no test |
| SPA transitions | preserves values, not focus/checked/selected/scroll; no test; keys are interpolated into selectors without escaping |
| `new-domain` | happy path tested; partial failures silently ignored |
| `WARN_LARGE_SLICE` | implemented, no test; guide says 450, code warns at 500 |
| Permissions in token | **absent** from `SessionClaims`/`signSessionToken`/`verifySessionToken`; RBAC granular does not work on the signed-token path |
| TypeScript 7 | `typescript@latest` is 7.0.2 and removed `ts.sys`; eight compiler modules depend on the TS 5.x JS API |
| Gate scripts | `scripts/docs-check.ts` and `scripts/coverage-check.ts` spawn the suite with `NODE_ENV: process.env.NODE_ENV ?? 'development'`; `run-gates.sh` unsets it one level up but the children re-inject it — a masking path |
| Gate inventory | `scripts/run-gates.sh` is the canonical 21-gate runner (24 with `--with-docker`), including `coverage:check` and repo-map drift; the first plan draft omitted both and listed `bench`/`impact` without targets |
| Badges | `README.md` and `README.pt-BR.md` claim “568 Passing (100%)” / “100% Green Gates” while the default command is red |
| Changelog history | `CHANGELOG.md:82` contains a historical “11 to 18 tools” line; a naive changelog gate would force rewriting history |

## Three perspectives

**User value and requirements.** The maintainer needs a release he can defend. The valuable work is
already in the tree; the missing piece is reproducibility and honest evidence. A plan that fixes
only code but leaves the default command and `docs:check` red does not satisfy the request.

**Feasibility and evidence.** Every fix is local and small except the TS 7 migration and PostgreSQL
cron parity, which are correctly separated. The test Harness fix is a one-line environment change
plus regression tests. PostgreSQL `HAVING` requires a real engine; CI already has a `postgres:16`
service. The CSS feature can be made honest either by wiring a copy/bundle or by narrowing the
claim; a full Tailwind compiler is out of scope.

**Risk and economics.** The highest-risk items are behavioral: cron OR changes schedules, `HAVING`
alias removal breaks existing calls, permissions in tokens change session size/expiry, and a
default error boundary can hide failures. Each gets a migration note, a test, and a reversible
default. The biggest economic risk is publishing a release that fails its own published commands;
that is exactly what the current state does.

## Decision log

`unanswered` means the user has not confirmed the recommendation; the plan uses a provisional
default and the execution gate stays blocked.

| ID | Question / proposal | Evidence | Options | Recommendation | User response | Scope effect |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Version for the eight waves | Features + behavior changes in the working tree | 1.9.1 patch / 1.10.0 minor | **1.10.0** | unanswered | Changelog, tag, migration notes |
| D2 | How to make the default test command green | Suite fails by a variable count (9–13); DOM `act` undefined in production build | shell env var / fix harness | **Fix harness in preload + regression test** | unanswered | Test infra only |
| D3 | `HAVING` portability | SQLite test passes; PostgreSQL rejects output aliases | document SQLite-only / aggregate expression | **Structured aggregate expression + PG test** | unanswered | Query API, tests |
| D4 | Cron engine scope in 1.10 | Postgres queue ignores `cron`; parser uses AND | parity now / explicit error + 1.11 | **Explicit `CRON_UNSUPPORTED_ENGINE`; parity in 1.11** | unanswered | Tasks 5.4, docs |
| D5 | CSS semantics | Deadlock link↔route; copy/hardcoded fallback | wire copy / full Tailwind compiler | **Wire copy/bundle; no hardcoded theme; document** | unanswered | Tasks 7.1–7.3 |
| D6 | Error boundary default | Exported but unused; no test | primitive only / default-on with opt-out | **Default-on with opt-out + test** | unanswered | Tasks 7.4, fallback behavior |
| D7 | `new-domain` atomicity | Silent partial Ok | keep / transactional | **Transactional with `PARTIAL_WRITE`** | unanswered | Tasks 8.1–8.2 |
| D8 | Permissions in signed tokens | Claims lack permissions | DB lookup per request / token claim | **Token claim with bounds; DB fallback documented** | unanswered | Session/OAuth specs |
| D9 | Docs source of truth | 18 vs 19 tools; 568 vs 578; 69 vs 67 warnings; guide `db.tx` | manual edits / gate + source | **Gate + source of truth + guide fix** | unanswered | Tasks 3, 9 |
| D10 | TypeScript 7 | TS 7 removed JS API used by 8 modules | migrate now / pin + guardrail | **Pin/vendor 5.9, named error, smoke; migrate 1.11** | unanswered | Tasks 10 |
| D11 | CI triggers | `workflow_dispatch` only | manual / push+PR / full every push | **Fast gate on push/PR; full on main/release** | unanswered | Workflow |
| D12 | Release approval | Report claimed approved without reproducible commands | report / evidence file | **Evidence file required; no approval without it** | unanswered | Release process |

## Review triage (round 1)

A fresh-context reviewer performed four methods: traceability extraction, feasibility/dependency
dry run against the code and commands, premortem/honesty audit, and cross-artifact consistency.
The findings and their disposition are recorded in `review-triage.md`. Summary:

- **Confirmed and repaired:** M-01 (timeout-sensitive tests mean the harness fix alone is not
  green), M-02 (`docs-check`/`coverage-check` re-inject `NODE_ENV=development`), M-03 (baseline
  counts not reproducible), M-04 (four different blocking-decision sets), M-05 (specs pinned
  volatile counts), M-06 (hand-rolled gate list omitted `coverage:check` and repo-map drift),
  M-07 (merge blocking is a hosting setting, not a repo artifact), M-08 (release evidence was
  self-certified), M-09 (three different large-slice thresholds). Non-material N-01..N-12 were
  incorporated where applicable.
- **Partially refuted:** M-10's claim that `aggregate` “does not aggregate on any engine” is false
  for SQLite/PostgreSQL — `aggregate` delegates to `findMany`, which compiles `aggregations` and
  `groupBy`, and the query-builder test passes. The accurate findings (mock ignores aggregation;
  `exists` uses `COUNT(*)`) are now in the evidence table and the DQP spec/tasks.

## Gate status

- **Research (Phase 1): READY.** The request, the current state, the evidence and the alternatives
  are recorded; no hidden decisive uncertainty remains. The PostgreSQL `HAVING` rule was checked
  against a primary discussion of PostgreSQL's `HAVING`/alias behavior.
- **Plan (Phase 2): READY as a plan artifact.** Rounds 1–3 were completed; every material finding
  is repaired. The final round-3 finding (the ledger still carried `contract_version=v2`) was fixed
  to v3 on all 57 rows and verified mechanically (20 fields, 46/46 requirements joined, OpenSpec
  strict valid). No independent round 4 is allowed by the three-round limit; the residual risk is
  the mechanical nature of that last one-column edit, not a design gap.
- **Execution: BLOCKED pending the authoritative blocking decisions** (`D1`, `D3`, `D4`, `D5`,
  `D6`, `D7`, `D10`) in the section above. The plan uses provisional defaults so it can be
  reviewed, but the SureForge contract does not treat silence as approval.
- **Independent review:** one fresh-context review was performed (not self-review). Round 2 is a
  targeted re-check of the repaired findings; the reviewer's round-1 methods and coverage are in
  `review-triage.md`.

## Execution result (2026-10-31)

`bash scripts/run-gates.sh` passed **21/21**. The framework suite is **600 pass / 10 skip / 0 fail**
(610 tests across 75 files); `test:all`, `check`, `check:template`, `docs:check`, `lint` (0 errors,
67 warnings), `coverage:check` (62.55% functions / 75.16% lines), `split`, the four oracle suites,
the live e2e, both benchmarks, the repo-map drift gate, the publish rehearsal and the five negative
cases are green. `docs-check` reports `610 tests / 75 files / 19 tools / v1.10.0`.

Not locally verified by design: PostgreSQL engine tests (no `TEST_DATABASE_URL`; CI runs them),
Docker/container (no Docker in this host), branch protection (GitHub setting), the TS 7 smoke (CI
job) and the final tag/publish (the 1.10.0 commit is clean; the tag is the operator's next action).
The release evidence lives in `release-evidence/1.10.0.md`; it declares the symbolic `HEAD`, and
`scripts/verify-release-evidence.ts` resolves it and requires a clean working tree.

## Coverage denominator

The full denominator is the union of the 46 requirements in the eight specs, each checked in the
environments it names: SQLite, PostgreSQL (CI), browser/air-gapped, Bun/TS 5.9, the oracle runner
and the documentation gate. `coverage-ledger.csv` lists 57 planned check rows (all `missing`/
`unverified`), keyed to the requirement IDs defined in `requirement-map.csv`; every ledger
`requirement_id` joins to the map. The map lists the primary task for each requirement; `tasks.md`
is the full 72-task inventory, including the baseline tasks (1.0–1.3) and cross-cutting
verification tasks (3.4, 3.7, 4.7, 5.8, 6.7, 7.7, 8.7, 9.5, 10.5, 11.1–11.5) that serve several
requirements rather than one.
