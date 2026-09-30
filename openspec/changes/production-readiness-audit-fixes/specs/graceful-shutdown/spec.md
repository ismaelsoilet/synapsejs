# Spec Delta

## Purpose

Makes process shutdown an observable, deliberate protocol rather than a fixed sleep: requests already being handled are counted and awaited for the timeout the deployment actually configured, whatever outlives that window is terminated on purpose and reported, background jobs are never lost or double-counted, and the whole sequence is safe to trigger twice.

## ADDED Requirements

### Requirement: In-flight requests are counted and reported
The server SHALL count every request that has begun handling and has not yet produced a response, and SHALL expose that count on its diagnostic surface. The count SHALL be incremented before any request work begins and decremented when the response is sent or the request is aborted, so it never overstates or understates what is genuinely outstanding. A request whose response is an unbounded event stream SHALL NOT be counted as drainable work, because counting it would hold shutdown open indefinitely; it SHALL be reported separately as an open stream and SHALL be closed deliberately when shutdown begins.

#### Scenario: A held request is visible as in flight
- **WHEN** a request is deliberately held partway through handling and the diagnostic surface is queried
- **THEN** the reported in-flight count is at least one for that request

#### Scenario: The count returns to zero
- **WHEN** a request that was in flight completes
- **THEN** the reported in-flight count drops back to its prior value and eventually to zero

#### Scenario: An aborted request stops being counted
- **WHEN** a client disconnects while its request is being handled
- **THEN** the in-flight count is decremented and the request is no longer reported as outstanding

#### Scenario: Every route family is counted
- **WHEN** requests in flight across the remote-procedure-call, server-render, static-file and upload paths are observed from the diagnostic surface
- **THEN** each of them is included in the reported count

#### Scenario: An open stream is reported separately
- **WHEN** an event-stream subscription is open and the diagnostic surface is queried
- **THEN** the stream is reported as an open stream rather than as drainable in-flight work

### Requirement: New connections are refused as soon as shutdown begins
The moment shutdown begins the server SHALL stop accepting new connections, and a connection arriving after that point SHALL be refused rather than queued or served. A connection that is already established at that moment SHALL be allowed to complete its in-flight requests. Shutdown SHALL NOT wait for new work to arrive, because doing so would let a shutdown under load never finish.

#### Scenario: The listener stops accepting immediately
- **WHEN** a client attempts to connect after shutdown has begun
- **THEN** the connection is refused and no request on it is served

#### Scenario: A request already underway is not refused
- **WHEN** shutdown begins while a request is being handled
- **THEN** that request is neither dropped nor refused and is allowed to finish

#### Scenario: Shutdown does not wait for new work
- **WHEN** clients keep connecting and sending requests throughout a drain
- **THEN** the shutdown still completes within the configured drain timeout

### Requirement: In-flight requests are awaited for the configured drain timeout
Shutdown SHALL wait for in-flight requests to complete for up to the configured drain timeout, and SHALL honour the configured value as given rather than substituting a shorter fixed wait. A request still running when the timeout has not yet elapsed SHALL be allowed to finish, and its response status and body SHALL be exactly what they would have been had no shutdown occurred. A configured timeout of zero SHALL skip the wait entirely. The shutdown test suite SHALL assert that an in-flight request completes with its own response, because asserting only that the port stops answering and the process exits proves nothing about the request that was cut off.

#### Scenario: A request inside the window completes normally
- **WHEN** a request that takes longer than the fixed wait would allow but shorter than the configured drain timeout is in flight when shutdown begins
- **THEN** it receives its own successful response with its real body, and the shutdown does not resolve before that response is written

#### Scenario: The configured value is the value used
- **WHEN** shutdown is invoked with a drain timeout and a request is held for a duration below that value
- **THEN** the wait lasts at least as long as the configured value allows for, and the underlying database and queue are not closed while the request is still running

#### Scenario: The response is unaffected by the shutdown
- **WHEN** an in-flight request completes during a drain
- **THEN** its status code and body are identical to the ones it would have produced without a shutdown in progress

#### Scenario: A zero timeout skips the wait
- **WHEN** shutdown is invoked with a drain timeout of zero
- **THEN** no wait is performed and shutdown proceeds immediately to closing the process resources

#### Scenario: The suite proves the request finished
- **WHEN** the shutdown test suite runs
- **THEN** it asserts that a deliberately held in-flight request received its complete response before shutdown resolved, not only that the port stopped answering and the process exited

### Requirement: Requests outliving the timeout are aborted deliberately
If requests remain when the drain timeout expires, they SHALL be terminated deliberately and that termination SHALL be observable. Each still-writable aborted request SHALL receive a service-unavailable response carrying a machine-readable draining code, and the shutdown summary SHALL report the number of requests drained and the number aborted. Termination SHALL NOT be a side effect of closing an underlying connection, and a request that finishes before the timeout expires SHALL NOT be counted as aborted.

#### Scenario: An expired request is refused with a draining code
- **WHEN** a request is still in flight when the drain timeout expires and its response is still writable
- **THEN** it receives a service-unavailable response carrying a machine-readable draining code instead of being cut off without a response

#### Scenario: The abort count is reported
- **WHEN** a drain ends with requests still outstanding
- **THEN** the shutdown summary reports a non-zero aborted count matching those requests and a drained count for the ones that finished

#### Scenario: A request that finishes in time is not counted as aborted
- **WHEN** an in-flight request completes before the drain timeout expires
- **THEN** it is counted as drained and does not appear in the aborted count

#### Scenario: Termination is not a side effect of closing a connection
- **WHEN** a drain expires with requests outstanding and the underlying resources are closed
- **THEN** every such request was already answered with the draining response and recorded as aborted, rather than failing only because a connection went away

### Requirement: Background jobs reach a terminal or claimable state
On shutdown the queue engine SHALL stop claiming new jobs, so a job enqueued by an in-flight request remains pending and is executed after the process is running again rather than being claimed during shutdown. A job that was executing SHALL either reach a terminal state or be returned to a claimable state with its attempt counter already advanced, so that no job is silently lost and no job consumes two attempts for one claim. A job whose attempt counter has already reached its maximum SHALL be marked failed rather than returned for another run, and a completed job SHALL NOT be executed again after a restart.

#### Scenario: Claiming stops at the start of shutdown
- **WHEN** shutdown begins and a job is enqueued by a request that was in flight
- **THEN** no worker claims it during the shutdown and it remains pending, to be executed after the process is running again

#### Scenario: A finished job is not re-run
- **WHEN** a job completes during a drain and the process is restarted
- **THEN** the job is not executed a second time

#### Scenario: An interrupted job keeps exactly one attempt
- **WHEN** a job is interrupted mid-execution by shutdown and the process is restarted
- **THEN** the job is claimable again, its attempt counter reflects the interrupted claim exactly once, and the next run does not consume an additional attempt for the claim that was interrupted

#### Scenario: An exhausted job is marked failed
- **WHEN** a job is interrupted by shutdown and its attempt counter has already reached its configured maximum
- **THEN** it is recorded as failed rather than returned for another run

### Requirement: Shutdown is idempotent and terminates the process cleanly
Shutdown SHALL be idempotent: a second shutdown signal, or a second invocation of the shutdown operation, SHALL resolve without throwing, SHALL NOT close the database, queue engine or rate limiter twice, and SHALL NOT emit a second terminal summary. A shutdown requested before the server has started SHALL resolve as a no-op. A signal-driven shutdown that drains cleanly SHALL terminate the process with a zero exit status and a single machine-readable summary line reporting the requests drained, the requests aborted and the jobs affected.

#### Scenario: A second signal is harmless
- **WHEN** a termination signal is delivered twice in quick succession
- **THEN** the process still exits with a zero status, no unhandled error is raised, and exactly one shutdown summary is emitted

#### Scenario: A repeated shutdown invocation is harmless
- **WHEN** the shutdown operation is invoked a second time after it has already completed
- **THEN** it resolves without throwing, the database and queue are not closed a second time, and no second summary is emitted

#### Scenario: Shutdown before start is a no-op
- **WHEN** shutdown is invoked on a server instance that was never started
- **THEN** it resolves and closes nothing, without error

#### Scenario: A clean drain exits zero with one summary
- **WHEN** a signal-driven shutdown drains every in-flight request within the configured timeout
- **THEN** the process exits with status zero and emits a single summary line reporting the drained, aborted and job counts
