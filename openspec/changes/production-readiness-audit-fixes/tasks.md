# Tasks

Ordered by the six-phase migration plan in `design.md`, so the repository's own gates are never
left red. Each group lands the tests and documentation its own work calls for.

**Recorded assumptions** (from `design.md` § Open Questions — both are deferrable and change
neither the specs nor the approach; recorded here so they are not baked in silently):

- The revocation memo's time-to-live ships with a documented default chosen from the first
  measured latency profile, and is recorded in `CHANGELOG.md`. It must be bounded and
  configurable; the specific value is not fixed by this task list.
- A reference distributed adapter for the per-process state is **out of scope**; this change
  ships the declared scope and the pluggable interface only.

**Global gate for every group:** `bun run test:all`, `bun run check`, `bun run check:template`
and `bun run split` stay green, and `git status` shows no modification to any file outside the
group's stated scope.

## 1. Phase 0 — Write-path containment

- [x] 1.1 Add one exported path-segment validator in `core/` that rejects separators, parent
      traversal, absolute prefixes, empty segments and over-length segments, and a post-join
      containment assertion that the resolved target stays inside the resolved base. Verify: a
      new unit test file asserts each rejection class and a positive case, and passes
- [x] 1.2 Apply the validator to slice scaffolding on **both** unvalidated segments (the domain
      and the slice name), and assert post-join containment against the resolved slices
      directory. Verify: `synapse new-slice ../../../../tmp pwn` and
      `synapse new-slice billing ../../../outside/pwn` both return the new error, write nothing
      outside the app root, and the existing scaffolder suite stays green
- [x] 1.3 Apply the validator to shared-module scaffolding, the CRUD-scaffold path and the
      new-application command's target directory. Verify: each traversal attempt is refused, no
      directory or file is created outside the intended root, and `synapse new` into a normal
      name still works
- [x] 1.4 Validate field-grammar names before they are interpolated into generated DDL and
      generated TypeScript source, rejecting anything that is not a plain identifier. Verify: a
      crafted field name carrying a statement terminator is refused with the new error, and the
      generated slice for a valid field list still contains the expected column and property
- [x] 1.5 Add the new failure codes to the scaffolding error-code union, and surface every
      containment failure on **standard output** as JSON with a non-zero exit — including the
      new-slice path, which today writes its JSON failure to standard error while its own
      template error goes to standard output. Verify: a CLI contract test asserts the machine
      consumer can parse the failure from standard output alone
- [x] 1.6 Reconcile the public error-code surfaces: the machine-readable contract, the agent
      guide's failure-code list and the package README all name the new codes. Verify: the
      contract test asserts the new codes are present and consistent across all three
- [x] 1.7 Stop preserving the client-declared upload extension without inspecting bytes: either
      sniff the type or reject with an explicit unsupported-type error, and stop echoing the
      filesystem error message to the client. Verify: an upload test asserts a mismatched
      declared type is rejected and that a 500 response body contains no absolute path
- [x] 1.8 Document the write-surface containment rules in `AGENTS.md` §4 and the package README,
      including the new failure codes. Verify: a search for each new code finds all documented
      occurrences, and the docs test introduced in group 9 is green for this group's claims

## 2. Phase 1 — Defence in depth (no breaking change)

- [x] 2.1 Set a process-level maximum request body size on the HTTP server, using the option
      verified to enforce on the current Bun version. Verify: an integration test asserts an
      oversized body is rejected with 413 **through the running server** — not merely that the
      option was accepted — and that a body under the cap still succeeds
- [x] 2.2 Fix the upload declared-length pre-check to use the same idiom as the RPC and webhook
      paths, where an absent header yields "unknown" and the pre-check is deliberately skipped
      in favour of the streaming guard. Verify: a chunked upload with no declared length and a
      body over the cap is rejected 413, and the existing declared-length test still passes
- [x] 2.3 Add a streaming size guard to the multipart upload branch so the form parser is never
      reached with an unbounded body, and set an explicit maximum for the request-level body
      size. Verify: an upload test sends a multipart body with no declared length exceeding the
      cap and asserts 413 plus that the form parser was never invoked
- [x] 2.4 Move the post-parse size check so it cannot report success on an over-limit body, and
      keep the single-instance file on disk exactly once. Verify: an existing multipart
      over-limit test and a new raw-bytes over-limit test both assert 413
- [x] 2.5 Reconcile the three conflicting statements about multipart parsing — the public
      machine-readable contract sentence, the module docstring, and the implementation — so all
      three say the same thing. Verify: the contract test asserts the **sentence**, not only the
      route address
- [x] 2.6 Bring the previously uncovered routes under the rate limiter: the remote-image
      endpoint, the health endpoint, the metrics endpoint, the repository-map endpoint and
      server-side page renders. Verify: a test asserts 429 with all four rate-limit response
      headers from each previously uncovered prefix
- [x] 2.7 Make proxy-header trust **opt-in** rather than opt-out, and only honour a forwarded
      address when it is explicitly enabled. Verify: a test asserts that with trust disabled a
      rotated forwarded-for header does not create a new bucket, and a second asserts the
      opposite when trust is enabled
- [x] 2.8 Stop evicting legitimate users' allowance when the bucket registry is full: bound
      memory without dropping live counters, and never let spoofed identities flush a real
      user's allowance. Verify: a test fills the registry with synthetic identities, asserts a
      pre-existing real identity still has its allowance, and asserts the process stays within
      its memory bound
- [x] 2.9 Bound and authorise the remote-image endpoint: require a session, subject it to the
      rate limiter, cap the response size, apply a request timeout, and stop defaulting the
      allowed-host list to permitting any public host. Verify: a test asserts 401 when
      anonymous, 429 when over the limit, 413 on an oversized upstream, and that a host outside
      the configured list is refused
- [x] 2.10 Pin the actual request to the address that passed external-URL validation, so the
      host is not resolved a second time, or fail closed if pinning is not achievable.
      Verify: a test asserts a host whose second resolution points at a private or metadata
      address is still refused, and the security test for the metadata address still passes
- [x] 2.11 Sign the object-storage adapter's delete request with the same request-signing
      routine the upload and presign paths already use. Verify: a signature test asserts the
      delete request carries an authorization header, and is extended to compare against a
      known-answer vector so it can distinguish a real keyed hash from a fabricated string
- [x] 2.12 Replace the quadratic-backtracking patterns in the split leak detector and the
      database-schema generator with linear equivalents, verified against a large input.
      Verify: a test asserts each pattern completes within a time bound on a large synthetic
      input, and the existing leak-gate and schema-generator suites stay green
- [x] 2.13 Update the agent guide and the package README to state the per-process scope of the
      rate limiter, the server-side micro-cache and the event hub explicitly, replacing any
      wording that implies cluster-wide behaviour. Verify: the docs test from group 9 is green
      and a search finds no remaining cluster-wide claim

## 3. Phase 2 — Fail-closed correctness

- [x] 3.1 Await the promise returned by the server's stop call, raced against the configured
      drain timeout, instead of discarding it and sleeping for a hardcoded 200 ms. Verify: a
      test starts a request that completes after the old 200 ms cap, shuts down with a longer
      configured timeout, and asserts the response was delivered in full
- [x] 3.2 Close the queue engine and the database only after the drain resolves or the deadline
      passes, never on a fixed timer. Verify: a test starts a request that queries the database
      after 300 ms, shuts down with a timeout above that, and asserts the request succeeds
- [x] 3.3 Expose drained and aborted in-flight counts on the diagnostic surface and make
      shutdown idempotent, so a second signal does not double-close or corrupt state. Verify: a
      test asserts the counts are reported and that two consecutive shutdown calls are safe
- [x] 3.4 Stop the queue engine from claiming new work at the start of shutdown, leave pending
      jobs intact, and return an interrupted job to the queue with its attempt counter advanced
      exactly once. Verify: a queue test asserts a job in flight survives as pending and that
      the counter increments once, not twice
- [x] 3.5 Derive the tenant **only** from a cryptographically verified token when a session
      secret is configured, removing the fallback to the tenant header and to the subdomain.
      Verify: a test sends a validly signed token that carries no tenant claim together with a
      spoofed tenant header, and asserts the derived tenant does **not** become the spoofed
      value
- [x] 3.6 Consult the persisted revocation store during request authentication, memoised behind
      a bounded, configurable time-to-live, with the uncached per-request check as the fallback.
      Verify: a test revokes a token through the database API, then asserts the next request is
      rejected — this is the assertion that currently fails against the shipped code
- [x] 3.7 Bound the in-memory revocation set with a cap and a time-to-live, add pruning, and
      give the persisted table a column that makes rows expirable. Verify: a test generates
      more revocations than the cap and asserts the set stays bounded and that expired entries
      are pruned
- [x] 3.8 Make production-without-a-session-secret fail closed at the request layer on **any**
      value that is not an explicit development opt-in, not only the literal production string,
      so unset, staging and near-miss values all resolve to anonymous. Verify: a table-driven
      test over several environment values asserts header-supplied identity is ignored in each
- [x] 3.9 Refuse to start, or require an explicit acknowledgement, when a production deployment
      has no session secret — today it only prints a warning and starts. Verify: a test asserts
      the refusal and that the acknowledgement path proceeds
- [x] 3.10 Mask internal error detail on **every** path, not only server-side rendering: the
      remote-procedure-call, webhook, upload and image endpoints must not return the underlying
      error message in production, while retaining it in the server log. Verify: a test drives a
      failing action over HTTP with production settings and asserts the response body contains
      neither the driver message nor a stack
- [x] 3.11 Emit a baseline security response header set on every response — including static
      files, error responses and pre-dispatch failures — and add a test that walks the response
      space asserting the set is present everywhere. Verify: the test enumerates the success,
      not-found, method-not-allowed, rate-limited, unauthorized and server-error paths and
      asserts the headers on each
- [x] 3.12 Introduce a topic-declaration primitive: refuse subscription to an undeclared topic,
      enforce a declared required role, namespace topics by tenant, and refuse publishing into a
      topic a slice does not own. Verify: a test asserts 401 unauthenticated, 404 undeclared,
      403 wrong role, refusal of cross-tenant subscription with the same topic name, and refusal
      of cross-owner publishing
- [x] 3.13 Bound both the registered-topic count and concurrent open subscriptions, returning 429
      with a retry hint when the bound is hit, and release a subscription on disconnect or abort.
      Verify: a test opens subscriptions past the bound and asserts 429 plus that the registry
      returns to its prior size after the clients disconnect
- [x] 3.14 Make the WebSocket origin check **fail-closed** when no allowlist is configured,
      refusing an absent and an opaque origin too, with an explicit loopback carve-out for local
      development. Verify: a table-driven test asserts the upgrade is refused for each untrusted
      origin case and permitted for loopback
- [x] 3.15 Add a per-client cap on concurrent realtime connections so a long-lived stream cannot
      bypass the token bucket. Verify: a test opens connections past the cap from one identity
      and asserts the excess is refused with a retry hint
- [x] 3.16 Document the realtime authorisation model, the tenant namespacing rule, the
      per-process scope and the fail-closed upgrade posture in the agent guide and the package
      README. Verify: the docs test from group 9 is green for this group's claims

## 4. Phase 3 — The four breaking changes, one commit each

- [x] 4.1 Make secure cookie attributes the **default** in the cookie serialiser, with an
      explicit per-call opt-out. Verify: a test asserts the default output carries all three
      attributes **without passing the flags** — the assertion must not supply the options it is
      testing, and an existing test that passes them explicitly must be tightened accordingly
- [x] 4.2 Require an authenticated subscriber and a declared topic on the event stream, with a
      deliberately public topic as the opt-in. Verify: a test asserts an anonymous subscriber is
      refused and that a topic declared public is reachable
- [x] 4.3 Make the third-party script and font origins **opt-in**, inverting the current
      default, and rebuild the content-security policy so enabling them permits exactly the
      origins required instead of blanket unsafe directives. Verify: a test asserts the default
      response has no third-party script source, and that the opt-in produces a policy naming
      only the intended origins with no blanket escape hatch
- [x] 4.4 State plainly, in the agent guide and the package README, that a token written by
      browser script is script-readable by design and that only the server-emitted cookie can
      carry the protected flag. Verify: the docs test from group 9 is green and the
      contradictory automatic-cookie claim is gone
- [x] 4.5 Write a `CHANGELOG.md` migration note for each of the four breaking changes, each
      stating the previous behaviour, the new behaviour, and the flag that restores the old
      behaviour where one exists. Verify: a test asserts the changelog contains a migration note
      for each breaking change, and the publish rehearsal passes

## 5. Phase 4 — Claims and evidence

- [x] 5.1 Move version, tool count and feature status into one machine-readable module, and
      make the `info` command, the health endpoint, the MCP server metadata and the publish
      rehearsal all read it — removing the hardcoded version. Verify: a test asserts every
      surface reports the same value as the package manifest, and that a deliberate mismatch
      fails
- [x] 5.2 Replace the hand-maintained tool count with the registered tool list, so the count
      cannot drift. Verify: a test asserts the reported count equals the number of registered
      tools and that every documented name is registered
- [x] 5.3 Add a doc-drift gate that compares the test count, the file count, the tool count and
      the version quoted in the agent guide and both READMEs against the machine values, failing
      on any mismatch, and wire it into CI. Verify: deliberately corrupting a number in a
      document makes the gate fail, and restoring it makes the gate pass
- [x] 5.4 Add a gate that asserts every feature marked `stable` in the status table cites
      evidence that would fail if that feature broke, and reclassify every feature that is a
      stub, untested, or contradicted by its own code. Verify: the gate fails when a feature is
      marked stable while citing evidence that does not exercise it
- [x] 5.5 Delete the claims that are false rather than softening them: the query-builder
      compatibility claim for libraries with no corresponding code, the protection claim for
      dynamic-address resolution the code does not prevent, the still-unpublished status, the
      never-executed release claim, and the documented tool name that is not the registered
      one. Verify: a test asserts the absence of each removed claim
- [x] 5.6 Correct the docstrings and comments that the code contradicts, including the module
      docstring about stopping reads at the limit, the leak-gate comment about dynamic-address
      resolution, and the config loader's silent fallback to empty configuration when loading
      fails — which currently applies security-relevant defaults with only a warning. Verify: a
      test asserts a broken configuration file is fatal rather than silently degraded
- [x] 5.7 Make impact analysis report a non-existent target as a failure with a non-zero exit
      instead of a successful empty result, while keeping the valid-but-empty result at zero.
      Verify: a test asserts a non-existent target fails and a valid target with no dependents
      still succeeds
- [x] 5.8 Make the failure-code contract uniform: reject unrecognised flags on **every**
      subcommand that takes arguments, not only the one that currently does, and make the
      current two different length-check idioms consistent. Verify: a table-driven test asserts
      an unknown flag is rejected on each subcommand
- [x] 5.9 Make the concurrency benchmark boot a server that has actually discovered its slices
      and measure a route that does real work, and split the load generator into a separate
      process. Verify: the benchmark output reports a non-zero slice count and its own
      documentation states what it does and does not measure
- [x] 5.10 Restate or remove the throughput and context-surface numbers quoted in the documents
      so each is reproducible by running the script it cites, and label the two
      non-comparable benchmark columns as such while attributing the quoted reduction to the
      comparable one. Verify: a test asserts every headline number in the documents appears in
      the cited script's current output
- [x] 5.11 Bring the documented linter result in line with reality, including the
      currently-hidden diagnostics, or state that the count is a floor. Verify: the doc-drift
      gate from 5.3 covers this number
- [x] 5.12 Fix the dead documentation link and the stale badge, and derive the badge values from
      the machine source rather than hand-editing them. Verify: a link check over the documents
      finds no broken relative target, and the badge values match the machine values

## 6. Phase 5 — Real usage and coverage

- [x] 6.1 Add a committed slice exercising a webhook with signature validation, and a
      constant-time comparison helper with a replay window, since the endpoint currently has no
      secret, no verification and no replay protection and its path is enumerable from the
      health endpoint. Verify: an end-to-end test sends a valid signature, an invalid
      signature and a replayed signature, and asserts the three outcomes differ
- [x] 6.2 Stop the health endpoint from publishing the full route and procedure-call table to
      unauthenticated callers, and redact absolute paths and internal error text from it.
      Verify: an unauthenticated request asserts the table and the absolute paths are absent
      while the slice count is still reported
- [x] 6.3 Add a committed slice exercising a background job end to end, and a slice exercising
      a websocket definition, and a slice exercising a cache definition with stale-while-
      revalidate. Verify: each slice passes the split gates with zero leaks and its oracle
      exercises the real code path
- [x] 6.4 Add a committed slice exercising server-side metadata generation, and declare a
      reversible migration block in at least one shipped slice so the rollback command becomes
      demonstrable. Verify: `synapse rollback` on a shipped application succeeds and reports a
      non-zero rolled-back statement count, which currently fails with zero
- [x] 6.5 Cap the context and payload on the model-context-protocol diagnostics and
      procedure-call tools so a broken workspace cannot flood the caller's context, and redact
      absolute paths from tool output. Verify: a test invokes each tool against a workspace with
      many diagnostics and asserts the output is bounded and path-free
- [x] 6.6 Move the end-to-end roundtrip — request, server-side render, procedure call, real
      database write, role rejection — from a loose example script into the test command, and
      assert with the test framework rather than hand-rolled checks. Verify: the roundtrip runs
      as part of the main suite and fails when a slice's write is removed
- [x] 6.7 Add real-engine coverage for the PostgreSQL client, which currently has none, gated so
      that an absent engine reports **skipped** rather than passed. Verify: with no connection
      configured the suite reports skipped; with one configured it runs and fails on a
      deliberate regression
- [x] 6.8 Add real-engine coverage for the PostgreSQL queue engine, replacing the current suite
      that asserts substrings of the implementation's own SQL recorded by a fake database —
      covering the claim-locking path, backoff, and the dead-letter path, none of which has ever
      executed against an engine. Verify: the dead-letter test asserts a real dead-letter row
      exists, which no current test can do
- [x] 6.9 Add real-engine coverage for the distributed event hub's persistent listener and
      payload-offload path, which is currently untested because only the in-process path is
      exercised. Verify: a test asserts a publish on one instance reaches a subscriber on
      another, and that an oversized payload is offloaded
- [x] 6.10 Add browser-side tests for the action hook, the subscription hook and the websocket
      hook, all of which have zero coverage — and delete the test named after the action hook
      that exercises a function defined inside its own body. Verify: the new tests import the
      real implementation and fail when it breaks; the self-referential test is gone
- [x] 6.11 Add a real hydration test that mounts the layout tree and asserts no mismatch, and a
      real image-pipeline test that exercises the resize and conversion path, which currently
      runs only against a stub because the conversion dependency is absent. Verify: both tests
      fail when the corresponding behaviour regresses
- [x] 6.12 Delete the tests that assert a test double's behaviour or a third-party package's
      functions, and reclassify any feature whose only evidence was a generated-source substring
      assertion. Verify: a search finds no test importing the third-party gating functions for
      their own sake, and the status table no longer cites them as behavioural evidence
- [x] 6.13 Collect coverage in CI, set a threshold, and decouple the framework suite from the
      example applications by replacing the relative-path imports with fixtures the framework
      owns. Verify: the coverage gate fails below the threshold, and editing an example
      application no longer affects the framework suite
- [x] 6.14 Make the suite non-fragile: remove the two hardcoded ports and their polling loop,
      restore mutated environment state after every test, remove the sleeps with 10 to 50 ms
      margins, and give the upload tests a per-run temporary directory. Verify: the suite passes
      repeatedly in a single run and the fixed-port assertions are gone
- [x] 6.15 Report the feature-status table from the machine source in the agent guide, the
      READMEs and the `info` command, so the three cannot diverge, and state plainly the
      adoption evidence that does **not** yet exist. Verify: the doc-drift gate from 5.3 covers
      the table, and the number of `stable` features has fallen with an explanation in the
      changelog

## 7. Integration verification

- [x] 7.1 Run the full gate set — the framework suite, both READMEs' claims check, the whole-
      repository typecheck, the starter template as a consumer, the repository-map drift gate,
      the split gates for all applications, the slice oracles, the adoption application's own
      suite, the live end-to-end suite and the publish rehearsal — and verify every one is green
- [x] 7.2 Verify the negative cases that the audit depends on: a directory with no slices still
      fails with the no-slices failure code, the deliberately leaky fixture still trips the leak
      gate, an unknown subcommand still fails, and a malformed configuration now fails loudly
      instead of degrading
- [x] 7.3 Confirm the container image starts under its own defaults as the non-root user,
      creates its database, and serves a request — the shipped defaults are currently unlikely
      to start. Verify: build and run the image, then request the health endpoint from inside
- [x] 7.4 Re-run the audit's own measurement steps end to end and record the before-and-after
      values: test count and composition, security headers present on every response, guarded
      versus unguarded body readers, covered versus uncovered routes, the number of features
      marked stable, and the number of claimed features with a behavioural test. Verify: the
      recorded table shows no regression on any previously-green number
- [x] 7.5 Update `CHANGELOG.md` with the security section: each fixed class of defect, its
      severity, and the regression test that now fails if it returns, so the fix and its evidence
      are reviewable together. Verify: every entry in the section names a test file, and that
      test exists
