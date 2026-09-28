# Research and clarification

Load on entering phase 1 for standard/full work; light tasks use the compact exception in SKILL.md. Follow its tier and gate rules. The first phase produces two outputs: an understanding memo and a decision log. They may be sections of the same task ledger.

## 1. Understand the request

Read the supplied material, relevant project rules, existing implementation, and prior approved decisions. State the desired outcome, intended recipient, deliverables, current acceptance criteria, exclusions, consequential actions, available resources, and unknowns. Separate what the user requested from what the owner proposes.

Create a provisional contract before research. Do not demand complete specifications before examining what is already available. Ask one preliminary, focused question only when the ambiguity makes even useful research impossible, such as not knowing which of two unrelated products is being discussed. Record that exception.

## 2. Research the uncertainty that matters

Search locally before asking about existing behavior. Use external research when freshness, unfamiliar technology, market choices, factual uncertainty, or a consequential decision warrants it. For a self-contained small task, record why local inspection is sufficient rather than browsing for ceremony.

Prefer primary documentation, source code, original studies, and direct product evidence. A search snippet is a lead, not proof of a decisive claim. Open the relevant source, record its date/version and scope, and distinguish documented capability from something exercised in this environment. Do not infer product quality from popularity, or uniqueness from failing to find a competitor.

For each consequential claim, retain a source pointer, the supported claim, freshness requirements, conflicting evidence, and confidence limitations. Separate:

- Observed or sourced facts.
- General background knowledge, with freshness limitations.
- Inferences and assumptions that could change the decision.

Cross-check a disputed or high-impact claim with a different source or a direct experiment. Resolve contradictions or carry them as uncertainty; do not count multiple pages quoting the same original as independent evidence.

Stop researching when the decision-critical claims are supported well enough for the agreed risk level, alternatives are compared fairly, and remaining uncertainty is explicitly bounded. If the budget runs out first, narrow the proposal or block the decision; do not quietly replace missing current evidence with memory.

## 3. Analyze from three perspectives

Produce concise findings, not a private reasoning transcript. Adapt these default perspectives to the task:

1. **User value and requirements:** What decision or experience matters? What would technically correct work still fail to satisfy?
2. **Feasibility and evidence:** What works in the actual environment? Which claims, calculations, dependencies, and assumptions can be tested?
3. **Risk and economics:** What can fail, cost too much, violate permissions, be hard to reverse, or become stale?

Each perspective must add a distinct decision-relevant observation. Three restatements of the same opinion are one perspective. Analysis perspectives are not automatically verification methods: verification needs an actual check and evidence.

## 4. Ask the decision-changing questions

After sufficient research, list unresolved decisions and their dependencies. Ask only what available evidence cannot answer and what affects correctness, scope, authority, risk, or a material trade-off.

Use the host's question tool and its actual schema. Batch independent questions within its limits. Sequence dependent questions: do not ask the user to choose a hosting budget before an answer determines whether hosting is needed. Offer practical options, explain trade-offs, identify a recommendation, and allow a custom answer. Do not pretend a recommendation is selected.

If no question tool exists, use numbered text questions with two to four options, mark the recommended option, and allow free text. If the user skips, declines, or times out:

- Record `unanswered`, not `approved`.
- Continue only with already authorized work unaffected by the unanswered decision.
- For a low-risk detail already covered by discretion granted in the contract, state the assumption and its reversible consequence.
- For a blocking scope, spending, publication, destructive, or high-risk decision, pause and explain the specific unresolved choice. Do not keep reissuing the same question as if nonresponse were an error.

## 5. Present alternatives, then close the first gate

Compare meaningful alternatives after the decision context is clear. Include the user's approach, a justified improvement where one exists, and keeping the status quo when reasonable. Assess outcome, speed, total cost, evidence strength, risk, and reversibility. A faster option that omits a required check is reduced assurance, not a free improvement.

Prefer a small set of concrete options to an exhaustive menu. If no meaningful alternative exists, explain why without inventing one. If the preferred option changes approved scope or authority, obtain an explicit decision before adopting it. This targeted follow-up is allowed; it does not justify skipping the initial research-first order.

## Required outputs

**Understanding memo:** goal and recipient; original versus proposed scope; deliverables and acceptance criteria; evidence and sources; three-perspective conclusions; inspection units known so far; tools, budget, risks, assumptions, and unresolved issues.

**Decision log:** question or proposal; research that informed it; options and recommendation; actual user response or `unanswered`; approved decision and scope effects; superseded decision IDs; authority boundaries.

Do not mark missing input as a user decision. Keep evolving contracts versioned so a reviewer can see which request applies.

## Gate evidence

In full mode, use three owner checks that cover research and clarification together. A useful set is:

1. Trace consequential claims to inspected primary evidence and recalculate quantitative claims.
2. Trace the request to questions, decisions, alternatives, and acceptance criteria; identify unanswered decision-changing ambiguity.
3. Challenge the preferred option through a competing explanation, counterexample, or risk/cost sensitivity test.

The reviewer chooses its own methods independently. Pass only when the understanding memo and decision log are adequate for planning, with no hidden material uncertainty, unauthorized assumptions, or unsupported decisive claims.
