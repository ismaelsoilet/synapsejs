# Spec Delta

## Purpose

Constrains the two realtime transports — the event-stream gateway and the slice WebSocket upgrade — so that a caller must be authenticated, authorized for the specific topic, and confined to its own tenant before it can read a single broadcast, and so that neither the origin check nor the topic registry can be defeated by leaving configuration unset or by opening names the framework never declared.

## ADDED Requirements

### Requirement: Event-stream subscription requires an authenticated session
A subscription request to the event-stream gateway SHALL be refused with the unauthenticated status and a machine-readable rejection code when the request carries no authenticated session. The gateway SHALL compute the session before it decides, and the computed session SHALL govern the decision rather than being used only for request logging. A refused request SHALL open no stream, SHALL emit no stream preamble, SHALL register no topic, and SHALL start no keep-alive timer, so a rejected subscriber consumes no server resource at all.

#### Scenario: Anonymous subscription is refused
- **WHEN** a client requests the event-stream gateway with no session credentials
- **THEN** the response is the unauthenticated status carrying a machine-readable unauthenticated code, the body is not an event stream, and no topic entry is created for it

#### Scenario: Authenticated subscription is admitted
- **WHEN** a client requests the event-stream gateway with credentials that resolve to an authenticated session
- **THEN** the response is a successful event stream, the stream preamble is written, and events published to a topic the session is authorized to read arrive on it

#### Scenario: Credentials that do not verify are refused
- **WHEN** a client presents a session token that fails verification, including one that has been revoked
- **THEN** the subscription is refused exactly as an anonymous request is, rather than being admitted as anonymous

#### Scenario: A refused subscription leaves no residue
- **WHEN** a subscription is refused and the request is abandoned
- **THEN** the framework holds no topic entry, no listener and no keep-alive timer attributable to that request

### Requirement: Topic access is declared, not inferred
A topic SHALL be declared, together with the roles or permissions permitted to read it and the feature permitted to publish into it, before any subscriber attaches to it or any publisher writes to it. A subscription to a topic that has not been declared SHALL be refused with the not-found status. A subscription to a declared topic whose read rule the session does not satisfy SHALL be refused with the forbidden status. A publish into a topic the publishing feature does not own SHALL be rejected, and the subscribers of the legitimate topic SHALL receive nothing. No topic name is acceptable purely because a caller can spell it in the request path.

#### Scenario: Undeclared topic is refused
- **WHEN** a client subscribes to a topic name that the application never declared
- **THEN** the response is the not-found status carrying a machine-readable topic-not-found code

#### Scenario: Declared topic with a satisfied rule is served
- **WHEN** a client subscribes to a declared topic and its session satisfies that topic's read rule
- **THEN** the response is a successful event stream and events published to that topic are delivered

#### Scenario: Declared topic with an unsatisfied rule is refused
- **WHEN** a client subscribes to a declared topic and its session does not satisfy that topic's read rule
- **THEN** the response is the forbidden status carrying a machine-readable topic-forbidden code, and the stream preamble is never written

#### Scenario: Publishing outside declared ownership is rejected
- **WHEN** a feature publishes into a topic it has not declared ownership of
- **THEN** the publish is rejected with the forbidden code, the number of notified subscribers is zero, and the declared subscribers of that topic receive no event

### Requirement: Topics are confined to the subscriber's tenant
A topic SHALL be resolved within the tenant scope of the subscribing session, and two tenants that use the same topic name SHALL be two independent topics that never observe each other's broadcasts. A request for a topic name that exists only in another tenant's scope SHALL be refused with the not-found status, and the refusal SHALL NOT disclose that the name exists elsewhere. Publishing into a tenant scope other than the publisher's own SHALL be rejected.

#### Scenario: Cross-tenant subscription is refused without disclosure
- **WHEN** a client authenticated for one tenant subscribes to a topic name declared only by another tenant
- **THEN** the response is the not-found status, the body does not reveal that the topic exists in the other tenant, and no event from that tenant is ever delivered on the connection

#### Scenario: Identical topic names stay isolated per tenant
- **WHEN** two tenants each subscribe to the same topic name and an event is published in only one of them
- **THEN** the subscriber in the publishing tenant receives the event and the subscriber in the other tenant receives nothing

#### Scenario: Cross-tenant publish is rejected
- **WHEN** a feature operating in one tenant attempts to publish into another tenant's topic scope
- **THEN** the publish is rejected, and the other tenant's subscribers receive nothing

### Requirement: The topic registry and open subscriptions are bounded
The number of registered topics and the number of concurrently open subscriptions SHALL each be bounded by configuration, and the rate limiter SHALL NOT be the only bound on long-lived connections. A subscription or upgrade that would exceed a bound SHALL be refused with the too-many-requests status, a rate-limit rejection code and a retry-after header. A topic entry and every resource held for it SHALL be released when its last subscriber disconnects, including when the client aborts mid-stream, so that repeated connect-and-disconnect cycles leave no residue behind.

#### Scenario: Registry bound is enforced
- **WHEN** more distinct topic names are subscribed to concurrently than the configured registry bound allows
- **THEN** the subscriptions beyond the bound are refused with the too-many-requests status, a machine-readable limit code and a retry-after header, and the number of registered topics never exceeds the bound

#### Scenario: Disconnect releases the topic entry
- **WHEN** a client subscribes to a topic and then disconnects
- **THEN** the topic entry and its listener are removed, and a later subscription to the same name is admitted rather than refused as an exhaustion

#### Scenario: Abort mid-stream releases resources
- **WHEN** a client aborts an event stream while it is open
- **THEN** the keep-alive timer is cleared and the topic entry is released, and no further event is delivered to that connection

#### Scenario: Repeated churn does not grow the registry
- **WHEN** many clients each subscribe to a distinct new topic name and disconnect, repeatedly
- **THEN** the registered-topic count returns to its baseline after each round and does not grow across rounds

### Requirement: WebSocket upgrades fail closed on origin
A WebSocket upgrade SHALL be refused with the forbidden status and a machine-readable origin rejection code unless the request carries a present origin that matches the configured allow-list, or the allow-list contains the wildcard. When no allow-list is configured the upgrade SHALL be refused, because an absent allow-list SHALL NOT be treated as permitting every origin. An absent origin and an opaque origin SHALL both be refused, and no configuration state SHALL permit an unmatched or absent origin. This is a breaking change and is deliberately the same posture the cross-origin policy already takes for ordinary requests.

#### Scenario: Unconfigured allow-list refuses every upgrade
- **WHEN** a client attempts a WebSocket upgrade while no allowed-origins configuration is present
- **THEN** the upgrade is refused with the forbidden status and a machine-readable origin rejection code, and the connection is not upgraded

#### Scenario: Listed origin is admitted
- **WHEN** a client attempts a WebSocket upgrade carrying an origin that appears in the configured allow-list
- **THEN** the upgrade completes and messages flow over the resulting connection

#### Scenario: Unlisted origin is refused
- **WHEN** a client attempts a WebSocket upgrade carrying an origin absent from the configured allow-list
- **THEN** the upgrade is refused with the forbidden status and a machine-readable origin rejection code

#### Scenario: Absent origin is refused
- **WHEN** a client attempts a WebSocket upgrade with no origin header at all
- **THEN** the upgrade is refused rather than treated as a client that bypassed the check

#### Scenario: Opaque origin is refused
- **WHEN** a client attempts a WebSocket upgrade carrying an opaque origin
- **THEN** the upgrade is refused with the forbidden status and a machine-readable origin rejection code

### Requirement: Both realtime transports share one rate limit and one connection cap
The event-stream gateway and the WebSocket upgrade SHALL consume from the same bounded, spoof-resistant rate limiter, and each SHALL additionally enforce a per-client cap on concurrently open long-lived connections. A refused request SHALL be answered with the too-many-requests status, a rate-limit rejection code and a retry-after header. Connections already open SHALL continue to work when a further connection is refused.

#### Scenario: Rate limit is shared across both transports
- **WHEN** a client exhausts the rate allowance using one realtime transport
- **THEN** a request to the other realtime transport is refused with the too-many-requests status, a rate-limit code and a retry-after header

#### Scenario: Concurrent connection cap is enforced per client
- **WHEN** a client holds more concurrently open realtime connections than the configured per-client cap
- **THEN** the attempt that exceeds the cap is refused with the too-many-requests status and a retry-after header, while the connections already open continue to deliver

#### Scenario: A long-lived connection cannot be used to bypass the cap
- **WHEN** a client closes and immediately reopens a long-lived realtime connection repeatedly from the same address
- **THEN** it is refused while it is above the cap, rather than being admitted on the grounds that each individual request consumed only one token

### Requirement: Realtime rejections are machine-resolvable
Every refusal on either realtime transport SHALL be a JSON body carrying a false success flag, an English machine-readable error code and a human-readable Portuguese message, and the set of codes it can emit SHALL be exactly: unauthenticated, topic-not-found, topic-forbidden, rate-limit-exceeded, a realtime-limit code for registry and connection bounds, and origin-not-allowed. The machine-readable authoring contract SHALL enumerate these codes together with the status each one is returned with, and a refusal SHALL never be expressed only as a status with no code.

#### Scenario: Refusal bodies carry a code and a message
- **WHEN** any realtime transport refuses a request for any reason covered by this specification
- **THEN** the body carries a false success flag, one of the declared error codes, and a non-empty human-readable message

#### Scenario: The contract enumerates the codes and statuses
- **WHEN** the machine-readable authoring contract is read
- **THEN** it lists every realtime rejection code with the status it is returned with, and the list matches the codes the transports can actually emit

#### Scenario: A successful stream carries no error body
- **WHEN** a subscription is admitted
- **THEN** the response is an event stream and carries no error code

#### Scenario: An undeclared code cannot be invented
- **WHEN** a realtime refusal is produced
- **THEN** its code is one of the declared codes, and a new code introduced without being added to the contract fails the contract test
