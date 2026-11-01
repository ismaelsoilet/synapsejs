# Review triage — round 1 (SureForge Standard)

## Reviewer methods and coverage

A fresh-context reviewer inspected the complete change (proposal, 8 specs, design, tasks, memo,
recommendations, ledger) and the working tree at commit `01d43e7` + 28 tracked modifications + 7
untracked files. It performed four methods:

1. Bidirectional traceability (44 requirements / 93 scenarios / 64 tasks / 46 ledger rows).
2. Feasibility/dependency dry run against source files, scripts and real commands.
3. Premortem/honesty audit of the gates, evidence and unfalsifiable clauses.
4. Cross-artifact consistency diff of decisions, thresholds, counts and files.

It ran `openspec validate --strict` (valid, exit 0), `bun test packages/synapse/test` without env
(559 pass / 6 skip / 13 fail + 1 error) and with `NODE_ENV=test` (570 / 6 / 2 + 1 error),
`browser-hooks` in isolation (0/4 without env, 4/4 with `NODE_ENV=test`), and
`docs-claims + mcp-server` (23 pass). It did not run the PostgreSQL, Docker, browser or
publish-rehearsal gates. Reviewer verdict: **REPAIR** (not BLOCKED; all gaps are repairable in the
plan).

## Material findings

| ID | Classification | Finding | Repair applied |
| --- | --- | --- | --- |
| M-01 | confirmed | Setting `NODE_ENV=test` in the preload fixes `act` but leaves duration-sensitive tests (SSR micro-cache at 4.7–6.3 s vs 5 s timeout) red. | RGI spec now requires no failures **and no errors**, repeated runs under load; tasks 2.1/2.2 add timeout stabilization and two consecutive green runs. |
| M-02 | confirmed | `scripts/docs-check.ts` and `scripts/coverage-check.ts` spawn the suite with `NODE_ENV: process.env.NODE_ENV ?? 'development'`; `run-gates.sh`'s `env -u NODE_ENV` is undone one level down. | `release-gate-integrity` now requires the gate scripts to pass the ambient environment through unchanged; task 3.5 removes the injection and adds a regression test on the child env. |
| M-03 | confirmed | The baseline count was hard-coded (563/6/9) but is not reproducible; the reviewer measured 559/6/13 + 1 error. | Task 1.1 now records actual totals, failing names, wall-clock and the `error` category; the spec distinguishes pass/skip/fail/error. |
| M-04 | confirmed | Four artifacts defined four different blocking-decision sets; D1/D3/D7 were breaking and non-blocking. | `audit-and-decisions.md` now has one authoritative **Blocking decisions** list (D1, D3, D4, D5, D6, D7, D10); design and tasks reference it. |
| M-05 | confirmed | Specs pinned volatile counts (572/6, 578/71, 67 warnings) that the change itself invalidates. | RGI/DAC scenarios now say the documents must state the totals the suite/linter actually reports, with pass/skip/error separated; literals remain examples only. |
| M-06 | confirmed | Task 11.1 used a hand-rolled gate list that omitted `coverage:check` and repo-map drift, and included `bench`/`impact` without the right context. | Task 11.1 now uses `bash scripts/run-gates.sh --with-docker` plus explicit `db-drift`/`impact` checks; `run-gates.sh`/`RELEASE-CHECKLIST.md` are the single gate inventory. |
| M-07 | confirmed | “A failure blocks the merge” is a hosting/branch-protection setting, not a file the repo controls. | RGI scenario now asserts a failing run is red for the pushed commit; task 3.6 records the required-check configuration as evidence or an explicit decision. |
| M-08 | confirmed | The release evidence was self-certified: the author writes and checks the same file. | RGI adds a requirement for an executable verifier; task 9.7 adds `scripts/verify-release-evidence.ts` (re-runs commands, checks the commit). |
| M-09 | confirmed | Three different large-slice thresholds: spec 500, design “guide 450 with a difference”, task “align to guide”. | The guide is corrected to 500; code stays `> 500`; the spec scenario is 501/500; D7/task 8.5 now say 500. |
| M-10 | **partially refuted** | The reviewer claimed `aggregate` “does not aggregate on any engine”. False for SQLite/PostgreSQL: `aggregate` delegates to `findMany`, which compiles `aggregations` and `groupBy`; the query-builder test passes. Accurate parts: `MockDatabaseClient.aggregate` ignores aggregation, and `exists` uses `COUNT(*)`. | Evidence table now records the accurate findings; DQP spec/tasks keep the mock/`exists` fixes and do not “fix” the working real-client path. |

## Non-material findings

| ID | Classification | Action |
| --- | --- | --- |
| N-01 | confirmed | `docs-check` must exclude historical changelog sections before `CHANGELOG.md` is added; task 3.2 includes history-exclusion rules. |
| N-02 | confirmed | Added `requirement-map.csv` mapping every ledger ID to its capability, spec path, requirement heading and task IDs. |
| N-03 | confirmed | Ledger gains PostgreSQL rows for DQP, SJS and a browser/air-gapped row for DSS; SOI login oracle is keyed to the oracle runner, not e2e. |
| N-04 | confirmed | Design converts CSS precedence and release-evidence path to decisions; only the OAuth timeout remains open. |
| N-05 | confirmed | Design context now counts 28 tracked + 7 untracked; task 1.0 inventories and stages the untracked files before the baseline. |
| N-06 | confirmed | Task 1.3 is now “reconcile the existing ledger and requirement map”, not “create the ledger”. |
| N-07 | confirmed | AUI pins error boundary default-on; SOI pins permissions in the token, makes claim rejection observable, and replaces the tautological admin-bypass scenario with concrete default/disabled cases. |
| N-08 | confirmed | Memo records 636 = 572 framework pass + 57 oracle cases + 7 e2e; the 6 framework skips are separate, and 578 is the total test count. |
| N-09 | confirmed | Task 10.6 adds a lockfile/TS-resolution drift check that must produce `COMPILER_API_UNAVAILABLE` before publish. |
| N-10 | confirmed | Memo corrected: `README.md:16,399,419` and `README.pt-BR.md:16,420` still say 18 tools; the plan covers both READMEs. |
| N-11 | confirmed | DAC/9.3 now covers the “568 Passing (100%)” / “100% Green Gates” badges explicitly. |
| N-12 | confirmed | Task 1.0 adds a wave → files → requirement inventory; waves 5/6/8 are named. |

## Reused evidence and limits

- The reviewer's command outputs are fresh for this workspace but were run before the repairs; the
  repairs are document-only, so they do not invalidate the source facts.
- PostgreSQL, Docker, real browser and publish rehearsal were not executed; the plan treats them as
  required evidence in groups 10/11, not as already verified.
- The reviewer is a fresh context but the same model and workspace; this is disclosed as reduced
  independence, not a claim of statistical independence.

## Round 2 (targeted re-check)

A second fresh-context reviewer verified only the repairs. Result: **7 of 10 material findings
fully repaired** (M-01, M-05, M-06, M-07, M-08, M-09, M-10), **M-02/M-03/M-04 partially**, and
**N-02 not repaired**. New findings:

- **NF-01 (material):** the ledger's `requirement_id` namespace did not join to `requirement-map.csv`.
- **NF-02 (material):** M-02 had a task but no requirement/scenario; `review-triage.md` claimed one existed.
- **NF-03 (material-low):** `design.md` still said execution was blocked on “D1–D3”, contradicting the authoritative seven.
- **NF-04..NF-11 (minor):** contract version mismatch (v2 vs v1), ledger rows had 19 fields vs a 20-column header, three map headings did not match the specs, prose still froze “9 testes”, the guide still said 450, the next action pointed at group 2, and 17 cross-cutting tasks were not in the map.

Repairs applied after round 2:

- Added `RGI-08` (“Gate scripts preserve the ambient environment”) with two scenarios and mapped it to task 3.5.
- Re-keyed all 57 ledger rows to the `requirement-map.csv` IDs, fixed the 20-field shape, set
  `contract_version` to v3, and added the RGI-GATES row; the join now covers all 46 requirements.
- Removed the stale “D1–D3” sentence from `design.md`; the authoritative list is the seven
  blocking decisions in `audit-and-decisions.md`.
- Corrected the README tool-count line, the “9 testes” prose in proposal/recommendations, the
  guide threshold wording (code 500, guide changes to 500), and the next-action ordering
  (group 1 baseline before group 2).
- Added a note that the map lists primary tasks while `tasks.md` is the full 72-task inventory.

**Round 3:** a final targeted check confirmed NF-02, NF-03 and all five minor repairs; NF-01's join
and heading checks pass (57 rows, 20 fields, 46/46 requirements, 0 orphans), but it found the ledger
still carried `contract_version=v2`. That one column was corrected to **v3** on all 57 rows and
verified mechanically (57/57 v3, 20 fields, 46/46 join, OpenSpec strict valid). No new review round
is allowed after round 3; the residual risk is limited to that one-column data edit. Execution
remains blocked by the authoritative blocking decisions until the maintainer answers them.
