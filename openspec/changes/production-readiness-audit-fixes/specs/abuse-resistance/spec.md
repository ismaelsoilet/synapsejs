# Spec Delta

## Purpose

Establishes that every request-accepting surface of the framework — including server-rendered page loads, diagnostic endpoints and the remote-image fetch path, not only the write endpoints — is bounded against flooding, spoofing and resource exhaustion, and that size ceilings are enforced on the byte stream rather than on a client-declared value.

## ADDED Requirements

### Requirement: Rate limiting covers every accepting surface
Request rate limiting SHALL apply to every surface that accepts a request, including the remote-procedure-call, file, webhook, server-sent-event, remote-image-optimizer, health, repository-map and metrics paths, and to server-rendered page loads. A request that exceeds its allowance SHALL be refused with status 429, SHALL carry a `Retry-After` header, and SHALL return a machine-resolvable refusal identifier in the same JSON error shape the other endpoints use.

#### Scenario: Uncovered endpoint is now bounded
- **WHEN** the remote-image-optimizer, health, repository-map and metrics paths are each flooded beyond their allowance
- **THEN** each returns 429 rather than serving the request

#### Scenario: Rendered page load is bounded
- **WHEN** server-rendered page loads exceed the allowance for a client identity
- **THEN** the render is refused with 429 before any loader or action executes

#### Scenario: Refusal is machine-resolvable
- **WHEN** any bounded surface refuses a request
- **THEN** the response status is 429, a `Retry-After` header is present, and the body carries a stable refusal identifier

#### Scenario: Allowance is replenished over time
- **WHEN** a client stops sending requests until the allowance window elapses
- **THEN** its next request is served rather than refused

### Requirement: Proxy header trust is opt-in
Forwarding headers SHALL NOT be trusted for client-identity resolution unless the deployment explicitly declares that it runs behind a trusted proxy. When they are not trusted, client identity SHALL be derived from the immediate peer address, and a rotating `X-Forwarded-For`, `X-Real-IP` or equivalent value SHALL NOT produce a fresh allowance.

#### Scenario: Rotated forwarding header yields one allowance
- **WHEN** a direct client sends a burst of requests each carrying a different `X-Forwarded-For` value and the deployment has not declared a trusted proxy
- **THEN** all requests resolve to the same client identity and the burst is refused once the allowance is exhausted

#### Scenario: Trusted proxy mode uses the proxy-declared address
- **WHEN** the deployment explicitly declares a trusted proxy
- **THEN** client identity is taken from the proxy-declared address and rate limiting remains effective

#### Scenario: Default is not trust
- **WHEN** a deployment reads its effective rate-limiting configuration without setting any proxy declaration
- **THEN** forwarding headers are not trusted

### Requirement: Allowance state cannot be flushed by spoofed identities
The allowance registry SHALL have a bounded capacity, and reaching that capacity SHALL NOT grant unlimited service by discarding the counters of clients that are currently over their allowance. When the registry is saturated, the framework SHALL either refuse the excess or extend capacity, and the choice SHALL be stated in the documentation. A client over its allowance SHALL continue to be refused after the registry has been saturated with distinct synthetic identities.

#### Scenario: Saturated registry does not forgive an abuser
- **WHEN** a client has exhausted its allowance and the registry is then filled to capacity with distinct synthetic client identities
- **THEN** the original client is still refused

#### Scenario: Saturation behaviour is stated
- **WHEN** the documentation describing rate limiting is read
- **THEN** it states what happens when the allowance registry reaches capacity

#### Scenario: Registry growth stays bounded
- **WHEN** an unbounded stream of distinct client identities is presented
- **THEN** the registry's size remains within its declared bound

### Requirement: Per-process state is scoped in documentation
The rate limiter, the server-render response cache and the realtime event hub SHALL each hold their state in the serving process only. Documentation SHALL state this per-process scope explicitly, SHALL state that a restart discards that state, and SHALL state the consequence for a deployment running N instances behind a load balancer: the effective allowance and cache-hit behaviour are per instance, not global. Documentation SHALL NOT describe any of these as global, cluster-wide or shared unless a shared backend is actually configured.

#### Scenario: Documentation states per-process scope
- **WHEN** the documentation describing rate limiting, the response cache and the event hub is read
- **THEN** each is described as holding state in the serving process, with the restart consequence stated

#### Scenario: Multi-instance multiplier is stated
- **WHEN** a deployment runs N instances behind a load balancer and the documentation describes rate limiting
- **THEN** it states that an effective request spread across N instances permits N times the per-instance allowance

#### Scenario: Restart clears state
- **WHEN** the serving process restarts
- **THEN** rate-limit counters, cached responses and buffered events held only in that process are gone

#### Scenario: No global claim without a shared backend
- **WHEN** no shared backend is configured and the documentation is inspected for a claim that any of these behaviours are global or cluster-wide
- **THEN** no such claim is present

### Requirement: Upload ceilings are enforced on the byte stream
Every request body that is read SHALL be subject to a size ceiling that is enforced while the bytes arrive, not only by comparing a client-declared length. An absent or unparsable content-length header SHALL NOT be treated as a declared length of zero and SHALL NOT cause the check to be skipped; a body whose actual size exceeds the ceiling SHALL be refused with status 413 and a machine-resolvable oversize identifier, and the server SHALL NOT buffer the whole body to discover the violation. The framework SHALL enforce a process-level body ceiling across all body-reading paths so that no single request exhausts process memory.

#### Scenario: Chunked upload without a declared length is refused
- **WHEN** a multipart upload whose size exceeds the ceiling is sent without a content-length header
- **THEN** the response is 413 with a machine-resolvable oversize identifier, and the body is not fully buffered

#### Scenario: Unparsable declared length does not pass the check
- **WHEN** a request carries a content-length header that cannot be parsed as a length
- **THEN** the request is bounded by the streaming ceiling rather than being admitted as a zero-length body

#### Scenario: Oversized declared length is refused before reading
- **WHEN** a request declares a content-length greater than the ceiling
- **THEN** the response is 413 and the body is never read

#### Scenario: Oversized body fails mid-stream
- **WHEN** a request sends more bytes than the ceiling without declaring a length
- **THEN** the transfer is aborted at the ceiling and the client receives 413

#### Scenario: The body is not buffered twice
- **WHEN** a multipart upload within the ceiling succeeds
- **THEN** its bytes are materialized at most once in process memory

#### Scenario: Process ceiling covers every path
- **WHEN** each body-reading endpoint is presented with a body larger than the process-level ceiling
- **THEN** every one of them refuses the request rather than reading it

### Requirement: Remote-image fetching is bounded and allowlisted
The remote-image fetch path SHALL enforce a maximum response size and a maximum fetch duration, and SHALL refuse a target whose host is not on the configured allowlist. When no allowlist is configured, the deployment SHALL be treated as permitting any publicly routable host and the documentation SHALL say so explicitly rather than implying a restriction that is not enforced. The path SHALL be subject to the same rate limiting as any other accepting surface.

#### Scenario: Oversized upstream response is refused
- **WHEN** the remote host returns a body larger than the configured maximum response size
- **THEN** the request is refused without buffering the whole response and without exhausting process memory

#### Scenario: Slow upstream is cut off
- **WHEN** the remote host does not respond within the configured maximum duration
- **THEN** the request fails with a timeout-class status and the connection to the remote host is closed

#### Scenario: Host outside the allowlist is refused
- **WHEN** a target whose host is not on the configured allowlist is requested
- **THEN** the response is 403 with a machine-resolvable refusal identifier

#### Scenario: Default allowlist behaviour is documented
- **WHEN** no allowlist is configured and the documentation for the remote-image path is read
- **THEN** it states that any publicly routable host is permitted, rather than claiming a default restriction

### Requirement: Validated target address is the address that is fetched
When a target URL for an outbound fetch has been validated, the fetch SHALL be issued against the address that was validated, and the target SHALL NOT be re-resolved and re-connected under the original hostname. A hostname whose resolution changes between the validation check and the fetch SHALL NOT cause the fetch to reach a private, loopback, link-local or cloud-metadata address. Each redirect hop of an outbound fetch SHALL be validated under the same rules as the original target.

#### Scenario: Rebinding between check and fetch cannot reach a private address
- **WHEN** a hostname resolves to a publicly routable address during validation and to a private or link-local address when the fetch connects
- **THEN** the request fails with a refusal status and no connection is made to the private address

#### Scenario: Redirect hops are revalidated
- **WHEN** a validated external target responds with a redirect to a host that is not on the allowlist or resolves to a private address
- **THEN** the redirect is refused rather than followed

#### Scenario: Documentation does not overclaim
- **WHEN** the documentation describes the outbound-URL validation behaviour
- **THEN** it does not claim that domain-rebinding is prevented unless the shipped behaviour prevents it, and the wording matches the observed behaviour
