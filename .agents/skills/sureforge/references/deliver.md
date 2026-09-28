# Deliver

Load on entering phase 4. Delivery is a verification of the final artifact and the recipient's experience, not a summary of effort.

## Freeze the candidate

Identify the artifact set with a content hash, commit plus clean-state evidence, or another unambiguous snapshot identifier. A filename or a version string alone is not proof that bytes did not change. Include the current contract, decisions, environment, and coverage inventory in the evidence record.

Compare the candidate with the original request as amended by approved decisions, the approved plan, and the execution change log. A subsequent user decision can legitimately supersede an original requirement; retain that provenance rather than treating every difference as drift.

## Inspect the complete agreed scope

Account for every required unit/check/environment row. Report missing, failed, blocked, reused, and newly checked evidence separately. A total count without an enumerable inventory is not proof of full coverage.

For a PDF or fixed-layout document, inspect each required page at a usable scale on the final render. Check clipping, overflow, missing content, text direction, fonts, images, tables, ordering, and navigation as applicable. A contact sheet may guide navigation but unreadable thumbnails do not establish inspection. Text extraction and metadata checks are complementary, not visual review.

For EPUB or another reflowable format, inspect each agreed content unit and required renderer/viewport/font state. Check reflow, navigation, accessibility, and media in the specified matrix. State exactly which matrix was checked; do not claim every possible device or pagination.

For code, data, or UI, exercise the agreed functional and environmental matrix, not only the most convenient path. Passing tests with an unimplemented acceptance criterion is a failed delivery gate.

If a required visual tool or renderer is missing, block the visual-completeness claim. Offer a human inspection or an explicitly reduced review scope. Do not count an automated lint as the missing human/visual judgment.

## Exercise the recipient's path

Use the final packaged form from a clean or isolated location where feasible. Open the archive, install the package, import the data, follow the entry point, or navigate the UI as the recipient would. Check relative paths, bundled resources, links, dependencies, license, version labels, and meaningful instructions.

Distinguish file installation, host discovery, skill activation, and actual behavioral performance. None establishes the next automatically. Do not publish a remote install command as tested when only a local copy was installed.

Inspect delivery risks: private data, identifying file or archive metadata, hidden files, credentials, unauthorized executable content, insufficient permissions, licensing, incorrect recipients, and operations with external consequences. Publication and sending remain separately authorized actions.

## Full-mode owner checks

Select three actual methods with different failure targets. A useful default is:

1. Final requirement-to-artifact reconciliation and complete-scope inspection.
2. Recipient-path execution using the actual packaged candidate in the agreed environment.
3. Delivery-risk audit covering privacy, metadata, permissions, licensing, stale evidence, and claims.

These are the owner's checks. Independent review is additional and cannot be counted as one of the owner's three. The reviewer chooses its own methods and states evidence, coverage, and limitations on the frozen final snapshot.

## Report supported conclusions

Use this compact structure:

- **Status:** READY, REPAIR, or BLOCKED; distinguish a review draft from accepted delivery.
- **Artifact:** version, snapshot identity, included outputs, and entry point.
- **Contract:** current version and significant approved changes.
- **Acceptance:** each criterion and its evidence-backed result.
- **Coverage:** the agreed denominator, inspected rows, missing rows, and environment/state matrix.
- **Checks:** methods actually performed, results, evidence locations, and reused evidence with applicability reasons.
- **Review:** context/isolation status, reviewer coverage, resolved and unresolved findings, critic involvement, and round count.
- **Limits:** unavailable tools, unverified properties, residual non-blocking risks, and required approvals.
- **Resources:** observed time, tokens, and costs when available; unknown measurements stay unknown and failed attempts remain included.

Do not use a broad statement such as "everything verified" when any required property remains unverified. Do not infer performance improvement from a protocol checklist or reviewer agreement.

## Final gate and handoff

Choose READY only when mandatory acceptance, evidence, coverage, independent review where required, and action approvals hold on the delivered snapshot. A hash mismatch or an unbounded final formatting change invalidates affected checks before handoff.

If limits are exhausted or a material blocker remains, choose BLOCKED and describe the specific next decision or access needed. The user may request an incomplete draft for review; label it as such and preserve its missing checks. An explicit change to scope or assurance creates a recorded new contract, not retroactive proof that the earlier contract was satisfied.
