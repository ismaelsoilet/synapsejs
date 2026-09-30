/**
 * SynapseJS - Project Status (single source of truth)
 *
 * Version, feature maturity, adoption and the tool inventory live here, in one
 * machine-readable module. `synapse info`, the health endpoint, the MCP server
 * metadata and the documentation gate all read it, so a claim cannot drift from a
 * value a test is able to check — and no surface carries a version literal of its own.
 */

import { MCP_TOOL_NAMES } from './mcp/tools';
import { SYNAPSE_VERSION } from './version';

export interface FeatureStatus {
  feature: string;
  /**
   * `stable` requires a test that fails when the behaviour breaks and, where the
   * capability wraps an engine, a suite that executes against a real engine.
   * `experimental` means it works but its evidence is a template assertion or a
   * test double. `roadmap` means it is not shipped.
   */
  status: 'stable' | 'experimental' | 'roadmap';
  evidence: string;
}

/**
 * The feature inventory. `experimental` is not an insult: it states which capabilities
 * have no behavioural test or no real-engine suite yet, instead of advertising them.
 */
export const FEATURE_STATUS: FeatureStatus[] = [
  {
    feature: 'Vertical slices (N = 1) with Locality of Behavior',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/locality.test.ts'
  },
  {
    feature: 'Result<T, E> control flow (no public throwing helper)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/machine-types.test.ts'
  },
  {
    feature: 'TypeBox JIT input contracts',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/slice-contract.test.ts'
  },
  {
    feature: 'Declarative sliceSchema migrations, applied once per statement',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/migration-runner.test.ts'
  },
  {
    feature: 'Domain errors map to HTTP status (401/403/404/409/422/500)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/runtime-server.test.ts'
  },
  {
    feature: 'Zero-wiring routing, SSR shell and RPC dispatcher',
    status: 'stable',
    evidence: 'bun --cwd examples/enterprise-crm test:e2e'
  },
  {
    feature: 'Signed sessions (SYNAPSE_SESSION_SECRET), tenant from verified claims only',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/session-security.test.ts'
  },
  {
    feature: 'Request-time session revocation with a bounded in-process set and prunable table',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/session-security.test.ts'
  },
  {
    feature: 'Login with Bun.password, signed token and cookie session (storeSession/clearSession)',
    status: 'stable',
    evidence: 'bun --cwd apps/crm test (login oracle: the server accepts the issued token)'
  },
  {
    feature: 'Caller-supplied identity headers only under the explicit SYNAPSE_DEV_HEADERS opt-in',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/session-security.test.ts'
  },
  {
    feature: 'Cross-slice atomicity through src/shared modules (db.transaction, rollback proven on SQLite)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/shared-modules.test.ts'
  },
  {
    feature: 'Slice boundary: a slice never imports another slice (SLICE_IMPORTS_SLICE)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/slice-splitter.test.ts'
  },
  {
    feature: 'Browser RPC transport that never throws (RPC_MALFORMED/RPC_UNREACHABLE as values)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/rpc-client.test.ts'
  },
  {
    feature: 'Pre-built client bundles with a manifest (synapse build)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/client-bundler.test.ts'
  },
  {
    feature: 'Uploads with session, byte ceiling, content sniffing and traversal guard (/_synapse/files)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/uploads.test.ts'
  },
  {
    feature: 'Embedded SQLite engine (WAL, prepared-statement cache)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/sqlite-client.test.ts'
  },
  {
    feature: 'Slice discovery resolution (never reports PASS with zero slices)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/slice-discovery.test.ts'
  },
  {
    feature: 'Centralized Database Schema Catalog (.codebase/db-schema.d.ts)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/db-schema-generator.test.ts'
  },
  {
    feature: 'Unified Object Storage (LocalStorage + AWS S3/R2 with SigV4 signing on upload and delete)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/storage.test.ts'
  },
  {
    feature: 'Isomorphic slice splitter (shared/server/client modules)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/slice-splitter.test.ts'
  },
  {
    feature: 'Slice invariants executed by bun:test (per-invariant reporting)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/oracle-runner.test.ts'
  },
  {
    feature: 'Rate limiting with an opt-in proxy trust and a registry that refuses the excess',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/production-hardening.test.ts'
  },
  {
    feature: 'Token bucket rate limiting on RPC, uploads, webhooks, SSE, images, machine endpoints and pages',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/abuse-resistance.test.ts'
  },
  {
    feature: 'SSRF & network guard with the validated address pinned for the actual fetch',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/abuse-resistance.test.ts'
  },
  {
    feature: 'Bounded LRU SSR cache and query normalization',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/production-hardening.test.ts'
  },
  {
    feature: 'Isolated SQLite queue engine (defineJob, exponential backoff, interrupt-safe shutdown)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/graceful-shutdown.test.ts'
  },
  {
    feature: 'SQLite queue zombie-job visibility recovery',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/production-hardening.test.ts'
  },
  {
    feature: 'Graceful HTTP shutdown: configured drain, 503 DRAINING for the excess, persistence closed last',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/graceful-shutdown.test.ts'
  },
  {
    feature: 'Bidirectional DDL migrations with transactional rollback (synapse rollback)',
    status: 'stable',
    evidence:
      'bun test packages/synapse/test/feature-exercise.test.ts (a shipped slice declares a reversible block and rolls it back)'
  },
  {
    feature: 'Declared realtime topics over SSE (defineTopic, tenant-namespaced, bounded registry)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/sse-gateway.test.ts'
  },
  {
    feature: 'Native bidirectional WebSockets (defineSocket) with a fail-closed origin check',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/http-response-hardening.test.ts'
  },
  {
    feature: 'In-memory SSR micro-cache & ISR (defineCache, stale-while-revalidate)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/onda7-deficiencies.test.tsx'
  },
  {
    feature: 'Vendor code-splitting and dynamic metadata (sliceMeta)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/onda1.test.ts'
  },
  {
    feature: 'Hierarchical domain layouts (_layout.tsx)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/onda1.test.ts'
  },
  {
    feature: 'MCP stdio server (JSON-RPC 2.0) with the tool inventory derived from the registered list',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/mcp-server.test.ts'
  },
  {
    feature: 'AST skeletonizer to .codebase/repo-map.d.ts',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/repo-map.test.ts'
  },
  {
    feature: 'PostgreSQL parity (migrations, DDL, action round-trip) against a live engine',
    status: 'stable',
    evidence: 'TEST_DATABASE_URL=... bun run test:postgres (CI provides a postgres:16 service)'
  },
  {
    feature: 'Distributed PostgreSQL queue (SKIP LOCKED, full jitter, dead-letter queue)',
    status: 'experimental',
    evidence:
      'real-engine suite: packages/synapse/test/postgres-adapters.test.ts (gated on TEST_DATABASE_URL; reports skipped without an engine, run by CI) — the substring suite postgres-queue.test.ts stays only as a change detector'
  },
  {
    feature: 'Distributed PostgreSQL event hub (LISTEN, payload offload)',
    status: 'experimental',
    evidence:
      'real-engine suite: packages/synapse/test/postgres-adapters.test.ts (gated on TEST_DATABASE_URL; reports skipped without an engine, run by CI); onda3.test.ts covers the in-process path'
  },
  {
    feature: 'On-demand image optimizer (resize, convert, remote allowlist)',
    status: 'experimental',
    evidence:
      'bun test packages/synapse/test/onda4.test.ts exercises the guard rails; the conversion path has no real test yet'
  },
  {
    feature: 'Webhooks (POST /_synapse/webhooks/<domain>/<name>) with HMAC signature and a bounded replay window',
    status: 'stable',
    evidence:
      'bun --cwd examples/enterprise-crm test (stripe-payment oracle: valid, tampered, replayed and stale deliveries)'
  },
  {
    feature: 'React hydration from a client bundle the splitter produces',
    status: 'stable',
    evidence:
      'bun test packages/synapse/test/hydration.test.tsx (mounts the layout tree, asserts no mismatch and live state)'
  },
  {
    feature: 'Isomorphic i18n routing (/<locale>/...)',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/onda3.test.ts'
  },
  {
    feature: 'Multi-tenancy: tenant from verified claims, per-tenant topic and cache isolation',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/multi-tenancy.test.ts'
  },
  {
    feature: 'Context surface benchmark (files/tokens an agent must read)',
    status: 'stable',
    evidence: 'bun run bench'
  },
  {
    feature: 'Background jobs (defineJob) exercised end to end by a committed slice',
    status: 'stable',
    evidence:
      'bun --cwd examples/enterprise-crm test (enqueue-welcome-email oracle: the job handler writes the delivery row)'
  },
  {
    feature: 'WebSocket definitions (defineSocket) exercised by a committed slice',
    status: 'stable',
    evidence: 'bun --cwd examples/enterprise-crm test (chat/room oracle: join and echo frames)'
  },
  {
    feature: 'SSR cache definitions (defineCache) exercised by a committed slice',
    status: 'stable',
    evidence: 'bun --cwd examples/enterprise-crm test (catalog/products oracle: policy and filtered loader)'
  },
  {
    feature: 'Server-side metadata (sliceMeta) and reversible migration blocks in shipped slices',
    status: 'stable',
    evidence: 'bun test packages/synapse/test/feature-exercise.test.ts (rollback rolls back a real statement)'
  },
  {
    feature: 'Incremental diagnostics cache across processes',
    status: 'roadmap',
    evidence: 'removido na 0.4.0: medido mais lento que o check completo (2.5s vs 1.9s)'
  }
];

/** What the project can honestly say about external adoption today. */
export const ADOPTION = {
  externalAdopters: 0,
  basis:
    'Sem adoção externa registrada: nenhum deploy de terceiros é conhecido, e a classificação acima reflete a evidência de teste, não uso em produção.'
};

export function projectStatus() {
  return {
    framework: 'SynapseJS',
    version: SYNAPSE_VERSION,
    runtime: 'Bun + Bun.serve',
    database: 'Embedded SQLite (WAL) and PostgreSQL, both verified',
    protocols: ['REST/HTTP', 'Isomorphic RPC', 'Model Context Protocol (MCP)'],
    adoption: ADOPTION,
    toolCount: MCP_TOOL_NAMES.length,
    tools: MCP_TOOL_NAMES,
    features: FEATURE_STATUS,
    commands: [
      'new',
      'dev',
      'start',
      'check',
      'migrate',
      'rollback',
      'db-drift',
      'impact',
      'mcp',
      'skeleton',
      'db-schema',
      'split',
      'build',
      'test',
      'worker',
      'new-slice',
      'new-shared',
      'contract',
      'coverage',
      'info'
    ]
  };
}
