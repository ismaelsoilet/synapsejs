# Plan

Load on entering phase 2. A plan is a testable route to the latest approved outcome, not a list of plausible activities.

## Convert the contract into work

For each acceptance criterion, identify the output, responsible step, prerequisites, inspection unit, environment, verification method, and evidence expected. Keep explicit exclusions so the owner and reviewer do not silently expand scope.

Order dependent work. Use milestones inside the four primary phases when helpful; do not create handoffs solely to increase the number of agents. Keep sequential implementation with one accountable owner. Authorized parallel research or review must have disjoint responsibilities or a defined integration boundary.

State the actual permissions for file changes, delegation, network/provider use, data sharing, installation, spending, irreversible actions, and publication. A technical READY gate does not itself grant an action permission. If the host is in plan mode or the user asked only for advice, stop at the approved plan.

## Define the coverage denominator

List what must be inspected before claiming completion. Examples:

- Code: requested behaviors, changed interfaces, affected modules, edge cases, dependencies, and supported environments; code coverage percentages alone are not requirement coverage.
- Fixed-layout documents: every page, required visual/content checks, final render version, and required viewers or print conditions.
- Reflowable documents: every content unit, each agreed renderer/viewport/font state, navigation, media, and accessibility behavior. There is no single universal page count.
- UI: routes, viewport ranges, interactive states, keyboard paths, loading/error/empty states, and agreed browsers.
- Research or data: decisive claims, sources, calculations, records or transformation classes, missing-data treatment, and intended decision conditions.

Use stable unit IDs and one coverage row per required unit/check/environment combination. Record excluded combinations and the owner's authority to exclude them. Do not silently shrink the denominator to make the inspected percentage reach 100%.

When a scope cannot be exhaustively enumerated, state a defensible bounded coverage contract before execution. Sampling may support exploration, but it does not satisfy an agreed complete-inspection requirement. If exhaustive coverage is infeasible within the budget, ask to revise scope before claiming acceptance.

## Plan verification before implementation

Choose methods with different failure targets. In full mode, three owner methods at this gate might be:

1. Bidirectional traceability: every requirement has a step/check, and every planned step serves an approved requirement.
2. Dependency and feasibility dry run: walk the plan in order using the actual environment, permissions, tools, and inputs.
3. Premortem: identify how the plan could fail despite successful individual steps, then evaluate a safer alternative or recovery path.

Record how the methods can falsify the plan, not just confirm it. Do not pass owner method choices or conclusions to the independent reviewer before its initial method selection. The reviewer still receives the complete plan and all necessary acceptance criteria and source material.

## Bound the work

Record time, token/cost, review, and tool budgets where available. Unknown costs must remain unknown; request a cap before consequential spending. Do not give invented numerical estimates. Three rounds is the maximum per gate, not permission to exceed the task's total budget.

Define pause conditions: missing access, unanswered consequential decision, evidence too stale, unavailable required inspection, no progress, exhausted budget, and residual material findings after the third round. Plan backups or reversible staging for high-impact changes without assuming permission to perform destructive rollback.

## Gate output

Produce a plan with requirement mapping, ordered steps, coverage inventory, checks, permissions, budget, risks, and stop/recovery conditions. Record needed user approvals separately from technical readiness.

Choose READY only when the plan can reasonably achieve the current contract and no blocking decision is hidden. Use REPAIR for fixable plan gaps. Use BLOCKED for unavailable authority, resources, or essential evidence.

A material contract change reopens affected planning decisions and downstream checks. Record why a new gate instance is justified; do not reset a failed gate's three-round allowance by merely renaming the plan or changing its version.
