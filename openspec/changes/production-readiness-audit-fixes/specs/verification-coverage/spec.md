# Spec Delta

## Purpose

Defines the minimum evidence a behavioural claim about this framework must rest on: real engine roundtrips inside the automated suite, browser hooks exercised through a DOM, database adapters tested against a live engine, and a suite that is isolated and coverage-gated rather than asserting on strings and test doubles.

## ADDED Requirements

### Requirement: End-to-end roundtrip is part of the automated suite
The full path from an HTTP request through server-side rendering, a remote procedure call, a persisted database write, and a role-based rejection SHALL be executed by the framework's own automated test command, using a test framework with structured assertions. A roundtrip that exists only as a loose script outside the suite SHALL be migrated into the suite, and the suite SHALL NOT report success for a remote procedure call that stops at the dispatcher without a real database round trip.

#### Scenario: Suite command exercises the full path
- **WHEN** the framework's test command is executed
- **THEN** an HTTP request is served, the response contains server-rendered content, a remote procedure call persists a row that is then read back, and a request without the required role is rejected

#### Scenario: Database writes are real
- **WHEN** a remote procedure call test asserts a write
- **THEN** the row is verified by reading it back from a real database engine, and a dispatch that returns success without a row fails the test

#### Scenario: Loose roundtrip script is retired
- **WHEN** the framework's test command is executed
- **THEN** no assertion in it depends on a script that is not part of the suite

#### Scenario: Call site overrides do not disable persistence
- **WHEN** the fixtures the suite uses for remote procedure calls are inspected
- **THEN** a mode exists in which the call reaches a real database, and the full-path test selects that mode

### Requirement: Client-side behaviour is verified in a DOM
Every consumer-facing browser hook, including the action hook, the subscription hook and the websocket hook, SHALL have a test that imports the shipped implementation and exercises it in a real DOM. Client-side rendering, including layout hydration, SHALL be verified by mounting the rendered output and observing the resulting DOM, not by asserting that generated source text contains a substring. A hydration mismatch SHALL be detected and fail the suite.

#### Scenario: Action hook runs the shipped implementation
- **WHEN** the action-hook test executes
- **THEN** it imports the shipped hook, mounts it, invokes it, and observes the resulting DOM; defining a local stand-in inside the test body does not satisfy the requirement

#### Scenario: Subscription hook is exercised
- **WHEN** the subscription-hook test executes
- **THEN** a published event delivered to a mounted component updates the DOM as the shipped hook specifies, and the websocket-hook test likewise opens a connection, receives a frame through the shipped hook, and reflects it in the DOM

#### Scenario: Hydration is verified by mounting
- **WHEN** the layout-hydration test executes
- **THEN** the generated layout is mounted, interactive state is asserted through the mounted DOM, and the test fails if the rendered markup differs between the server and the client

#### Scenario: Substring-only hydration test is removed
- **WHEN** the suite is searched for hydration coverage
- **THEN** no test asserts hydration by substring-matching generated source text

### Requirement: PostgreSQL adapters are tested against a live engine
The PostgreSQL database client and the PostgreSQL-based queue and event-hub adapters SHALL be tested against a running PostgreSQL instance, not against a recorder of the SQL text the implementation emits. Assertions SHALL verify persisted state, atomic claim behaviour under concurrency, dead-letter delivery, and the event-hub's listener and large-payload path. When a live instance is available the suite SHALL exercise these paths; when it is not, the suite SHALL report those cases as skipped rather than passing.

#### Scenario: Client performs real persistence
- **WHEN** the PostgreSQL client test runs with a live instance
- **THEN** inserted, updated, deleted and rolled-back rows are verified by reading them back from the database

#### Scenario: Queue claim is atomic
- **WHEN** two workers claim from an empty queue concurrently
- **THEN** no job is claimed twice, and every claimed job is processed by exactly one worker

#### Scenario: Dead-letter and large-payload paths execute
- **WHEN** a job exceeds its retry limit against a live engine, and separately a published event exceeds the in-memory payload threshold
- **THEN** the exhausted job is present in the dead-letter store, and the oversized event is read back correctly by a subscriber after being offloaded and restored

#### Scenario: Wrong-but-valid SQL is caught
- **WHEN** a queued job's statement is altered to be syntactically valid but semantically wrong, or its parameter order is swapped, or its transaction boundaries are broken
- **THEN** the PostgreSQL test fails, which an assertion over emitted SQL text alone cannot detect

### Requirement: Cryptographic adapters are verified functionally
A test asserting a cryptographic or signature adapter SHALL distinguish a correctly computed value from an arbitrary string of the right shape. It SHALL verify against a published known-answer vector, a recomputation by an independent implementation, or an equivalent-key acceptance and wrong-key rejection pair.

#### Scenario: Wrong-shape value fails
- **WHEN** the adapter is stubbed to return a fabricated value of the correct character length
- **THEN** the test fails

#### Scenario: Known-answer vector is accepted
- **WHEN** the adapter computes a signature over a published test vector
- **THEN** the result equals the published expected value

#### Scenario: Tampered payload is rejected
- **WHEN** a signed payload is modified after signing
- **THEN** verification fails

### Requirement: Tests exercise this repository
Every test in the suite SHALL exercise code owned by this project. A test whose subject is a third-party published package SHALL be removed or replaced with one that exercises the project's own use of that package. A test that verifies a test double's own behaviour, or that asserts a substring of generated source text in place of a behavioural outcome, SHALL NOT be counted as coverage of the capability it names.

#### Scenario: Third-party tests are removed
- **WHEN** the suite is searched for tests importing a function that is only ever defined outside this repository
- **THEN** no such test remains

#### Scenario: Test-double-only tests are removed
- **WHEN** a test asserts behaviour that belongs to a test double rather than to shipped code
- **THEN** the test is removed or rewritten to assert the shipped behaviour

#### Scenario: String-assertion tests are complemented
- **WHEN** a capability is covered only by substring assertions over generated source
- **THEN** the capability is reported as lacking behavioural coverage until a test observes the capability's effect

#### Scenario: Deleting the project breaks the suite
- **WHEN** the project's own modules are made unavailable to the test runner
- **THEN** the majority of the suite fails, proving the suite depends on this project

### Requirement: Test doubles report only work they performed
A test double SHALL NOT report a write, an update, a delete or a transaction outcome that did not occur against its own store. A delete that matched no rows SHALL report that nothing was removed; an update that matched no row SHALL not return a row that was never written; a rolled-back transaction SHALL discard the writes made inside it. Tests that assert the fabricated behaviour SHALL be rewritten to assert the honest behaviour.

#### Scenario: Empty delete reports zero
- **WHEN** a delete is issued against a test double for rows that do not exist
- **THEN** the result reports that no row was removed, and a test asserting a removal of at least one row fails

#### Scenario: Missing update returns no row
- **WHEN** an update is issued against a test double for a row that does not exist
- **THEN** no row is returned

#### Scenario: Rolled-back transaction discards writes
- **WHEN** a transaction is rolled back in a test double
- **THEN** the writes performed inside it are absent from the double's store

### Requirement: The suite is isolated and deterministic
The test suite SHALL NOT depend on a fixed network port, SHALL restore any mutated global process state on failure as reliably as on success, and SHALL NOT assert against timing windows narrower than the sleep margin it allows. The framework suite SHALL NOT import source from the example applications by relative path, so that editing an example cannot break the framework suite.

#### Scenario: Port is allocated dynamically
- **WHEN** the suite is inspected for hard-coded listener ports and polling loops
- **THEN** no fixed port is required, and a listener obtains an ephemeral port instead

#### Scenario: Global state is restored even on failure
- **WHEN** a test that mutates a process-wide environment variable throws before reaching its own cleanup
- **THEN** the variable is still restored before the next test file runs

#### Scenario: No timing races
- **WHEN** a test asserts an outcome that occurs within a narrow time window
- **THEN** it synchronizes on the observable state transition rather than sleeping for a fixed margin shorter than the window

#### Scenario: Framework suite is independent of examples
- **WHEN** an example application's source is modified in a way that breaks it
- **THEN** the framework suite still passes

### Requirement: Coverage is measured and gated
Continuous integration SHALL collect coverage for the framework package and SHALL fail the build when coverage falls below a committed threshold. The published claim that the client bundle contains no server-side material SHALL be backed by a coverage-measured gate rather than a standalone pass, and "all tests pass" SHALL be a claim the pipeline can substantiate with a recorded coverage figure.

#### Scenario: Coverage is reported
- **WHEN** the continuous-integration pipeline runs
- **THEN** a coverage report for the framework package is produced and archived with the run

#### Scenario: Below-threshold coverage fails the build
- **WHEN** coverage drops below the committed threshold
- **THEN** the pipeline job fails

#### Scenario: No-leak claim is measured
- **WHEN** the client bundle gate runs
- **THEN** it reports the measurable basis of the pass rather than an unquantified result
