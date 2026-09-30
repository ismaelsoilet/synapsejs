# Spec Delta

## Purpose

Requires that every optional item in the slice authoring contract be demonstrated by a committed, runnable slice in a shipped application, so that reversible migrations, webhooks, background jobs, sockets, caching and metadata are verifiable end to end rather than only asserted in prose.

## ADDED Requirements

### Requirement: Every optional contract item has a committed slice
Each optional item of the slice authoring contract — webhook, background job, websocket definition, cache definition, metadata generation, broadcast and subscription — SHALL be exercised by at least one slice committed to a shipped application in this repository. The set of committed slices SHALL be reported by a command that lists which optional items are unexercised, and that list SHALL be empty.

#### Scenario: Optional item coverage is reported
- **WHEN** the coverage-reporting command runs
- **THEN** it lists each optional contract item and the committed slice that exercises it, with no item listed as unexercised

#### Scenario: Unused optional item fails the check
- **WHEN** no committed slice declares a webhook and the coverage check runs
- **THEN** the check fails and names the webhook item as unexercised

#### Scenario: Multiple applications still cover every item
- **WHEN** the committed slices across all shipped applications are enumerated
- **THEN** the union of the optional items they exercise covers every item in the contract

### Requirement: Committed slices exercise the server-side loader
At least one committed slice in a shipped application SHALL declare a loader and SHALL be verified end to end by observing rendered output that contains data only obtainable from the database. A loader's declared failure behaviour SHALL be exercised by a committed slice as well, so that a crash is observable rather than inferred.

#### Scenario: Loader data reaches the rendered page
- **WHEN** a shipped application is started and the slice with a loader is requested
- **THEN** the rendered response contains a value that exists in the database and is not present in the slice's static markup

#### Scenario: Loader runs on every server-rendered request
- **WHEN** the slice with a loader is requested twice with different database content
- **THEN** the second response reflects the changed content rather than a value captured at start

#### Scenario: Loader failure is exercised
- **WHEN** the loader is made to fail and the slice is requested
- **THEN** the failure is surfaced in the response and recorded, and a committed case asserts that outcome

### Requirement: Committed slices declare reversible migrations
At least one committed slice in a shipped application SHALL declare a reversible migration block, so the rollback capability is demonstrable on a project a consumer can run. Every committed reversible block SHALL name at least one statement.

#### Scenario: A shipped application declares a reversible block
- **WHEN** the committed slices of the shipped applications are parsed for reversible migration blocks
- **THEN** at least one is found and it contains at least one statement

#### Scenario: Empty reversible block is rejected
- **WHEN** a reversible migration block containing no statement is declared
- **THEN** the check reports the block as empty and fails

### Requirement: Rollback succeeds on a shipped application
The rollback command SHALL succeed against a shipped application in this repository, SHALL report the number of statements it rolled back, and SHALL report that number as greater than zero. A run that reports zero statements rolled back against a shipped application SHALL be treated as a failure of this requirement.

#### Scenario: Rollback rolls back a real statement
- **WHEN** the rollback command is executed against a shipped application that declares a reversible block
- **THEN** the command reports success, reports a rolled-back statement count greater than zero, and the affected schema change is observably absent afterwards

#### Scenario: Rollback is transactional
- **WHEN** a statement inside a reversible block fails during rollback
- **THEN** no statement from that block is applied and the command reports the failing statement

#### Scenario: Zero-statement rollback is a failure signal
- **WHEN** the rollback command reports zero statements rolled back against a shipped application
- **THEN** the acceptance check for this capability fails

### Requirement: New exercise slices pass the client/server split gates
Every slice added to exercise an optional contract item SHALL pass the client/server partitioning step, with its client module typechecking and containing no server-side material. Its action bodies, schema definitions and storage access SHALL land only in the server module.

#### Scenario: Split succeeds with zero leaks
- **WHEN** the split command runs over the shipped applications
- **THEN** every slice, including the new exercise slices, is reported as partitioned with zero leaks

#### Scenario: Leaked schema fails the gate
- **WHEN** a slice's client module contains a database schema definition
- **THEN** the split gate fails and names the offending slice

#### Scenario: Compiled modules typecheck
- **WHEN** the split command emits the partitioned modules
- **THEN** each emitted module typechecks under the application's own configuration

### Requirement: New exercise slices declare named invariants
Every slice added to exercise an optional contract item SHALL declare its invariants as named cases in its own test export, and each named case SHALL be a behavioural assertion that fails when the implemented behaviour breaks. A slice whose cases pass against a deliberately broken implementation does not satisfy this requirement.

#### Scenario: Cases are named
- **WHEN** a new exercise slice is inspected
- **THEN** its test export contains at least one named case with a description

#### Scenario: Broken implementation fails the case
- **WHEN** the behaviour an exercise slice implements is deliberately broken
- **THEN** at least one of that slice's named cases fails

#### Scenario: Runner discovers the cases
- **WHEN** the slice test runner executes for the shipped applications
- **THEN** each named case of each new exercise slice is reported individually with its own pass or fail result

### Requirement: Capability promotion requires a demonstrated slice
A capability SHALL NOT be advertised as stable on the basis of a code-existence requirement or a generated-template assertion alone; it SHALL be demonstrated by a committed slice or by a test that executes the behaviour. A capability whose only evidence is that the scaffolder can emit its code SHALL carry a status that states it is not yet demonstrated in a shipped application.

#### Scenario: Template-only evidence downgrades the rating
- **WHEN** a capability's only evidence is an assertion that generated output contains a reversible migration block
- **THEN** its advertised status states that no shipped application demonstrates it

#### Scenario: Demonstrated capability keeps the rating
- **WHEN** a capability is exercised end to end by a committed slice in a shipped application
- **THEN** the evidence recorded for its stable rating points at that slice and at a named case that fails when the behaviour breaks
