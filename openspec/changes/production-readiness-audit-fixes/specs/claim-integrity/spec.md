# Spec Delta

## Purpose

Establishes that every factual claim the project publishes about itself — version, test and tool counts, feature maturity, release status, and benchmark numbers — is derived from a measurable source of truth and can be falsified, so a reader never has to take the documentation on trust.

## ADDED Requirements

### Requirement: Version reported by machine-readable surfaces
The machine-readable project-information surface and every other machine-readable surface that reports a framework version (health output, protocol handshake, build output) SHALL report the version declared by the published package manifest, and a single declaration of that version SHALL be the only place it is written. No surface is permitted to carry a version literal of its own.

#### Scenario: Info surface reports the manifest version
- **WHEN** the project-information command is executed and its machine-readable output is parsed
- **THEN** the reported version is byte-identical to the version in the published package manifest

#### Scenario: No duplicated version literal survives
- **WHEN** the framework's executable and protocol sources are searched for a hard-coded semantic version string
- **THEN** no such literal is found outside the single declared version constant

#### Scenario: Cross-surface version equality
- **WHEN** the health endpoint output, the protocol handshake output and the project-information output are compared
- **THEN** all three report the same version string

#### Scenario: Version drift fails the suite
- **WHEN** a project-information output reporting a version different from the manifest is presented to the version-consistency test
- **THEN** the test fails and names both differing values

### Requirement: Test, tool and lint counts published in documentation
The test-case count, test-file count, tool-inventory count and accepted-lint-warning count stated in the project documentation, the readme files and the agent guide SHALL be identical everywhere they appear, and SHALL be reproducible by executing the corresponding command. A diagnostic count that the tooling itself declares incomplete (because a display limit was exceeded) SHALL NOT be published as a total.

#### Scenario: One test count across all documents
- **WHEN** every documentation file is searched for a "N tests" and a "M files" statement about the framework suite
- **THEN** exactly one distinct test-case count and one distinct test-file count are found, and they equal the counts reported by running the suite

#### Scenario: Tool inventory count is not hand-written
- **WHEN** the documented tool count is compared with the number of tools the model-context-protocol server actually registers
- **THEN** the two numbers are equal

#### Scenario: Incomplete lint output is not published as a total
- **WHEN** the linter reports that its diagnostic display limit was exceeded
- **THEN** no document states an exact accepted-warning count derived from that truncated run, or the number stated is regenerated from a complete run

#### Scenario: Every documentation link resolves
- **WHEN** every relative link and badge target in the readme files is resolved against the repository tree
- **THEN** each target exists

### Requirement: Release and publication status statements
Statements in the project documentation about whether the release automation has ever executed, whether continuous integration is green, and whether any version has been published to the public registry SHALL be either verified at documentation-verification time or removed. A statement asserting a negative about a public, externally observable system that is machine-queryable SHALL NOT be present unless the query currently returns that negative.

#### Scenario: Release-execution claim matches the release feed
- **WHEN** the documented claim about prior release executions is compared with the number of published releases for the project
- **THEN** the claim states the observed number, and a mismatch fails the documentation verification

#### Scenario: Publication claim matches the public registry
- **WHEN** the documented claim about published versions is compared with the versions listed for the package on the public registry
- **THEN** the claim states the observed number, and a mismatch fails the documentation verification

#### Scenario: Absence of external contract is not asserted
- **WHEN** documentation is verified while published versions exist
- **THEN** no sentence asserts that no external contract or no prior publication exists

### Requirement: Documented tool inventory resolves
Every tool name, command name and route that documentation instructs a consumer to invoke SHALL resolve against the registered implementation. A documented name that is not registered SHALL fail documentation verification rather than being discovered by a consumer at run time.

#### Scenario: Documented tool name is registered
- **WHEN** each tool name appearing in the shipped agent guide is submitted to the model-context-protocol server
- **THEN** every one of them is recognized rather than rejected as unknown

#### Scenario: Registered names are all documented
- **WHEN** the registered tool inventory is compared with the names in the agent guide
- **THEN** the two sets are equal in both directions

#### Scenario: Following the documented guide does not error
- **WHEN** an agent follows the documented sequence of tool invocations verbatim
- **THEN** no invocation returns an unknown-tool error

### Requirement: Feature maturity ratings are evidence-backed
A capability SHALL be rated `stable` only when a test exists that fails when that capability's behaviour breaks, and a capability rated `stable` SHALL be demonstrated by a committed runnable example or by a suite that executes against a real engine. A capability whose implementation is absent, stubbed, or contradicted by the code that ships alongside it SHALL NOT be rated `stable` and SHALL NOT be advertised in the feature inventory. A project with no recorded external adoption SHALL NOT present a majority of its capabilities as `stable` without stating the adoption basis.

#### Scenario: Stable rating implies a failing test
- **WHEN** each capability rated `stable` is inspected for a test that fails when the capability's behaviour is broken
- **THEN** a such test exists for every one of them, and any capability without one is reported as violating the rating rule

#### Scenario: Absent implementation is not advertised
- **WHEN** a capability listed in the feature inventory has no corresponding implementation in the source tree
- **THEN** the capability is removed from the inventory or its rating is downgraded and the reason is stated

#### Scenario: Stubbed behaviour is not rated stable
- **WHEN** a capability described as performing a behaviour is traced to its implementation
- **THEN** the implementation performs that behaviour, or the capability's status is downgraded with the gap named

#### Scenario: Adoption basis is disclosed
- **WHEN** the feature-status output is produced
- **THEN** it discloses the project's recorded external adoption and does not present a blanket stable rating for the majority of capabilities while that adoption is zero

### Requirement: Machine-readable contract matches implementation
Every behavioural statement emitted by the published machine-readable authoring contract SHALL be true of the shipped implementation, and any test covering that contract SHALL assert the statement itself rather than only an adjacent identifier. Where the contract, the implementation and a module description disagree, the contract and the description SHALL both be brought into line with the implementation, and the contract test SHALL be extended to fail on a false statement.

#### Scenario: Request-body limit statement is true
- **WHEN** a request body exceeding the documented size ceiling is sent to the body-reading endpoint
- **THEN** the observable behaviour matches the sentence the machine-readable contract states about that path

#### Scenario: Contract test asserts the sentence
- **WHEN** the contract test runs against a contract whose body-handling sentence has been made false
- **THEN** the test fails

#### Scenario: Description and contract agree
- **WHEN** the human-readable description of the body-reading path is compared with the machine-readable contract statement for the same path
- **THEN** they do not contradict each other

### Requirement: Analysis commands fail on unresolvable targets
An analysis or impact command that is given a target it cannot resolve SHALL report failure, set a non-zero exit code, and name the target it could not resolve. It SHALL NOT report success with an empty result, and the empty-success state SHALL be treated as a defect.

#### Scenario: Unknown target is a failure
- **WHEN** an impact command is executed with a target that does not exist in the project
- **THEN** the command reports failure, exits non-zero, and names the unresolved target

#### Scenario: Success implies a non-empty result
- **WHEN** an analysis command reports success
- **THEN** its result contains at least one resolved element

#### Scenario: Failure code is distinguishable
- **WHEN** an analysis command fails for an unresolved target
- **THEN** the machine-readable output carries a machine-resolvable failure code distinct from an internal error

### Requirement: Benchmarks measure the work they claim
A benchmark script SHALL exercise the runtime path it is used to justify a claim about, and SHALL print the observable facts that establish it did so — including the number of features discovered and the kinds of request issued. A comparative performance claim (a ratio, a multiplier, or a throughput figure attributed to a named tuning change) SHALL be reproducible by running the script, which SHALL therefore contain a baseline arm and a measured arm. A load generator SHALL not share a process with the server under test.

#### Scenario: Benchmarked server has discovered features
- **WHEN** the concurrency benchmark completes
- **THEN** the server it measured reports a non-zero number of discovered features, and the count is printed

#### Scenario: Benchmarked requests do real work
- **WHEN** the concurrency benchmark issues its load
- **THEN** at least one measured request performs a server-side render and at least one performs a persisted write through a remote procedure call, rather than only a static health response

#### Scenario: Comparative claim is reproducible
- **WHEN** the concurrency benchmark is run
- **THEN** it reports both a baseline and a measured arm, the load generator executes in a process separate from the server under test, and any multiplier or throughput figure quoted in documentation is either derivable from the run's own output or has been withdrawn

#### Scenario: Non-comparable columns are labelled
- **WHEN** the context-surface benchmark reports a per-application token count and a total count that include different file sets
- **THEN** each column is labelled with the file set it covers, and any quoted reduction is attributed to the column that is comparable between the two applications
