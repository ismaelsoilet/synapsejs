# Verification catalog

Load when selecting owner methods or defining inspection scope. This is a selection aid, not a mandatory checklist or a script for the independent reviewer. Each method needs a distinct failure target, real execution, scope, an oracle, and evidence. Three labels without these properties are not three methods. Different methods may share the same authoritative oracle; inventing different expected answers does not create independence.

## Phase-level defaults

| Gate | Owner method A | Owner method B | Owner method C |
| --- | --- | --- | --- |
| Research and clarification | Primary-source and quantitative claim validation | Request-to-question-to-decision traceability | Counterhypothesis or risk/cost sensitivity analysis of alternatives |
| Plan | Bidirectional requirement/step/check mapping | Dependency, environment, and permission dry run | Premortem with recovery or alternative-path analysis |
| Execute | Functional/boundary tests against independent acceptance criteria | Structural/interface inspection of the complete changed scope | Adversarial, metamorphic, or alternative-path verification |
| Deliver | Final contract-to-artifact and coverage reconciliation | Recipient-path execution of the packaged artifact | Privacy, metadata, authority, licensing, and evidence-freshness audit |

In standard mode choose at least two genuinely complementary methods per gate. In light mode a direct check may suffice. In full mode select three appropriate methods, adapting these examples to the work. Independent reviewer methods are additional, freely chosen, and not prescribed by this table.

## Code and configuration

- Reproduce an observed defect with a failing regression test; rerun after the repair.
- Test boundaries, error handling, state transitions, and interactions, not only happy-path outputs.
- Trace acceptance criteria through the implementation to tests; code coverage does not reveal an omitted requirement by itself.
- Inspect changed interfaces and downstream callers, type/static checks, permission boundaries, data handling, and dependency compatibility.
- Use metamorphic properties, differential implementations, or controlled fault injection where an independent expected output exists.
- Verify the actual build/install/run path in an isolated environment when that is part of delivery.

A linter, formatter, and the same linter with another flag usually share a failure class. They are not an adequate substitute for functional, structural, and adverse-input checking.

## Research and decision studies

- Open and inspect original sources for consequential claims, recording publication/access dates and version limits.
- Trace a citation to the exact conclusion it supports; check whether a summary overgeneralizes the source's setting.
- Independently recalculate quantities and check units, denominators, assumptions, uncertainty, and sensitivity.
- Compare competing explanations and options using the same criteria. Include evidence against the preferred choice.
- Check whether unanswered decisions materially change the recommendation, cost, or scope.

Search results, repeated summaries of one source, and agreement between model responses are not independent factual confirmation. If the decisive fact is current and network access is absent, state the gap instead of treating prior knowledge as current observation.

## Data and calculations

- Validate schema, uniqueness, missing values, ranges, units, and invariants across the agreed dataset.
- Reconcile totals and row counts from inputs to outputs, explaining excluded or transformed records.
- Use an independent calculation or transformation path and compare expected properties.
- Check counterexamples: empty inputs, duplicates, invalid types, reordered rows, precision loss, timezone or locale changes as relevant.
- Inspect whether an automated success masks an unmet business rule.

A record sample can reveal a bug; it cannot establish that every required record was checked. State the denominator and whether checks were automated, semantic, or visual.

## Fixed-layout documents and images

- Enumerate every page or frame and required viewing conditions.
- Render the final version and inspect each page at a scale adequate for its content.
- Check content completeness, ordering, tables, references, links, and navigation independently of layout.
- Check clipping, collisions, missing glyphs/images, typography, reading direction, contrast, and whitespace using actual visual inspection where required.
- Inspect metadata, embedded attachments, fonts, permissions, and final packaging.

Automated extraction, page-count checks, and visual-difference scripts are useful assistants. Neither a page count nor a thumbnail grid proves legibility or complete content. A global style change can affect every page; recheck the entire relevant render.

## Reflowable documents

Define two linked inventories: content units and rendering/display states. Agree on reader engines, viewport ranges, font/zoom states, reading direction, navigation, media, and accessibility paths that matter. Review the agreed combinations and record exclusions. There is no honest claim to having checked every possible reflow on every device.

Check source structure and navigation, rendered content in each required environment, and the recipient's actual reading/import path as different methods. Reflow or global typography changes invalidate prior visual coverage even when textual content is unchanged.

## Interfaces and visual experiences

Enumerate routes, representative viewport boundaries, agreed browsers, interaction states, and keyboard/accessibility flows. Check functional behavior, rendered usability, and state/permission failure paths separately. Include loading, empty, error, disabled, success, and focus states when in scope.

A screenshot confirms only the visible state in that environment. It cannot establish navigation, form behavior, keyboard access, or an unseen responsive breakpoint. A successful click automation does not establish the visual quality of every state.

## Plans and non-code artifacts

Use contract traceability, a dependency/feasibility walkthrough, and a premortem or alternative-case analysis. A plan can be complete as a document and still be impossible to execute within permissions or resources. Verify that verification itself is planned and that questions cover material ambiguity.

For prose or creative work, inspect the entire required text, brief fidelity, factual or continuity constraints, and the recipient's intended format. Do not convert subjective preferences into fake mathematical certainty.

## Evidence quality questions

Before counting any method, ask:

1. What distinct failure could this method reveal?
2. What material and environment did it actually inspect?
3. What independent criterion or observation distinguishes pass from fail?
4. Where is the observation recorded and to which snapshot does it apply?
5. What does this method not establish?

Choose a different method if these answers duplicate another check. If a property cannot be verified with available tools, mark it unverified and use the agreed fallback rather than manufacturing a third pass.
