# Spec Delta

## Purpose

Establishes a baseline set of security response headers, a generic error surface, a non-disclosing diagnostic endpoint and secret-redacting output across every response the framework emits — including server-rendered pages, error pages, static files and machine-readable command output — so that neither a browser nor an unauthenticated caller is able to read internal detail or supply executable script from a third-party origin.

## ADDED Requirements

### Requirement: Baseline security headers on every response
Every HTTP response the framework emits SHALL carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a clickjacking protection expressing `DENY` in both `X-Frame-Options` and `frame-ancestors`, and every response delivered over TLS SHALL carry a `Strict-Transport-Security` directive with a `max-age` of at least one year. Responses that terminate before routing completes — including unmatched paths, method-not-allowed and pre-dispatch refusals — SHALL carry the same headers as a routed response.

#### Scenario: Rendered page carries the baseline headers
- **WHEN** a server-rendered slice page is requested
- **THEN** the response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a `frame-ancestors 'none'` directive

#### Scenario: Error page carries the baseline headers
- **WHEN** a server-side render crashes and the internal-error page is returned with status 500
- **THEN** that response carries the same baseline headers as a successful page response

#### Scenario: Static asset carries the baseline headers
- **WHEN** a file served from the public directory is requested
- **THEN** the response carries the baseline headers, including the clickjacking directives

#### Scenario: Unrouted path carries the baseline headers
- **WHEN** a request matches no route and no static file
- **THEN** the 404 response carries the baseline headers

#### Scenario: Transport directive appears only on TLS
- **WHEN** responses are inspected over a plaintext connection and over a TLS connection
- **THEN** `Strict-Transport-Security` is present on the TLS response and absent on the plaintext response

### Requirement: Script execution is restricted to the application origin
Every HTML response SHALL carry a `Content-Security-Policy` header whose `default-src`, `script-src` and `object-src` directives do not permit executable script from a third-party origin unless the operator has explicitly enabled that origin. A restrictive policy SHALL be the default state, and no response SHALL be delivered as HTML without a policy.

#### Scenario: Default policy excludes third-party script
- **WHEN** a rendered page is requested with no security configuration
- **THEN** the `Content-Security-Policy` header is present and its script directives reference only the application origin and `'unsafe-inline'` where an inline bootstrap script requires it

#### Scenario: Enabled third-party origin is declared in the policy
- **WHEN** a third-party script origin is explicitly enabled by the operator
- **THEN** that origin appears in the `script-src` directive of the emitted `Content-Security-Policy`

#### Scenario: Operator-supplied policy is honoured
- **WHEN** the deployment supplies its own content-security-policy
- **THEN** the emitted policy is the operator's policy, or a merge that is never weaker than the operator's, and no response omits it

### Requirement: Third-party CDN and font origins are opt-in
The runtime JavaScript compiler and web-font origins SHALL NOT be referenced by a rendered page unless explicitly enabled by the operator, and enabling them SHALL require adding the origin to the content-security policy in the same operation. A stylesheet shipped by the application itself SHALL take precedence over any third-party origin, and every third-party subresource the application does reference SHALL carry a subresource-integrity attribute.

#### Scenario: Default render references no third-party origin
- **WHEN** a page is rendered with no security configuration
- **THEN** the response body contains no reference to `cdn.tailwindcss.com` and no reference to `fonts.googleapis.com`

#### Scenario: Explicit opt-in restores the origins
- **WHEN** the operator explicitly enables the third-party script and font origins
- **THEN** both references reappear in the rendered body and the content-security policy of that response permits them

#### Scenario: Application stylesheet wins
- **WHEN** the application ships its own stylesheet in the public directory
- **THEN** the rendered page links that stylesheet and does not additionally link a third-party stylesheet

#### Scenario: Third-party subresource carries integrity
- **WHEN** any third-party subresource is referenced by a rendered page
- **THEN** that element carries a subresource-integrity attribute

### Requirement: Internal error detail is not disclosed to clients
When a request fails with an unexpected internal failure, the response body SHALL contain a stable, machine-resolvable error identifier and no part of the underlying exception text, no driver message, and no absolute filesystem path, regardless of whether the failure arose in the remote-procedure-call path, the webhook path, the upload path, the image-optimizer path or the render path. The full exception text SHALL be written to the server log only, and the response SHALL carry a correlation identifier that appears in both the response body and the log record for that request.

#### Scenario: Call path failure body is generic
- **WHEN** an action raises an unexpected internal failure while executing a remote procedure call and the deployment runs in production mode
- **THEN** the response is a 500 whose body carries a fixed internal-error identifier and a correlation identifier, and does not contain the exception message or driver text

#### Scenario: Upload failure body omits filesystem paths
- **WHEN** an unexpected failure occurs while storing an upload
- **THEN** the response body contains no absolute filesystem path, and the underlying message appears only in the server log

#### Scenario: Image-optimizer failure body is generic
- **WHEN** an unexpected failure occurs while fetching or transforming a remote image
- **THEN** the response body carries a fixed internal-error identifier rather than the exception message

#### Scenario: Correlation identifier links body to log
- **WHEN** a response carrying an internal-error identifier is obtained
- **THEN** the same correlation identifier is present on a server log record for that request, and the full exception text appears in that record

#### Scenario: Development mode retains detail
- **WHEN** the deployment is not running in production mode and an internal failure occurs
- **THEN** the response body includes the exception text, and the same request against a production-mode deployment does not

### Requirement: Credentials are redacted from all diagnostic output
No CLI command, model-context-protocol tool result, log record, health payload or thrown error message emitted by the framework SHALL contain a database connection string with its password, an authorization header value, a session token or a cookie value. Where a credential must be shown to make a diagnostic actionable, it SHALL be replaced by a redaction marker that preserves the non-secret surrounding structure.

#### Scenario: Connection string error is redacted
- **WHEN** the database factory rejects a connection string whose scheme is unsupported
- **THEN** the error message identifies the scheme and host but contains no password, and a password present in the input is replaced by a redaction marker

#### Scenario: Command output is redacted
- **WHEN** a CLI command fails while a database connection string with a password is set in the environment
- **THEN** neither the human-readable output nor the machine-readable JSON contains the password

#### Scenario: Tool result is redacted
- **WHEN** a model-context-protocol tool call fails and its result is serialized
- **THEN** no bearer token, session token or cookie value present in the underlying error is present in the serialized result

#### Scenario: Redaction covers nested occurrences
- **WHEN** a credential appears nested inside an error message, a structured field or a rendered error page
- **THEN** it is redacted at every occurrence rather than only at the top level

### Requirement: Unauthenticated diagnostic endpoints disclose no internals
The health endpoint SHALL require no authentication and SHALL therefore expose only an aggregate status, the database connectivity verdict, a count of loaded slices and the framework version. It SHALL NOT expose absolute filesystem paths, the list of paths examined during slice discovery, internal load-error text, or the route and remote-procedure-call inventory. The detailed inventory SHALL be available only on a separately authenticated request, and the unauthenticated payload SHALL be byte-identical whether or not the deployment has failures to report.

#### Scenario: Unauthenticated health payload is minimal
- **WHEN** the health endpoint is requested without credentials
- **THEN** the payload contains an aggregate status, a database connectivity verdict, a loaded-slice count and the framework version, and contains no absolute path, no discovery-candidate list and no load-error text

#### Scenario: Route table is not published anonymously
- **WHEN** the health endpoint is requested without credentials
- **THEN** no slice route and no remote-procedure-call path appears anywhere in the response

#### Scenario: Discovery candidates are not published anonymously
- **WHEN** slice discovery failed and recorded the paths it examined
- **THEN** those paths are absent from the unauthenticated health payload

#### Scenario: Degraded status is disclosed without internals
- **WHEN** the database is unreachable and the health endpoint is requested without credentials
- **THEN** the response is a 503 with aggregate status `DEGRADED` and a disconnected database verdict, and carries no driver error text

#### Scenario: Inventory requires authentication
- **WHEN** the detailed inventory is requested with valid credentials
- **THEN** the response includes the route and remote-procedure-call inventory and the load-error detail

### Requirement: Static-file containment and output escaping remain invariants
Serving a static file SHALL require the resolved path to remain inside the public directory, and any request whose normalized path escapes it — by traversal segments, percent-encoding, or an absolute path — SHALL be refused with a client error and SHALL NOT disclose the resolved absolute path. Every value interpolated into a rendered HTML response SHALL be HTML-escaped, including values originating from a discovery failure, a load error, an uploaded file name and an exception message.

#### Scenario: Traversal is refused
- **WHEN** a static request path resolves outside the public directory
- **THEN** the response is a client error and does not disclose the resolved path

#### Scenario: Encoded traversal is refused
- **WHEN** a static request path uses percent-encoded traversal segments
- **THEN** the path is normalized before the containment check and the request is refused

#### Scenario: Interpolated values are escaped
- **WHEN** a rendered response interpolates a discovery-candidate path, a load-error message, a file name or an exception message
- **THEN** the emitted HTML contains the escaped form of the value and no executable markup introduced by it
