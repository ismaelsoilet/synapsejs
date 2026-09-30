# Spec Delta

## Purpose

Guarantees that no framework write surface — the scaffolding commands, the protocol tool, or the upload parser — can be induced to create a file outside the directory it is supposed to own, retiring the whole class of unvalidated path segments rather than the two instances found by the audit.

## ADDED Requirements

### Requirement: One reusable path-segment validator guards every write surface
The framework SHALL provide exactly one validator that decides whether a caller-supplied string is an acceptable single path segment, and every surface that turns caller input into a filesystem path segment SHALL pass its input through that validator before joining. A validator already present on one write path SHALL NOT be bypassed by a sibling write path. The rule SHALL be stated once and exercised by a test that fails if any write surface stops applying it.

#### Scenario: One validator, applied everywhere
- **WHEN** the framework is searched for validators that decide whether a caller-supplied string is a safe single path segment
- **THEN** exactly one such rule exists, and every surface that joins caller input into a filesystem path applies it

#### Scenario: Sibling paths do not diverge
- **WHEN** a write surface that already rejects unsafe names is compared with every other write surface in the framework
- **THEN** no other write surface accepts a name that the already-guarded surface rejects

#### Scenario: Guard regression fails the suite
- **WHEN** the validator is removed from any one write surface
- **THEN** the containment test suite fails and names the unguarded surface

### Requirement: Slice scaffolding rejects unsafe domain and slice names
The slice-scaffolding commands SHALL reject a domain or slice name that is not a single safe path segment, and SHALL reject the escape regardless of which of the two arguments carries it. The domain segment and the name segment SHALL each be independently validated, because either one alone is sufficient to escape. Before any write, the framework SHALL confirm that the fully resolved absolute target path lies inside the application's slices directory; a target that does not is refused and no file is created.

#### Scenario: Traversal in the domain argument is refused
- **WHEN** slice scaffolding is invoked with a domain argument containing parent-directory traversal
- **THEN** no file is created, the caller is told the argument was rejected with `INVALID_PATH_SEGMENT`, and the process exits non-zero

#### Scenario: Traversal in the name argument is refused
- **WHEN** slice scaffolding is invoked with a valid domain and a name argument containing parent-directory traversal
- **THEN** no file is created, the caller is told the argument was rejected with `INVALID_PATH_SEGMENT`, and the process exits non-zero

#### Scenario: Resolved target is confirmed inside the application
- **WHEN** slice scaffolding resolves a candidate absolute path from a valid domain and name
- **THEN** the path is compared against the application's slices directory and the write proceeds only if the path lies within it

#### Scenario: Legitimate names still scaffold
- **WHEN** slice scaffolding is invoked with an ordinary domain and a kebab-case slice name
- **THEN** the slice file is created inside the application's slices directory and the command reports success with exit code zero

### Requirement: Shared-module scaffolding rejects unsafe module names
The shared-module scaffolding command SHALL reject a module name that is not a single safe path segment, and SHALL confirm the resolved target lies inside the application's shared directory before writing. A name that escapes SHALL produce no file and no partially created directory tree.

#### Scenario: Traversal in the module name is refused
- **WHEN** shared-module scaffolding is invoked with a name containing parent-directory traversal
- **THEN** no file is created inside or outside the application, the caller is told the name was rejected with `INVALID_PATH_SEGMENT`, and the process exits non-zero

#### Scenario: Resolved target is confirmed inside the shared directory
- **WHEN** shared-module scaffolding resolves a candidate absolute path
- **THEN** the write proceeds only if the path lies within the application's shared directory

#### Scenario: Legitimate names still scaffold
- **WHEN** shared-module scaffolding is invoked with an ordinary module name
- **THEN** the module file is created inside the application's shared directory and the command reports success with exit code zero

### Requirement: Application creation confines its target directory
The new-application command SHALL reject a project argument that resolves outside the working directory it was invoked from, and SHALL create nothing when it does. A project argument that names a path inside the working directory SHALL still be accepted, so a nested project layout remains possible.

#### Scenario: Escaping project name is refused
- **WHEN** the new-application command is invoked with a project name containing parent-directory traversal
- **THEN** no directory and no project files are created, the caller is told the name was rejected with `INVALID_PATH_SEGMENT`, and the process exits non-zero

#### Scenario: Nested project name is accepted
- **WHEN** the new-application command is invoked with a project name that names a subdirectory of the working directory
- **THEN** the project is created at that subdirectory and the command reports success with exit code zero

#### Scenario: Rejection leaves the filesystem untouched
- **WHEN** the new-application command refuses a project name
- **THEN** no directory at the resolved location exists afterwards

### Requirement: Scaffolding field names are validated before code generation
Field names supplied through the scaffolding field grammar SHALL be validated against the identifier rule before being interpolated into any generated artifact. A field name containing SQL or source-code metacharacters SHALL be refused, and the refusal SHALL occur before the slice file is written, so the migration runner is never handed a schema derived from an unvalidated name. The table or domain name is already sanitized; the field name is subject to the same rule.

#### Scenario: Metacharacter field name is refused
- **WHEN** slice scaffolding is invoked with a field whose name contains a SQL statement terminator
- **THEN** no slice file is created, the caller is told the field name was rejected with `INVALID_FIELD_NAME`, and the process exits non-zero

#### Scenario: No generated schema derives from an unvalidated field name
- **WHEN** a scaffolding run is given a field name containing SQL metacharacters
- **THEN** no file is written whose data-definition statement contains that name, and the migration runner has nothing derived from it to execute

#### Scenario: Valid field grammar still scaffolds
- **WHEN** slice scaffolding is invoked with the documented field grammar, including an enumerated field
- **THEN** the slice file is created with the expected columns and the command reports success with exit code zero

### Requirement: Containment is enforced at every scaffolding entry point
The same containment rule SHALL be enforced by the command line, by the model-context-protocol scaffolding tool, by the multi-operation CRUD scaffolding path, and when the scaffolding module is invoked directly by another program. The protocol tool's declared input contract SHALL express the constraint so a conforming client is refused before the call reaches the framework, and the framework SHALL enforce it again regardless of what the client declared.

#### Scenario: Protocol tool refuses an unsafe argument
- **WHEN** the model-context-protocol scaffolding tool is called with a domain or name containing parent-directory traversal
- **THEN** the tool returns a failure carrying the path-segment rejection code and no file is created

#### Scenario: Protocol tool input contract declares the constraint
- **WHEN** the scaffolding tool's declared input contract is inspected
- **THEN** the domain and name properties each carry a pattern constraint that excludes parent-directory traversal

#### Scenario: Direct invocation is still guarded
- **WHEN** the scaffolding module is called directly with a traversing argument, bypassing the command line and the protocol server
- **THEN** it returns the path-segment rejection error and writes no file

#### Scenario: CRUD path inherits the rule
- **WHEN** the multi-operation CRUD scaffolding path is invoked with a traversing resource name
- **THEN** it returns the path-segment rejection error and none of its four operations write a file

### Requirement: Containment failures are machine-resolvable and non-zero
The scaffolding failure-code set SHALL gain the distinct members `INVALID_PATH_SEGMENT` and `INVALID_FIELD_NAME`, separate from each other and from the write-failure, pre-existing-file and ambiguous-directory codes, and those members SHALL be observable in machine-readable output. A containment failure SHALL print parseable JSON carrying the failure code and SHALL set a non-zero exit code. The existing behaviour that refuses an ambiguous slices directory SHALL be preserved, because resolving the wrong application would scatter slices across the workspace.

#### Scenario: New failure codes are declared
- **WHEN** the scaffolding failure-code set is inspected
- **THEN** it contains a member `INVALID_PATH_SEGMENT` distinct from `WRITE_FAILED`, `SLICE_EXISTS` and the ambiguous-directory code, and a member `INVALID_FIELD_NAME`

#### Scenario: Command reports a parseable failure
- **WHEN** a containment failure occurs during a scaffolding command
- **THEN** parseable JSON carrying the failure code is emitted and the process exits non-zero

#### Scenario: Ambiguous slices directory still fails
- **WHEN** scaffolding is invoked in a workspace where more than one application owns a slices directory
- **THEN** the command reports the ambiguity failure code, exits non-zero, and lists the candidate applications

#### Scenario: Success is never reported for a refusal
- **WHEN** any scaffolding command refuses an argument
- **THEN** its output does not carry a success status

### Requirement: Uploads do not trust the client-declared extension
The upload parser SHALL NOT accept a file type solely on the extension the client declared, and SHALL enforce a declared, configurable accept policy, rejecting a file whose extension or detected content falls outside it with a distinct failure code and a client-error status. The stored file name and the path returned to the caller SHALL reflect only the accepted type, so a client cannot choose a served extension. Because the framework does not itself serve the upload directory, the machine-readable authoring contract SHALL state that residual hazard explicitly rather than leaving the decision implicit on the slice author.

#### Scenario: Disallowed extension is refused
- **WHEN** a file is uploaded whose declared extension is outside the accepted policy
- **THEN** the upload is refused with the `UNSUPPORTED_FILE_TYPE` code, the bytes are not written, and a client-error status is returned

#### Scenario: Stored name reflects the accepted type
- **WHEN** an accepted file is stored
- **THEN** the stored name and the path returned in the response use only the accepted extension, never a client-chosen one

#### Scenario: Policy is declared, not implicit
- **WHEN** the accepted upload types are read from configuration
- **THEN** a default policy is stated and effective without configuration, and a configured policy replaces it

#### Scenario: Residual serving hazard is disclosed
- **WHEN** the machine-readable authoring contract is read
- **THEN** it states that the framework does not serve the upload directory and that serving it is the application's responsibility
