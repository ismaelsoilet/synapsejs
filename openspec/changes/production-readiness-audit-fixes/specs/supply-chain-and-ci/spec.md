# Spec Delta

## Purpose

Constrains the build, automation and packaging surface so that a green pipeline, a published release and a running container each correspond to a reproducible, auditable state: dependencies resolved from the committed lockfile, third-party automation pinned immutably, no unpinned code executed on the pull-request path, and an image and scaffold that match the version they ship.

## ADDED Requirements

### Requirement: Automation installs from the committed lockfile
Every workflow that installs project dependencies SHALL install with a frozen-lockfile constraint, so that the pipeline builds exactly the dependency graph committed to the repository. A newly published version of any dependency SHALL NOT be what a pipeline run or a publish rehearsal exercises. The container build and the workflow install path SHALL apply the same constraint.

#### Scenario: Pipeline resolves the committed graph
- **WHEN** a workflow installs dependencies
- **THEN** the install fails rather than resolving a dependency version that differs from the lockfile, and succeeds when the lockfile is unchanged

#### Scenario: Lockfile is unmodified by a run
- **WHEN** a pipeline run completes
- **THEN** the committed lockfile is byte-identical to its state before the run

#### Scenario: Build and pipeline agree
- **WHEN** the dependency-installation command used in the workflows and the one used in the container build are compared
- **THEN** both apply a frozen-lockfile constraint

### Requirement: Third-party automation is immutably pinned
Every third-party action referenced by a workflow SHALL be referenced by its full commit identifier, never by a movable tag or branch. The toolchain each workflow installs SHALL be pinned to an explicit version, never to a moving release channel. A workflow that references an action by tag SHALL be rejected by a policy check.

#### Scenario: No tag-pinned action
- **WHEN** the workflow definitions are scanned for action references
- **THEN** every reference is a full-length commit identifier

#### Scenario: Tag introduction fails the check
- **WHEN** an action reference is changed to a tag
- **THEN** the policy check fails and names the workflow and the reference

#### Scenario: Toolchain channel is pinned
- **WHEN** the toolchain installation step of each workflow is inspected
- **THEN** the version requested is an explicit version rather than the latest release channel

#### Scenario: Cached toolchain matches the pin
- **WHEN** the toolchain is installed and cached
- **THEN** the cache key includes the pinned version, so a different pinned version cannot be served from a stale cache entry

### Requirement: The pull-request path executes no unpinned package
The path a workflow takes when a pull-request build fails SHALL NOT fetch and execute a package resolved at run time. Any tool invoked on that path SHALL come from the committed dependency graph or be pinned to an exact version. This SHALL hold for builds triggered from a fork, where the running environment is least trusted.

#### Scenario: Failure path has no run-time resolution
- **WHEN** the failure branch of the pull-request workflow is inspected
- **THEN** it contains no invocation of a package resolved from a registry at execution time without an exact version constraint

#### Scenario: Fork-triggered run is equally constrained
- **WHEN** the failure path executes for a pull request originating from a fork
- **THEN** it executes the same pinned artifacts as a same-repository run

#### Scenario: Unpinned invocation fails the policy check
- **WHEN** an unpinned run-time package invocation is added to any workflow
- **THEN** the policy check fails and names the workflow

### Requirement: The release credential story matches its documentation
The release workflow's comments and documentation SHALL describe the credential mechanism the workflow actually uses, and a workflow authenticating with a long-lived token SHALL NOT claim tokenless trusted publishing. The publish step SHALL NOT upgrade the package manager to a moving latest release inside the job that publishes. Provenance attestation, the declared permission set, and the check that the release tag version equals the manifest version SHALL be preserved.

#### Scenario: Comment matches mechanism
- **WHEN** the release workflow's comments are compared with the credential it supplies to the publish step
- **THEN** the described mechanism is the one used, and a mismatch fails the policy check

#### Scenario: Publish job does not self-upgrade
- **WHEN** the publish step is inspected
- **THEN** the package manager it uses is a pinned version, with no upgrade to a moving latest channel inside the publish job

#### Scenario: Provenance and permissions preserved
- **WHEN** the release workflow is inspected
- **THEN** provenance attestation is enabled, the declared permissions are the minimum needed, and the tag-versus-manifest version check remains present and covers every version field it must

#### Scenario: Version mismatch still blocks
- **WHEN** a release is tagged with a version that differs from the manifest version
- **THEN** the publish step does not run

### Requirement: Scaffolded applications depend on the current framework
A newly scaffolded application SHALL declare a dependency on the framework at the version that is currently published. The scaffolded dependency range SHALL NOT be pinned to a version older than the current release, and the test that asserts the scaffold's dependency shape SHALL assert currency rather than freeze a stale pin.

#### Scenario: Scaffolded range covers the current release
- **WHEN** the scaffolding output is inspected
- **THEN** the declared framework dependency range includes the currently published version

#### Scenario: Stale pin is rejected
- **WHEN** the framework's dependency range in a scaffolded project is older than the current release
- **THEN** the scaffold test fails and reports both versions

#### Scenario: New project receives the security fixes
- **WHEN** a new application is scaffolded and its dependencies are installed
- **THEN** the installed framework version is the current release, including every change recorded as a security fix since the previously pinned version

### Requirement: The published image starts under its own defaults
The published container image SHALL start successfully with the defaults it ships: the server process SHALL run as a non-root user, and it SHALL have write access to the working directory it is given, so that the files it creates at startup (database file, queue store) can be created without a manual permission step.

#### Scenario: Image starts with no manual preparation
- **WHEN** the published image is run with no volume mount and no additional permission change
- **THEN** the server starts, creates its startup files, and reports itself healthy

#### Scenario: Non-root user can create its files
- **WHEN** the image's startup process attempts to create its database and queue files
- **THEN** the attempt succeeds as the unprivileged user the image declares

#### Scenario: Read-only working directory fails loudly
- **WHEN** the image is run with a read-only working directory
- **THEN** startup fails with a diagnostic naming the unwritable path, rather than crashing with an unrelated error

### Requirement: The published image is minimal and reusable
The runtime layer of the published image SHALL NOT contain the source of the monorepo, the framework's own test suite, the example applications, or the TypeScript compiler. The image SHALL NOT hardcode a single demonstration application as its served root; the application to serve SHALL be selectable at build or run time. The image's declared size SHALL be measured rather than asserted.

#### Scenario: Runtime layer excludes development material
- **WHEN** the published image's final layer is inspected
- **THEN** it contains none of the framework test suite, the example applications, or the TypeScript compiler

#### Scenario: Served application is selectable
- **WHEN** the image is built with a different application selected
- **THEN** it serves that application instead of a fixed demonstration application

#### Scenario: Size claim is measured
- **WHEN** the documented image size is cited
- **THEN** it can be reproduced by measuring the image produced by the committed build definition

### Requirement: The container build context excludes sensitive and generated material
The container build's ignore rules SHALL exclude environment files, key and credential material, and coverage or test-report output, so that a broad copy of the build context cannot carry secrets into an image layer. The build definition SHALL NOT copy the entire context into a stage.

#### Scenario: Environment files are excluded
- **WHEN** a file matching the environment-file patterns exists in the build context
- **THEN** it is not present in any image layer

#### Scenario: Key material is excluded
- **WHEN** a private key or credential file matching the key-material patterns exists in the build context
- **THEN** it is not present in any image layer

#### Scenario: Coverage output is excluded
- **WHEN** coverage or test-report output exists in the build context
- **THEN** it is not present in any image layer

#### Scenario: Build stage is not a whole-context copy
- **WHEN** the build definition is inspected
- **THEN** it copies named paths rather than the entire build context, and the check fails if a whole-context copy is reintroduced
