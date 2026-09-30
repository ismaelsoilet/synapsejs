# Migrating from 1.8 to 1.9

1.9 is a **security-hardening release**. The framework works the same way for a correct
deployment; what changed is that four behaviours which used to be insecure *by default* are now
refused unless you ask for them explicitly. An application on 1.8 keeps running after the upgrade
once the configuration below is in place.

Nothing in the slice contract changed: the same `*.slice.tsx` file, the same exports, the same
`Result<T, E>` actions. If your app never relied on the insecure defaults, you have nothing to do.

---

## Before you upgrade

```bash
bun install                                   # resolve 1.9
bun run check                                 # types
bun run synapse test                          # your slice oracles
```

Then walk the four breaking changes below. Each one names the symptom you would see, why it
changed, and the exact flag or call that restores the old behaviour *where restoring it is safe*.

---

## 1. `synapse start` refuses to run in production without a session secret

**Symptom:** the process exits with status 1 and prints
`{"status":"FAIL","code":"MISSING_SESSION_SECRET", ...}`.

**Why:** without `SYNAPSE_SESSION_SECRET` every identity header (`x-user-id`, `x-user-roles`) is
attacker-controlled, and a production server that trusts them is an authentication bypass waiting to
be found. The previous behaviour — warn and start anyway — is what this release removes.

**Fix (recommended):**

```bash
SYNAPSE_SESSION_SECRET="$(openssl rand -base64 48)" bun run start
```

Your login slice signs sessions with `signSessionToken(claims, secret)`; the server now verifies them
and takes **the tenant exclusively from the verified claims** (a signed token without a tenant claim
yields a session without a tenant — the `x-tenant-id` header and the subdomain are ignored whenever a
secret is configured).

**Fix (deliberate risk):**

```bash
bun run start --acknowledge-insecure          # or SYNAPSE_ACKNOWLEDGE_INSECURE=true
```

The server starts, warns, and every request resolves to an anonymous session.

**Development is unaffected:** `synapse dev` keeps working as before.

---

## 2. Identity headers require an explicit development opt-in

**Symptom:** in local development, `x-user-id` / `x-user-roles` (and the `synapse_roles` cookie) stop
producing a session; pages render as anonymous.

**Why:** "no secret configured" no longer means "trust the headers". Only an explicit opt-in does,
so an unset, `staging` or misspelled environment value can no longer silently grant identity.

**Fix:**

```bash
SYNAPSE_DEV_HEADERS=true bun run dev
```

`NODE_ENV=development` (or `test`) is also accepted as the opt-in. If you prefer, sign a real token
in development instead — the login slice template
(`synapse new-slice auth login --template=login`) already does it.

---

## 3. Server-sent events require a declared topic

**Symptom:** `GET /_synapse/sse/<topic>` answers `404 TOPIC_NOT_FOUND`, `401 UNAUTHENTICATED` or
`403 TOPIC_FORBIDDEN`.

**Why:** the gateway accepted any topic name from any caller, so any client could read any broadcast
it could spell. Access is now declared, and topics are namespaced per tenant — two tenants using the
same name never see each other's events.

**Fix:** declare the topic in the slice that owns it.

```ts
import { defineTopic } from 'synapsejs';

export const ticketsTopic = defineTopic({
  name: 'tickets',
  owner: 'tickets/view-tickets',   // the slice key allowed to broadcast into it
  readRoles: ['support'],          // roles allowed to subscribe; omit for "any session"
  // public: true,                 // only for a deliberately anonymous topic
  // tenantId: 'acme',             // only for a topic that exists in one tenant
});
```

`ctx.broadcast('tickets', data)` notifies zero subscribers unless the calling slice is the declared
`owner`. The registry and concurrent subscriptions are bounded by `config.realtime`
(`maxTopics`, `maxSubscriptions`, `maxConnectionsPerClient`; 1000/1000/8 by default) and the refusal
is `429 REALTIME_LIMIT_EXCEEDED` with `Retry-After`.

---

## 4. The WebSocket upgrade is refused when no origin allow-list is configured

**Symptom:** `GET /_synapse/ws/<domain>/<name>` answers `403 ORIGIN_NOT_ALLOWED`.

**Why:** an unset `SYNAPSE_ALLOWED_ORIGINS` used to mean "allow every origin", and an absent `Origin`
header skipped the check entirely — a cross-site WebSocket hijack with no authentication needed.

**Fix:**

```bash
SYNAPSE_ALLOWED_ORIGINS=https://app.exemplo.com,https://admin.exemplo.com
```

`*` allows every origin (not recommended). An absent or opaque (`null`) origin is always refused. A
**loopback origin** (`http://localhost:*`, `http://127.0.0.1:*`) stays allowed, so local development
needs no configuration.

---

## 5. Cookies written by `ctx.setCookie` are secure by default

**Symptom:** a cookie your action writes is no longer readable from JavaScript, and it is not sent on
cross-site navigations.

**Why:** the safe attributes were opt-in, so the framework's own documentation showed the insecure
call site. `HttpOnly`, `Secure` and `SameSite=Lax` are now the defaults.

**Fix:** state the attribute explicitly if you really need it.

```ts
ctx.setCookie('theme', 'dark', { httpOnly: false, secure: false });
```

Note that a cookie written by **browser** script (`storeSession`) can never be `HttpOnly` —
`document.cookie` cannot set it. A session that must be unreachable by script is the one the server
emits through `ctx.setCookie`.

---

## 6. Third-party CDN is opt-in and the content-security policy is strict

**Symptom:** pages render without Tailwind and without Google Fonts.

**Why:** every rendered page executed a third-party runtime compiler, without an integrity hash, in
an origin that holds a script-readable session cookie — and no CSP was emitted at all.

**Fix (either one):**

```bash
# A) ship your own stylesheet — it always wins over a third-party origin
public/synapse.css

# B) opt in, pinning the integrity hash of each origin
SYNAPSE_ENABLE_CDN=true \
SYNAPSE_CDN_INTEGRITY="sha384-..." \
SYNAPSE_FONTS_INTEGRITY="sha384-..." \
bun run start
```

Without an integrity hash the tag is not emitted — an unpinned third-party script is the risk the
switch exists to gate. To emit your own policy instead of the built-in one, set `SYNAPSE_CSP` (or
`config.contentSecurityPolicy`); the framework never weakens a policy you supply.

---

## What changes without breaking you

These are on by default and need no action, but they explain behaviour you may notice:

| Behaviour | Detail |
|---|---|
| Baseline security headers | every response — including 404s, static files and error pages — carries `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` and a CSP; HSTS appears only over TLS |
| Process-level body ceiling | 12 MiB by default (`SYNAPSE_MAX_REQUEST_BODY_BYTES`), behind the per-route limits (RPC 5 MB, webhook 10 MB, upload 5 MB) |
| Uploads sniff content | the declared extension must match the bytes; the default policy is png/jpg/jpeg/gif/webp/pdf/txt/csv/json/md (`SYNAPSE_UPLOAD_ALLOWED_TYPES`), refusal is `415 UNSUPPORTED_FILE_TYPE` |
| Rate limiting covers everything | including `/_synapse/api/*`, the image optimizer and server-rendered page loads; refusals are `429` with `Retry-After` |
| Proxy trust is opt-in | `SYNAPSE_TRUST_PROXY=true` (or `config.trustProxy`); otherwise the peer address is the identity |
| Revocation is consulted per request | a token revoked through `revokeSessionTokenInDb` stops authenticating everywhere, memoised for `SYNAPSE_REVOCATION_MEMO_TTL_MS` (30 s) |
| Tenant comes from verified claims only | when a secret is configured; unverified sources are ignored |
| Health is minimal when anonymous | status, database verdict, slice count and version; the route table, paths and error text require a session |
| Shutdown drains | the configured `drainTimeoutMs` is honoured, outstanding work is answered `503 DRAINING`, persistence closes afterwards, and `stop()` is idempotent |
| Errors are masked in production | RPC, webhook, upload and image failures return `INTERNAL_ERROR` plus a correlation id; the exception text goes to the log only |
| `synapse impact` fails on unknown targets | `TARGET_NOT_RESOLVED` with a non-zero exit, instead of an empty success |
| Unknown flags and commands are refused | `UNKNOWN_FLAG` / `UNKNOWN_COMMAND` on stdout with a non-zero exit, on every command |

---

## New configuration reference

| Variable / config | Default | Purpose |
|---|---|---|
| `SYNAPSE_SESSION_SECRET` | — | required in production; signs and verifies sessions |
| `SYNAPSE_ACKNOWLEDGE_INSECURE` / `--acknowledge-insecure` | false | starts production without a secret, on the record |
| `SYNAPSE_DEV_HEADERS` | false | trusts caller identity headers **only** in development |
| `SYNAPSE_ALLOWED_ORIGINS` | — | WebSocket upgrade allow-list (loopback always allowed) |
| `SYNAPSE_ENABLE_CDN` + `SYNAPSE_CDN_INTEGRITY` / `SYNAPSE_FONTS_INTEGRITY` | off | third-party CDN and fonts, pinned by SRI |
| `SYNAPSE_CSP` / `config.contentSecurityPolicy` | built-in strict policy | your own policy, emitted verbatim |
| `SYNAPSE_MAX_REQUEST_BODY_BYTES` / `config.maxRequestBodyBytes` | 12 MiB | process-level body ceiling |
| `SYNAPSE_UPLOAD_ALLOWED_TYPES` | png, jpg, jpeg, gif, webp, pdf, txt, csv, json, md | accepted upload policy |
| `SYNAPSE_TRUST_PROXY` / `config.trustProxy` | false | honour `x-forwarded-for` / `cf-connecting-ip` |
| `SYNAPSE_TRUST_PROXY` + `config.rateLimit` | 150 burst / 100 rps / 10k identities | rate limiting, per process |
| `config.realtime` | 1000 topics / 1000 subscriptions / 8 per client | realtime bounds |
| `SYNAPSE_REVOCATION_MEMO_TTL_MS`, `SYNAPSE_REVOCATION_TTL_MS`, `SYNAPSE_REVOCATION_MAX_ENTRIES` | 30 s / 7 d / 10 000 | revocation cache and bounds |
| `SYNAPSE_DEV_HEADERS` | false | see above |

Everything else in the slice contract — `db` optional, `requireAuth`, `MockDatabaseClient`,
`defineJob`, `defineCache`, `defineSocket`, `sliceTests` — is unchanged.

## Verifying the upgrade

```bash
bun run check                     # types
bun run synapse test              # slice oracles, per invariant
bun run synapse split             # compile + zero-leak gates
bun run synapse coverage          # every optional contract item exercised
curl -s localhost:3000/_synapse/api/health   # status, database, slicesLoaded
```

If something misbehaves, the refusal bodies are machine-readable — `MISSING_SESSION_SECRET`,
`UNAUTHENTICATED`, `TOPIC_NOT_FOUND`, `TOPIC_FORBIDDEN`, `REALTIME_LIMIT_EXCEEDED`,
`ORIGIN_NOT_ALLOWED`, `UNSUPPORTED_FILE_TYPE`, `TARGET_NOT_RESOLVED`, `UNKNOWN_FLAG` — and
`bun run synapse contract` prints the whole authoring contract, including the realtime rejection codes
and their statuses.
