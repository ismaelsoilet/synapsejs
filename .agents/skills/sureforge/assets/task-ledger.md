# Task ledger template

Copy into an authorized task workspace only when a durable record is useful. This is an unfilled template, not evidence that any work passed. Replace `unrecorded` and `unanswered` with actual observations or explicitly retain them as gaps. Do not save private task records inside the installed skill or a public repository.

## State

| Field | Current value |
| --- | --- |
| Task ID | unrecorded |
| Owner | unrecorded |
| Tier and reason | unrecorded |
| Current phase / gate instance / round | unrecorded |
| Gate decision and reason | BLOCKED: contract not yet recorded |
| Contract version | unrecorded |
| Artifact snapshot and included paths | unrecorded |
| Environment and input identities | unrecorded |
| Next authorized action | unrecorded |
| Resume validation time | unrecorded |

## Contract and understanding memo

| Field | Current value |
| --- | --- |
| Original request reference | unrecorded |
| Intended outcome and recipient | unrecorded |
| Deliverables | unrecorded |
| Acceptance criteria and IDs | unrecorded |
| Approved amendments / superseded criteria | unrecorded |
| Scope and exclusions | unrecorded |
| Inspection units and required environment/state matrix | unrecorded |
| Permissions: changes, delegation, network/data sharing, spending, publishing | unrecorded |
| Available tools and missing capabilities | unrecorded |
| Time, token/cost, review, and tool budgets | unrecorded |
| Observed use, including failed attempts | unrecorded |
| Risks, assumptions, stop/recovery conditions | unrecorded |
| Research evidence and freshness limits | unrecorded |
| Three-perspective conclusions | unrecorded |
| Research-before-questions exception, if any | unrecorded |

## Decision log

For each question or proposal, record an ID, relevant evidence, options, recommendation, dependency on other decisions, actual user response, approved outcome, authority/scope effect, and superseded decision ID. Initial status is `unanswered`. A proposal, skip, rejection, or timeout is not approval.

## Plan and acceptance mapping

For each acceptance criterion, record its ID, output, implementation step, dependencies, inspection units, environment, planned method/oracle, required approval, and evidence ID when checked. Mark criteria not yet verified explicitly. Include the ordered plan and owner of each permitted separable research/review task.

## Change log

For each material change, record the old and new snapshot, affected requirements/components/environments/assumptions, invalidated evidence, impacted coverage rows and gates, repair reason, and applicable regression checks. A material scope change needs a referenced user decision. Version changes do not reset round counters.

## Evidence register

For each evidence ID, record role, method, failure target, procedure, oracle, actual result, unit/check/environment scope, artifact snapshot, contract version, dependencies, observed time, and a reproducible locator. Distinguish fresh checks from reused evidence. For reuse, preserve the original result, snapshot and time, and add the applicability check, date, rationale, and new target snapshot. Unknown impact requires rechecking.

## Coverage ledger

Use the companion CSV header as a machine-readable option. Each row represents one requirement/unit/check/environment/role combination. `required` is `true` or `false`; exclusions need authority in the decision log. Allowed status values are `fresh`, `reused`, `failed`, `missing`, and `blocked`. Record `result` separately as `pass`, `fail`, or `unverified`. Only applicable `fresh` or `reused` evidence with a supported `pass` satisfies a required row. Empty fields are gaps, never passes.

Keep owner and reviewer scope identifiable. Reviewer coverage must be established by the reviewer. Report the required denominator and all missing rows; a percentage is not a substitute for the inventory.

## Findings and resolution

For each finding, record ID, source, severity/materiality, location, criterion, observation, reproduction, classification, counterevidence if any, canonical ID for duplicates, scope decision for exclusions, repair snapshot, and closure verification. Classification is one of `confirmed`, `refuted-with-evidence`, `unresolved`, `duplicate`, or `out-of-scope`. Material unresolved findings remain blocking. For a deferred confirmed non-material finding, retain its classification and record the authorizing decision, reason, follow-up, and disclosure; deferral is not a verified repair.

## Gate history

For each gate instance and round, record the frozen snapshot, contract, tier, owner methods and evidence, reviewer identity/context controls/methods/coverage, critic involvement, triage results, approval references, resource use, and READY/REPAIR/BLOCKED with a reason. Maximum three rounds per gate. Do not erase earlier failed or blocked evaluations.

## Delivery or pause report

State the artifact identity, entry point, acceptance results, coverage denominator and omissions, performed/reused checks, review status, unverified properties, residual risks, resource measurements or unknowns, needed approvals, and next action. A review draft is not accepted delivery. On resume, validate this state against actual artifact and environment identities before continuing.
