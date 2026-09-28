# Review protocol

Read before the first substantive gate or independent review. A gate is a decision backed by evidence; this text does not technically prevent an agent from ignoring it.

## Roles and authority

The **owner** maintains the contract, controls sequential implementation, performs self-checks, investigates findings, and records gate decisions. The **reviewer** independently inspects a frozen artifact against the current contract. The **critic** examines a high-risk decision, material disagreement, or questionable review when needed. The user retains authority over scope, permissions, budget, and acceptance changes.

Use real host controls to limit reviewer writes, network access, private data exposure, and further delegation where available. A `read-only` label or a prompt saying "do not write" is not a security boundary. If enforceable isolation is absent, disclose that limitation and use only an approved workspace/data scope. Never obtain credentials, change controls, or launch another provider merely to create apparent independence.

## What counts as independent review

Use a fresh context that has not inherited the owner's conversation or self-evaluation. Verify the host's actual behavior. New context reduces shared history; it does not guarantee statistical independence, especially with the same model or shared project instructions.

Supply a neutral package containing:

- The artifact and immutable snapshot identity.
- The original request and the latest approved contract.
- Approved decisions and supersessions, including required permissions.
- The approved plan when it is the reviewed material or a necessary reference.
- The agreed inventory, required environments, acceptance criteria, and neutral inputs/sources needed to reproduce checks.
- The phase, tier, allowed tools, budget, and reporting requirements.

Withhold the owner's defense, self-rating, predicted verdict, and selected verification methods/conclusions before the initial independent method selection and inspection. Do not withhold relevant source material, the plan under review, known safety hazards, or required test inputs. If a material limitation or safety issue must be disclosed, state it neutrally rather than concealing it for blindness.

The reviewer must not load author audit reports or inherited session transcripts just because they are nearby. If isolation is contaminated, record it and restart in a clean authorized context when required. A separate paragraph written by the owner in the same context is self-review, not an independent reviewer.

## Choose genuinely different methods

A method specifies a failure target, a procedure, the material/units inspected, an oracle or comparison, and resulting evidence. Rewording a checklist, repeating a prompt, or using three agent names is not three methods.

In full mode, the owner performs three complementary methods at each gate, then the reviewer independently selects and performs three methods. In standard mode, the owner performs at least two methods per gate; a required reviewer in standard or light mode performs at least one meaningful method covering its complete agreed review scope. These are minimums, not a reason to omit a needed check.

The reviewer is not assigned the owner's methods and is not required to avoid every method the owner happened to choose. Overlap across roles can be legitimate; superficial duplication within one role does not satisfy the requirement. Methods may share an authoritative oracle, such as the same contract, while targeting different failure modes with different procedures. Do not invent different oracles solely to fill a quota.

Do not demand defects, disagreement, praise, or an approval rate. A reviewer may find no defects if it reports real inspection and coverage. A verdict with no methods, evidence, or coverage is an incomplete review, not permission to proceed.

When three meaningful methods cannot be performed, state that limitation. Do not count unperformed or inapplicable checks to reach the number. Request access, specialist review, or a recorded assurance change.

## Evidence records

Give each evidence record a stable ID. Record:

| Field | Meaning |
| --- | --- |
| Artifact identity | Snapshot/manifest hash or equivalent immutable identifier, plus included paths. |
| Contract and gate | Current contract version, phase, gate instance, round, and approval references. |
| Environment | Tool/model version as relevant, renderer/runtime, input data, configuration, and conditions affecting the result. |
| Method and scope | Role, failure target, procedure, oracle, unit/check/environment rows, and known limits. |
| Observation | Actual result, time observed, and a reproducible evidence locator or retained output. |
| Dependencies | Artifact components, inputs, assumptions, tools, and environments on which the evidence depends. |
| Reuse | Original evidence ID/version, impact analysis, applicability check and reason, and the new snapshot to which reuse applies. |

A timestamp or hash identifies evidence; it does not prove that a person or model actually inspected it. A generated table populated with invented results is not evidence. Do not store private raw traces in a public repository to make evidence look substantial.

Use `fresh`, `reused`, `failed`, `missing`, or `blocked` for coverage status, and record the actual result as `pass`, `fail`, or `unverified`. Freshness alone does not mean a check passed. Only applicable evidence with a supported pass satisfies a required row. A reused check retains its original observation date and snapshot; record the date and scope of the new applicability check separately. A missing check is not a negative test result, and a failed check is not an unavailable tool.

## Coverage and change impact

Before a gate can claim complete coverage, every required unit/check/environment row must have applicable evidence and a supported result. Separate owner coverage from reviewer coverage. The reviewer must cover its agreed gate scope, not simply adopt the owner's coverage declaration. If a review scope is narrower than the full artifact, disclose it and do not label it a full-scope independent review.

On any material, contract, environment, input, or assumption change:

1. Identify dependencies and affected coverage rows.
2. Invalidate affected evidence and reopen impacted gates or findings.
3. Recheck affected scope and relevant regressions on a frozen new snapshot.
4. Reuse unaffected evidence only after an explicit, recorded applicability check; uncertainty about impact requires a fresh check.

Do not reject still-valid evidence merely because an unrelated file changed. Conversely, unchanged bytes alone do not establish validity if the renderer, environment, or contract changed. Global layout or reflow changes require renewed full visual inspection; old page screenshots do not cover the new pagination.

## Finding triage

Every finding needs an ID, severity, exact location, violated criterion or risk, supporting observation, reproduction or verification path, and proposed next action. Material means that correctness, a required acceptance criterion, authority, security/privacy, or the agreed assurance claim is affected. Cosmetic preferences are not automatically blockers.

The owner investigates before changing the artifact:

| Classification | Required handling |
| --- | --- |
| `confirmed` | Retain evidence, repair the root cause, and verify the repair and relevant regressions. A non-material finding may instead be deferred only with a recorded authorized decision, reason, and follow-up, and must remain disclosed. Material findings cannot use this exception. Acknowledgment alone does not close a finding. |
| `refuted-with-evidence` | Retain a reproducible counterexample or other counterevidence showing why the proposed defect is wrong. Do not weaken correct work to appease the reviewer. |
| `unresolved` | State competing evidence or the missing check. A material unresolved finding blocks readiness. |
| `duplicate` | Link the canonical finding; inherit its disposition and closure. Cycles or a missing canonical finding are invalid. |
| `out-of-scope` | Cite the relevant contract boundary and disclose adjacent risk. A required criterion cannot be removed by labeling it out of scope. |

A high-impact refutation or out-of-scope decision under genuine dispute should be checked by an authorized critic or the user. Give that critic the artifact, contract, disputed finding, and relevant reproductions/counterevidence, but not an instruction to defend the owner or reviewer. The critic chooses its own approach. The owner still investigates the critic's observations; consensus and majority vote do not establish truth.

## Rounds and stopping

A review round is one completed gate-evaluation attempt on a frozen snapshot, whether it passes or fails. Its record includes owner checks, required independent review, finding triage, and any checks that were missing or could not be completed. An incomplete reviewer report does not erase that evaluation attempt. A reply to one finding, a reviewer clarification, or a tool retry is not a separate round.

Allow at most **three rounds per gate**:

1. Initial evaluation of the candidate snapshot.
2. Evaluation after the first repair, including change-linked rechecks.
3. Evaluation after the second repair, including change-linked rechecks.

Create a new snapshot record for each round; preserve content hashes when a record changes without changing artifact bytes. A material edit during review invalidates affected evidence, so freeze again before relying on the result. The count survives version bumps, a new filename, session compaction, and restarts. An approved material scope change may justify a new gate instance, but record its cause and cumulative resource use; do not use scope relabeling to evade the limit.

The maximum is not a target. Stop when READY, when no progress is possible, or when the approved resource cap is reached. If a blocker remains after round three, choose BLOCKED and escalate. Do not deliver as accepted, restart silently, or extend the budget without approval.

## Gate decisions

- **READY:** mandatory acceptance, actual checks, applicable evidence, complete required coverage, sufficient independent review where required, and necessary approvals are satisfied. No material finding remains open; confirmed non-material findings are repaired or explicitly deferred under the recorded exception.
- **REPAIR:** an actionable gap remains, repair is authorized and feasible, and another round fits within the remaining limits. Stop dependent phases until re-evaluation.
- **BLOCKED:** essential authority, input, tools, or review is unavailable; material uncertainty cannot be resolved safely; limits are exhausted; or there is no meaningful progress path. State the unblocking requirement.

A gate's technical readiness is separate from authorization to execute or publish. Record both. A user may authorize a clearly labeled draft handoff while a gate remains blocked; that is not a pass. Assurance or scope changes require a new recorded contract, cannot waive host safety rules, and do not retroactively change earlier evidence.

## Capability fallbacks

| Missing capability | Honest fallback |
| --- | --- |
| Internet | Use inspected local sources with dates and limits. Block decisions requiring unverified current facts; request a source or an explicit scope change. |
| Question tool | Numbered text options with a recommendation and a custom-answer path. Nonresponse remains non-approval. |
| Fresh-context reviewer | State `self-review-only`. Continue only if independent review is not required; otherwise wait for an authorized fresh session or human review. |
| Delegation permission | Do not delegate. Prepare a neutral handoff for a separately authorized reviewer; do not bypass the restriction through another CLI. |
| Vision/renderer | Run available mechanical checks but keep visual coverage missing. Obtain actual inspection or an explicit narrower contract. |
| Sufficient budget | Stop or reduce scope with approval. Preserve failed attempts and costs; do not discard inconvenient runs or fabricate measurements. |

On resumption, validate the ledger's contract, snapshot, environment, inventory, findings, round counters, approvals, and remaining budget before reusing evidence or resuming dependent work.
