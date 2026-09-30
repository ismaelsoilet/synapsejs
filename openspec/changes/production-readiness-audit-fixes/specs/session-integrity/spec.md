# Spec Delta

## Purpose

Makes the session path honest about what it actually guarantees: cookies are secure by construction rather than by caller vigilance, tenant identity comes only from cryptographically verified claims, revocation is consulted on every request and is bounded in memory and on disk, and a deployment that has not configured a session secret is refused rather than quietly trusting headers.

## ADDED Requirements

### Requirement: Session cookie attributes are secure by default
A cookie written through the response-cookie surface SHALL carry the secure flag, the script-inaccessible flag and a same-site policy of lax when the caller does not state otherwise. A caller SHALL be able to state a stricter same-site policy explicitly, and an attribute stated explicitly SHALL apply in place of its default; the framework SHALL NOT infer a weaker attribute from anything except an explicit statement. This is a breaking change: a cookie written with no options at all is no longer readable by script and is no longer sent on a cross-site request. The test suite SHALL exercise the default by writing a cookie with no attribute options, because a test that passes the flags explicitly proves only that the serializer honours them, not that it applies them.

#### Scenario: No options yields a hardened cookie
- **WHEN** a cookie is written with no attribute options
- **THEN** the emitted cookie carries the secure flag, the script-inaccessible flag, same-site lax and a root path

#### Scenario: An explicit stricter policy is honoured
- **WHEN** a cookie is written with an explicit same-site policy of strict
- **THEN** the emitted cookie carries that policy together with the remaining default attributes

#### Scenario: Explicit attributes are not overridden
- **WHEN** a cookie is written with an attribute stated explicitly
- **THEN** the emitted cookie carries the stated value for that attribute rather than the default

#### Scenario: The documented no-option call site is hardened
- **WHEN** the documented usage of writing a session cookie with no options is exercised end to end and the resulting response cookie header is inspected
- **THEN** the header carries the secure flag, the script-inaccessible flag and same-site lax, with no options supplied by the caller

#### Scenario: The default is proven without passing the flags
- **WHEN** the cookie serialization tests are run with the secure, script-inaccessible and same-site options omitted from every call
- **THEN** they pass, and a serializer that emits the cookie without the default attributes makes them fail

### Requirement: A script-written session cookie is disclosed as script-readable
The browser-side session helper writes the session cookie from client script, and a cookie written that way cannot carry the script-inaccessible flag. The framework SHALL NOT claim otherwise. The machine-readable authoring contract and the project documentation SHALL state that a script-written session cookie is readable by any script in the origin, and SHALL state that a session that must be unreachable by script is obtained from the response cookie the server emits. No document SHALL claim that the browser-written cookie is script-inaccessible.

#### Scenario: The contract states the constraint
- **WHEN** the machine-readable authoring contract is read
- **THEN** it states that the browser-written session cookie is readable by script and identifies the server-emitted response cookie as the path for a session that must not be

#### Scenario: The browser-written cookie does not claim inaccessibility
- **WHEN** the cookie string produced by the browser-side session helper is inspected
- **THEN** it carries the path, lifetime and same-site attributes and does not assert the script-inaccessible flag, and no output of that helper claims it does

#### Scenario: The server-emitted cookie is the protected path
- **WHEN** the same session token is written by the server through the response-cookie surface with no attribute options
- **THEN** the emitted cookie carries the script-inaccessible flag, unlike the one written from the browser

#### Scenario: No false claim survives in documentation
- **WHEN** every documentation file is searched for a statement that the browser session cookie is protected from script access
- **THEN** no such statement is found, because the browser-written cookie is readable by script by construction

### Requirement: Tenant identity is derived only from verified claims
When a session secret is configured, the tenant of an authenticated request SHALL be taken exclusively from the verified token claims. A validly signed token that carries no tenant claim SHALL yield a session with no tenant, and a tenant header or a tenant subdomain SHALL NOT supply one in its place. The tenant header and the tenant subdomain SHALL be ignored for identity purposes whenever a session secret is configured, so a signed token with no tenant claim plus a spoofed tenant header can never yield the spoofed tenant.

#### Scenario: Verified claim wins over a spoofed header
- **WHEN** a request presents a validly signed token whose claims name one tenant and also sends a tenant header naming another
- **THEN** the resolved session carries the tenant from the verified claims and not the header value

#### Scenario: Missing claim does not fall back to the header
- **WHEN** a request presents a validly signed token with no tenant claim and sends a tenant header
- **THEN** the resolved session carries no tenant, and the header value is not adopted

#### Scenario: Missing claim does not fall back to the subdomain
- **WHEN** a request presents a validly signed token with no tenant claim and arrives on a host whose subdomain names a tenant
- **THEN** the resolved session carries no tenant, and the subdomain value is not adopted

#### Scenario: Header and subdomain are ignored when a secret is configured
- **WHEN** a session secret is configured and a request carries only a tenant header and a tenant subdomain, with no signed token
- **THEN** the request resolves to an anonymous session carrying no tenant, and neither unverified source is used

#### Scenario: The unverified tenant sources are documented as unverified
- **WHEN** the machine-readable authoring contract is read
- **THEN** it states that the tenant is taken from verified claims when a session secret is configured, and does not claim that the tenant is locked to verified tokens while an unverified fallback exists

### Requirement: Revocation is consulted on every request
Request authentication SHALL consult the revocation store, and SHALL consult the persisted store rather than relying on the in-process set alone. A token revoked through the database-backed revocation API SHALL NOT authenticate any later request. A valid signature SHALL NOT by itself be sufficient to authenticate: a token whose revocation is recorded anywhere the request path consults resolves to no session. The verification result for a revoked token SHALL remain the machine-readable revoked-token code, and the invalid and expired codes SHALL be preserved unchanged.

#### Scenario: A database-revoked token stops authenticating
- **WHEN** a token is revoked through the database-backed revocation API and a later request presents it
- **THEN** the request resolves to an anonymous session and the protected surface refuses it

#### Scenario: Revocation survives a restart
- **WHEN** a token is revoked, the process is restarted, and a request presents the same token
- **THEN** the request resolves to an anonymous session, because the persisted record is consulted and not only the in-process set

#### Scenario: A valid signature alone is not sufficient
- **WHEN** a request presents a token whose signature verifies and whose revocation is recorded in the persisted store
- **THEN** the request resolves to an anonymous session rather than to the session the signature would otherwise authorise

#### Scenario: The revoked-token code is preserved
- **WHEN** a revoked token is verified through the verification surface
- **THEN** the result carries the machine-readable revoked-token code, and the invalid-token and expired-token codes are unchanged from their previous values

### Requirement: Revocation storage is bounded in memory and on disk
The in-process revocation set and the persisted revocation table SHALL each be bounded, by a maximum number of entries, a retention window, or both, and expired entries SHALL be pruned. Neither store SHALL grow without limit over the lifetime of a process or a database. Where a retention window is configured, an entry older than that window SHALL be dropped, and a pruned entry SHALL be observable as a normal prune rather than as an error. The persisted table SHALL carry the revocation time it needs in order to prune without a second source.

#### Scenario: The in-process set stays bounded
- **WHEN** revocations are added until the configured in-process cap is exceeded
- **THEN** the oldest entries are evicted, the set never exceeds the cap, and no error is raised

#### Scenario: The persisted table carries a revocation time
- **WHEN** a revocation is persisted
- **THEN** the stored record carries the instant it was revoked, which is the information pruning requires

#### Scenario: Expired entries are pruned
- **WHEN** entries older than the retention window exist in either store
- **THEN** they are removed by pruning and are no longer reported as present, and the remaining entries are unaffected

#### Scenario: A long-lived process does not grow the stores without bound
- **WHEN** revocations are added continuously over a long-running process
- **THEN** the size of each store stays at or below its configured bound, independent of how many revocations were issued

### Requirement: Production without a session secret fails closed
When the process is in production mode and no session secret is configured, every request SHALL resolve to an anonymous session and identity and role headers SHALL be ignored, and a start command SHALL NOT continue silently in that state: it SHALL exit with a non-zero status and a machine-readable code naming the missing configuration, unless the operator explicitly acknowledges the risk with the declared acknowledgement flag. When the acknowledgement flag is passed the server SHALL start and SHALL emit a warning naming the risk it is accepting. Detection of production mode SHALL NOT depend on one exact spelling of the environment value, so a value the operator clearly intends as production is treated as production.

#### Scenario: Production without a secret resolves to anonymous
- **WHEN** a request carrying an identity header and a role header arrives while the process is in production mode with no session secret configured
- **THEN** the request resolves to an anonymous session and a protected surface refuses it

#### Scenario: Starting in that state is refused
- **WHEN** a start command is run in production mode with no session secret configured and without the acknowledgement flag
- **THEN** the process exits with a non-zero status and reports a machine-readable code identifying the missing session secret

#### Scenario: The acknowledgement flag permits a deliberate start
- **WHEN** a start command is run in production mode with no session secret and the acknowledgement flag is passed
- **THEN** the server starts and emits a warning naming the risk of trusting caller-supplied identity headers

#### Scenario: A near-miss environment value is still production
- **WHEN** a start command is run with an environment value that is clearly intended as production but differs from the exact production spelling
- **THEN** the process is treated as being in production mode and the missing session secret is refused

### Requirement: Caller-supplied identity headers require an explicit development opt-in
Without a session secret, identity and role headers and the browser role cookie SHALL be honoured only when the environment explicitly opts into development header trust. The default in every other case, including an unset environment value, a staging value and any value the operator did not choose deliberately, SHALL be to resolve the request to an anonymous session. This preserves the documented local convenience while making the insecure posture something the operator asks for by name rather than something a mistyped variable silently grants.

#### Scenario: Headers are ignored without the opt-in
- **WHEN** a request carrying an identity header and a role header arrives with no session secret and no development opt-in
- **THEN** the request resolves to an anonymous session and a protected surface refuses it

#### Scenario: An unset environment value is not a development opt-in
- **WHEN** the environment value that selects the runtime mode is unset, no session secret is configured, and identity headers are sent
- **THEN** the request resolves to an anonymous session

#### Scenario: A staging value is not a development opt-in
- **WHEN** the runtime mode is set to a staging value, no session secret is configured, and identity headers are sent
- **THEN** the request resolves to an anonymous session

#### Scenario: The development opt-in restores local behaviour
- **WHEN** the environment explicitly opts into development header trust, no session secret is configured, and a request carries an identity header and a role header
- **THEN** the request resolves to the session those headers describe, preserving the documented local development behaviour

#### Scenario: The opt-in is discoverable
- **WHEN** the machine-readable authoring contract is read
- **THEN** it states that caller-supplied identity headers are honoured only under an explicit development opt-in, and names that opt-in
