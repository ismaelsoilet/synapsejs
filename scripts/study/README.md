# Study protocol (pre-registered)

Written **before** running any task, so the measurement rules cannot be adjusted after seeing the
numbers. If a rule below turns out to be wrong, it gets changed in a visible commit and the change is
reported, not silently applied.

## Question

Does the single-file slice convention reduce the cost of changing one feature, compared with the same
feature implemented in conventional layers?

## Hypothesis under test

H1: for the same change, the slice stack requires **fewer files touched** and **not more attempts to
green** than the conventional stack.

Falsification: if the conventional stack needs equal or fewer attempts and touches a comparable file
count, H1 is rejected and the report says so.

## Subjects

The same two features implemented twice, in the same repository, same language, same runtime:

- `examples/helpdesk-slices` — slice convention, one file per feature.
- `examples/helpdesk-conventional` — routes → service → db → schemas → ui, no framework dependency.

## Tasks (declared in `tasks.ts`, identical semantics on both sides)

| Id | Change | What it forces |
|---|---|---|
| T1 | Reject priority above 3 with the specific code `INVALID_PRIORITY` | validation + a new domain error |
| T2 | Refuse a duplicate ticket for the same subject+requester (`DUPLICATE_TICKET`) | schema/DDL + uniqueness check + error |
| T3 | Add `close ticket` for role `support`, with `ALREADY_CLOSED` | a whole new capability + RBAC + state |

## Measurement (mechanical, no self-reporting)

For each task × stack:

- **files touched** and **lines changed**: `git diff --numstat` on the working tree at the green
  attempt, recorded by the runner.
- **attempts to green**: the runner appends one line per invocation to `results/attempts.jsonl`. The
  count is read back from the log, so an attempt cannot be forgotten by the implementer.
- **wall-clock per task**: `startedAt`/`finishedAt` of the first attempt to the green one, from the log.
- **context surface**: `bun run bench` (already implemented) before and after, per feature.

The runner is the only writer of the results directory. Reverting the change between tasks is
`git checkout -- .`, so the next task starts from the same frozen commit.

## Gates per stack (the definition of "green")

| Stack | Commands |
|---|---|
| slices | `synapse check` and `synapse test` (per-invariant oracles) |
| conventional | `bun run check` (tsc) and `bun run test` (bun test) |

A task is green only when every command of its stack exits 0.

## What this study canNOT claim — read before citing the numbers

1. **n = 3 tasks, one implementer.** The implementer is the same agent that spent a long session
   reasoning about this framework. That is contamination: it is not a naive subject. A study that
   supports a product decision needs independent, hypothesis-blind implementers.
2. **No token instrumentation.** Nothing here measures tokens spent by an agent. Context surface
   (bytes of the import closure) is a proxy, and a coarse one.
3. **Small synthetic tasks.** This measures coordination cost — how many places a change touches —
   not the cost of understanding a large unfamiliar codebase.
4. **Single run per cell.** No repetition, no variance estimate, no significance test. This is a
   pilot, not an experiment.
5. **The definition of "green" is the stack's own convention**, which is slightly easier for slices
   (a per-slice oracle must exist) than for the conventional side (no test requirement is enforced).
   Both sides are asked to add a test, and the runner does not enforce it on either.

## Failure conditions that would change the recommendation

- Conventional touches the same or fewer files → the locality claim loses its measured support.
- Conventional reaches green in fewer attempts → the "fewer places to change" advantage does not
  translate into less work, and the 1.0 decision would rest on nothing.
