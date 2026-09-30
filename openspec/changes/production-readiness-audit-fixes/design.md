# Design

## Context

See `proposal.md` — Why, and the per-capability specs for the behavioural contracts. This
document records only the technical decisions, and the runtime facts they rest on.

Four facts were measured directly while writing this, because three of them **contradict the
initial audit** and one of those contradictions changes the fix:

1. **`Bun.serve().stop(force)` returns a real `Promise`** (verified: `instanceof Promise`).
   `SynapseServer.stop()` calls `this.httpServer.stop(false)` **without `await`**
   (`runtime/server.ts:320`), so the framework never learns when draining finished, and then
   closes the database and the queue engine on a fixed 200 ms timer regardless.
2. **Bun's `stop(false)` already drains in-flight requests.** Verified: with a 400 ms handler,
   calling `stop(false)` at t≈30 ms and then sleeping 200 ms (the framework's current
   behaviour) still delivered the full response at t≈372 ms. The graceful-shutdown defect is
   therefore **not** "requests are cut off" — it is (a) `drainTimeoutMs` is silently capped at
   200 ms, (b) the drain promise is never awaited, and (c) the database and queue engine are
   hard-closed on that timer, so any in-flight request that touches the database *after* 200 ms
   fails. The design below fixes (a)–(c) and does not reimplement Bun's draining.
3. **`Bun.serve` accepts and enforces `maxRequestBodySize` on Bun 1.4.2.** Verified: with the
   option set to 1 KB, a 200 KB `POST` returns `413` and a 500 B `POST` returns `200` with its
   body read. The server currently sets no such option
   (`grep maxRequestBodySize packages/synapse/src` → 0 hits), so there is no process-level
   backstop behind the four hand-written body guards.
4. **The S3 adapter's `delete()` is unauthenticated** while its `upload()` and
   `getPresignedUploadUrl()` compute a full SigV4 signature. Against real S3 this silently
   returns `false`; against a misconfigured public-write bucket it performs an unauthenticated
   destructive request.

Two structural facts shape the approach more than any individual bug:

- **The framework already contains four correct containment validators** — a strict filename
  pattern for uploads, a storage-key sanitizer, a path-basename check, and an external-URL
  validator. The scaffolder is the one write path that uses none of them. Both the traversal
  bug and the multipart bug are instances of *"the guard exists on a sibling path and was not
  applied here"*. Treating them as two tickets would leave the class intact.
- **`AGENTS.md` §6 already states the rule this change exists to enforce** ("no claim without a
  green test"; "no fabricated metrics"). It is stated and then violated in at least nine places.
  So the honesty work is not a documentation chore — it is making an existing, written rule
  executable.

## Goals / Non-Goals

**Goals:**

- Close every confirmed critical/high finding, and retire the defect *classes* rather than the
  individual symptoms.
- Make each capability's scenarios map to a test that fails before the change and passes after.
- Make the repository's own claims machine-checkable, so drift becomes a red gate rather than a
  reviewer's discovery.
- Land each breaking change behind a documented, reversible migration note.

**Non-Goals:**

- Shipping a distributed state backend. Rate limiting, the SSR micro-cache, the event hub and
  revocation remain per-process; this change makes that scope *explicit and enforced by
  documentation and a pluggable interface*, not distributed.
- Building a real `Content-Security-Policy`-compatible Tailwind pipeline or removing the
  framework's neutrality on styling. The CDN becomes opt-in; bundling CSS is a separate change.
- Rewriting the OAuth template into a full identity provider. The template is hardened and made
  to actually work; provider-verified email is required and linking is refused rather than
  automated.
- Fixing the context-surface benchmark's *measurement*. It is honest and already documents its
  own limits; only its labelling and the numbers quoted from it change.
- A general test-suite refactor. Only the tests that assert a test double, assert a third-party
  package, or assert generated source text in place of behaviour are touched.

## Decisions

### D1 — Two-layer body size defence: process-level cap plus per-route streaming guards

**Decision.** Set `maxRequestBodySize` on `Bun.serve` (verified working, fact 3) as a
process-level backstop, *and* fix the per-route guards that are individually wrong.

**Why both.** The four hand-written guards are the precise, configurable per-surface limits
(RPC 5 MB, webhooks 10 MB, uploads 5 MB). The process cap is the backstop for any *future* body
reader, and for the one that exists today: multipart uploads buffer the whole body because the
declared-length pre-check uses an idiom where an absent header yields `0` (which passes the
check) instead of `NaN` (which deliberately skips the pre-check, as the RPC and webhook paths
correctly do). Fixing only the idiom closes the chunked hole; fixing only the post-parse size
check closes nothing, because the unbounded allocation happens inside the form parser.

**Alternatives considered.**
- *Delete the multipart branch.* Smaller diff and it matches the published contract sentence.
  **Rejected**: three existing tests depend on the branch, and browser file uploads need it. The
  contract sentence and the module docstring are reconciled to the implementation instead.
- *Set the cap only, leave the idiom wrong.* **Rejected**: the idiom is a latent trap that the
  next reader will trust, and the per-route limit must still work when the process cap is
  raised.

### D2 — One reusable path-segment validator, applied to every write surface

**Decision.** Add a single exported primitive in `core/` that validates a single path segment
and asserts post-join containment (the resolved path must remain inside the resolved base), and
apply it at all four scaffolder entry points, the field-grammar parser, the new-application
command, and the upload parser.

**Why post-join, not just character validation.** Character validation alone is defeated by the
compound case: the base resolution is already correct and confined, and the escape happens in
the leaf segments. A post-join containment assertion is the check that cannot be bypassed by a
segment that individually looks safe, and it also closes the shared-module and CRUD-scaffold
paths, which interpolate names differently. Belt-and-braces here is cheap; a traversal write
turns into remote code execution in a sibling application on that application's next boot.

**Alternatives considered.**
- *Character validation only, per call site.* **Rejected**: three call sites, three
  opportunities to forget, and it does not cover the compound case.
- *A sanitising rewrite (replacing illegal characters) instead of a rejection.* **Rejected**:
  silently rewriting a path segment is how traversal bugs become "expected behaviour". The
  project's existing upload validator **rejects and fails loud**, and this matches that.

### D3 — SSE authorisation is declared, not inferred; topics are tenant-namespaced

**Decision.** Introduce an explicit topic declaration primitive. A subscription to an undeclared
topic is refused; a declared topic carries a required role and is automatically namespaced by
tenant. Publishing into a topic the slice does not own is refused. Bound both the registered-topic
count and concurrent open subscriptions, and report `429` with `Retry-After` when the bound is hit.

**Why declared rather than inferred.** Topic names are plain strings taken from the URL today, so
any reachable client can read any topic it can name. Inferring authorisation from a naming
convention is a convention, and conventions are not a security control. A declaration makes the
access rule reviewable at the slice and is the only shape that supports multi-tenant isolation
without a central registry the slice author must consult.

**Why bound rather than just rate-limit.** The token bucket bounds *request rate*, not
*concurrent long-lived streams*, so it cannot bound the topic registry. An explicit bound on
open subscriptions does.

**Alternatives considered.**
- *Require only an authenticated session, keep topics global.* **Rejected**: still cross-tenant
  disclosure in any multi-tenant application, which is the framework's own advertised scenario.
- *Remove the event-stream gateway.* **Rejected**: it is a claimed, shipped capability with a
  real roundtrip test; removing it is a larger product change than securing it.

### D4 — Security headers: strict default, CDN opt-in, one builder

**Decision.** Emit a baseline header set on every response, including static files, error
responses and pre-dispatch failures. Default the CSP to a strict same-origin policy with no
third-party script sources. Flip the CDN switch from "opt out" to "opt in", and rebuild the
policy so that enabling the CDN produces a policy that explicitly permits only the origins the
CDN needs — rather than a blanket `unsafe-inline`/`unsafe-eval` escape hatch.

**Why flip the flag rather than just warn.** The CDN is a runtime JavaScript compiler loaded
without an integrity attribute, executing in an origin that holds a script-readable session
cookie. With no CSP, a compromise or a malicious update of that origin is script execution plus
immediate token exfiltration in every deployed application. A flag whose safe setting is
`true` but whose default is `false` is a documentation incident waiting to happen; the default
must be the safe one.

**Note recorded honestly:** the server-emitted session cookie can be `HttpOnly`; the
browser-side helper cannot set `HttpOnly` (client-side script cannot), so a token written by
`document.cookie` is script-readable by design. This is a stated constraint of the design, not
a defect to be papered over, and the docs must say it plainly.

### D5 — Revocation is consulted at request time behind a short-lived memo

**Decision.** The request path consults the persisted revocation store, memoised in a
time-bounded cache so a normal request does not add a query. Bound the in-memory set with a cap
and a time-to-live, add a `pruned_at` column so the persisted table can be pruned, and treat
per-instance scope as documented behaviour.

**Why memoise rather than query every time.** A revocation check on every request is one
indexed lookup; at the framework's own measured throughput that is real cost for a check that
almost always misses. A short time-to-live bounds the window in which a revoked token still
works, which is the actual requirement.

**Alternatives considered.**
- *Query the store on every request.* **Rejected** for cost, kept as the behaviour when the
  cache is disabled.
- *Keep in-memory only and document it.* **Rejected**: the database-backed revocation API is
  exported and documented as a capability, and a caller who uses it today gets a false promise.

### D6 — Graceful shutdown: await Bun's drain, then close persistence

**Decision.** Await the promise returned by the server's stop call, raced against the configured
drain timeout. Only after the drain resolves (or the deadline passes) close the queue engine and
the database. Report drained and aborted counts on the diagnostic surface. Make shutdown
idempotent. Do not reimplement request accounting — fact 2 shows Bun already drains the HTTP
layer.

**Why this is narrower than the original finding.** The first audit said in-flight requests "are
cut off". The measurement shows the *response* is not cut off. The real defects are that
`drainTimeoutMs` is capped at 200 ms, the drain promise is discarded, and persistence is closed
on that timer. An in-flight request that queries the database after the close fails. The fix is
roughly ten lines and does not need a request counter.

**Why still expose counts.** Without an observable drained/aborted number, "graceful shutdown
works" is the same unfalsifiable claim the repository is trying to eliminate. The counts are what
make the requirement testable.

### D7 — Single source of truth for metadata, plus a doc-drift gate

**Decision.** Version, MCP tool count and feature status live in one machine-readable module
that the `info` command, the health endpoint, the MCP server metadata and the publish rehearsal
all read. Feature status stops being hand-maintained prose. Add a test that compares the numbers
quoted in the agent guide and both READMEs against those machine values and **fails** on drift.
Delete claims that are false rather than softening them.

**Why a gate rather than a convention.** The repository has three different test counts across
three documents, a hardcoded version two releases behind, a tool name that is not registered, and
a feature table that marks 36 of 37 features stable on a project with no adopters. A convention
did not prevent any of these. A test that goes red does.

**Why delete rather than soften.** "Compatible with Drizzle and Kysely" is not a matter of
degree: there is no such code. "Prevents DNS rebinding attacks" is not a matter of degree: the
validated address is discarded. Both are removed, and the specs assert their absence, which is
checkable by search.

### D8 — Coverage honesty: "skipped" must not read as "passed"

**Decision.** Any suite that cannot run its engine reports *skipped*, never *passed*. The
PostgreSQL client and queue suites are gated on a connection string that CI always provides via
the service it already defines. Add a coverage threshold to CI. Delete the tests that assert a
test double's behaviour, assert a third-party package, or assert generated source text in place
of behaviour. Move the only real end-to-end roundtrip into the test command.

**Why skipped-must-not-pass is the load-bearing part.** The PostgreSQL queue engine's entire
suite asserts that substrings appear in the SQL strings the implementation itself emits, recorded
by a fake database. On a machine without a database, "the suite passed" and "nothing was
verified" look identical. That ambiguity is how an untested distributed queue shipped as
`stable`. The distinction has to be in the report, not in a comment.

**Why keep the substring tests at all.** They have real value as change-detectors on the
scaffolder's output contract. They must simply not be counted as behavioural evidence, and the
feature-status table must not cite them as proof of behaviour.

### D9 — OAuth: require a verified email, refuse automatic linking

**Decision.** Generate and validate a CSRF `state` bound to the initiating session. Require a
provider-**verified** email via the provider's verification endpoint, never a synthesised one.
When the verified email matches an existing local row, **refuse** with a distinct error and
require an explicit authenticated linking flow. Replace non-cryptographic identifiers with a
cryptographically strong primitive. Wire the generated UI to the action and persist the session,
matching the sibling password-login template, which is already correct on all of these points.

**Why refuse rather than auto-link.** The template cannot distinguish a verified address from an
unverified one under its current provider call, so any auto-link is a potential takeover that
inherits the victim's roles and is then **permanent**, because the provider-account link is
unique. Refusing is the only behaviour that cannot be wrong. Auto-creating a parallel account
was considered and rejected: it silently produces two identities for one human and turns a
security decision into a support question.

**Why the sibling template is the reference.** It is already correct — decoy hash so a missing
user costs identical time, one indistinguishable error for unknown-user and wrong-password, and
it fails closed rather than minting a forgeable token when the signing secret is missing. The
defect is inconsistency, not a missing house style.

**Why the generated oracle must cover the linking region.** The vulnerable region currently has
zero coverage; the existing oracle exercises only three early configuration guards. Without new
invariant cases, a future edit can reintroduce any of this silently.

### D10 — Supply chain: make the pipeline build what the lockfile says

**Decision.** Install with a frozen lockfile in every workflow, matching the container image
which already does. Pin third-party actions to commit SHAs and pin the toolchain version. Remove
the unpinned run-time-fetched package from the pull-request failure path. Make the release
credential story match its own comment. Fix the scaffolding template's dependency pin, which
currently installs a framework seven minors old — and delete the test that freezes that drift.
Correct the container's ownership so the non-root user can actually create its database, and
stop shipping the whole monorepo into the runtime layer.

**Why the pull-request path is the priority.** An unpinned package executed on every failing
build, including from forks, is the highest-leverage item in this capability. The publish job
holding an `id-token: write` permission with floating action tags is second.

**Non-goal: rebuilding the container from scratch.** Fix ownership, parameterise the served
application directory, add a production install, and stop copying the test suite and examples.
A minimal rebuild is a separate change.

## Risks / Trade-offs

**[A strict default CSP breaks existing applications' styling]** → The framework advertises
theming freedom and ships no CSS pipeline, so applications that relied on the CDN for
`unsafe-inline` styles will lose them. → Ship the CDN switch as an explicit opt-in that
rebuilds a policy permitting exactly the origins it needs, document the migration in the
changelog, and make the opt-in's failure mode a *visible* styling break rather than a silent
one.

**[Rejecting automatic account linking breaks a working GitHub login for some users]** → This
is the intended trade: a silent, permanent, role-inheriting takeover is worse than an
explicit error. → Ship a distinct error code and a documented explicit linking flow.

**[Requiring authentication on the event stream breaks unauthenticated public dashboards]** →
Public dashboards exist and are legitimate. → The declaration primitive supports a
deliberately public topic; the default is undeclared, and refusing to declare is the safe
failure.

**[Consulting revocation at request time adds latency]** → Mitigated by the bounded memo
(D5), with the per-request query as the uncached fallback. The time-to-live is the tunable
that trades revocation window against cost.

**[Rewriting the WebSocket origin check to fail-closed breaks local development]** → With no
allowlist configured, `ws://localhost` from a browser also carries an origin and would be
refused. → A loopback-origin exemption is the one narrow carve-out, and it is explicit rather
than a blanket allow, so the production posture stays closed.

**[Deleting test theater shrinks the test count]** → The suite will get *smaller* while coverage
genuinely increases. Expect the number in the docs to drop and reclassify several features from
`stable`. → This is the intended outcome; the drift gate makes the new number authoritative and
the change log must state that the reduction is deletion of non-evidence, not lost coverage.

**[The doc-drift gate will fail on unrelated doc edits]** → A new feature added to a document
before the machine source is updated turns the gate red. → That is the gate working. Fix by
updating the source of truth, not by widening the gate.

**[`maxRequestBodySize` semantics could change across Bun versions]** → Verified on Bun 1.4.2
only, and a future major could alter or remove the option. → The per-route streaming guards
remain the primary defence and the process cap is explicitly the backstop, so a regression
degrades to today's behaviour rather than to unbounded buffering. Pin the minimum Bun version
that supports it and add a test that asserts the cap is actually enforced, not merely accepted.

**[`impact` currently always exits zero, so a "fix" could change CI behaviour for a script that
relies on it]** → Nothing in CI depends on it today, but external scripts might. → Exit non-zero
only for the "target not found" case, keep the empty-but-valid result at zero, and note the
change in the changelog.

## Migration Plan

Ordered so that the repository is never left in a state where its own gates are red. Each phase
is independently revertible; the breaking changes are the last thing to land, and each is
individually revertible.

**Phase 0 — containment (no breaking change).** Add the shared path-segment validator and apply
it to the scaffolder, the field parser and the new-application command. Fix the field-name
interpolation. Add the error codes to the union. *Gate: the new traversal tests fail before and
pass after; the scaffolder and contract suites stay green.*

**Phase 1 — defence in depth (no breaking change).** Set the process-level body cap. Add the
signed storage `delete`. Add rate limiting to the previously uncovered routes. Harden the image
optimizer. Pin the SSRF fetch to the validated address. *Gate: the abuse-resistance suite is
green; the throughput benchmark is not yet restated, so no number changes here.*

**Phase 2 — fail-closed correctness (mostly non-breaking).** Await the drain promise and fix the
200 ms cap. Stop the tenant fallback. Consult revocation at request time with a memo. Mask
internal errors on all paths and redact paths and credentials. Bound event-stream topics.
*Gate: the graceful-shutdown, session-integrity and http-response-hardening suites are green.*

**Phase 3 — the four breaking changes, one commit each.** (a) Cookie attributes become
secure-by-default. (b) The event stream requires a declared topic and an authenticated
subscriber. (c) The WebSocket upgrade is refused when no allowlist is configured, with a loopback
carve-out. (d) The third-party CDN becomes opt-in and the CSP default becomes strict. Each ships
with a changelog migration note and can be reverted alone. *Gate: `bun run test:all`, the starter
template check, and the publish rehearsal are all green after each individual commit.*

**Phase 4 — claims and evidence.** Introduce the single metadata source, add the doc-drift gate,
reclassify features out of `stable`, delete the false claims, reconcile the published contract
with the upload implementation, and restate the benchmark numbers. *Gate: the drift gate is
green and the numbers in the docs are produced by the scripts they cite.*

**Phase 5 — real usage and coverage.** Add the exercising slices (webhook, job, socket, cache,
metadata, reversible migration), move the end-to-end roundtrip into the test command, add the
real-PostgreSQL suites, add the browser-hook suite, add the coverage threshold, and delete the
theater tests. *Gate: `bun run test:all` green, the rollback command succeeds on a shipped
application, and the framework suite no longer imports example application source.*

**Rollback strategy.** Every phase is a set of ordinary commits on `main` with no data
migration, so reverting a phase is a revert. The two changes that are *not* plain reverts are
the revocation memo (a new nullable column) and the CSP (a cached header on live responses);
both are additive and tolerate the previous code still being present. The cookie default and the
CDN default can each be restored by a single flag change for an operator who needs time — which
is why they are flags and not hardcoded behaviour.

## Open Questions

Two, both deferrable without changing the specs, the approach, or the task breakdown.

- **Where should the bounded revocation memo's time-to-live default sit?** Every value is
  defensible and the spec only requires that it be bounded and configurable. A short window
  favours revocation latency; a long window favours cost. Pick during implementation from the
  first measured latency profile rather than up front, and record the choice in the changelog.
- **Should the per-process state capabilities ship a reference distributed adapter now, or only
  the interface?** The specs require the scope to be declared and the interface to exist, not
  that a distributed implementation be provided. Whether to ship a reference adapter is a
  follow-up decision; it does not gate this change.
