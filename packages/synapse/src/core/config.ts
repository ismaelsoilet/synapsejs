/**
 * SynapseJS - Enterprise & SaaS Configuration Contract
 *
 * Provides a declarative configuration entry point via `synapse.config.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SynapsePlugin {
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: generic boundary for framework server
  onBootstrap?: (server: any) => Promise<void> | void;
  onRequest?: (req: Request) => Promise<Response | null | undefined> | Response | null | undefined;
  onResponse?: (res: Response, req: Request) => Promise<Response> | Response;
  // biome-ignore lint/suspicious/noExplicitAny: generic boundary for database client
  onMigrate?: (db: any) => Promise<void> | void;
}

export interface SynapseConfig<TServices = Record<string, unknown>> {
  /**
   * Enterprise & SaaS service registry (e.g. mailer, stripe, storage, ai).
   * Can be an object or an async factory returning the services.
   */
  services?: TServices | (() => Promise<TServices>) | (() => TServices);

  /**
   * Multi-tenancy configuration.
   */
  multitenancy?: {
    strategy?: 'subdomain' | 'header' | 'cookie';
    headerName?: string;
  };

  /**
   * Background queue settings.
   */
  queue?: {
    driver?: 'sqlite' | 'memory' | 'redis';
    dbPath?: string;
    concurrency?: number;
  };

  /**
   * Infrastructure lifecycle plugins (onBootstrap, onRequest, onResponse, onMigrate).
   */
  plugins?: SynapsePlugin[];

  /**
   * Compiler and client bundler configuration.
   */
  compiler?: {
    vendorPackages?: string[];
  };

  /**
   * Trust proxy headers (cf-connecting-ip, x-forwarded-for) for rate limiting and IP resolution.
   * Opt-in: when this is not explicitly `true` (or SYNAPSE_TRUST_PROXY is not `true`), the
   * immediate peer address is used and a rotating forwarding header cannot mint a new allowance.
   */
  trustProxy?: boolean;

  /**
   * Process-level maximum request body size, enforced by the HTTP server itself before any
   * body reader runs (default: 12 MiB, above every per-route ceiling). It is the backstop
   * behind the RPC (5 MiB), webhook (10 MiB) and upload (5 MiB) limits.
   */
  maxRequestBodyBytes?: number;

  /**
   * Rate limiting. Scope is the serving process only: each instance keeps its own counters,
   * so N instances behind a load balancer permit N times the per-instance allowance.
   */
  rateLimit?: {
    /** Maximum burst capacity (default: 150). */
    capacity?: number;
    /** Refill rate in tokens per second (default: 100). */
    refillRate?: number;
    /** Maximum tracked client identities before the registry is saturated (default: 10,000). */
    maxBuckets?: number;
  };

  /**
   * Max allowed payload bytes for RPC POST requests (default: 5MB).
   */
  maxRpcPayloadBytes?: number;

  /**
   * Max allowed payload bytes for Webhook POST requests (default: 10MB).
   */
  maxWebhookPayloadBytes?: number;

  /**
   * SSR Cache settings.
   */
  cache?: {
    maxEntries?: number;
  };

  /**
   * Third-party CDN and web-font origins (Tailwind's runtime compiler, Google Fonts).
   * **Opt-in**: nothing third-party is referenced by default. When enabled, the
   * content-security policy is rebuilt to permit exactly the configured origins, and
   * the emitted tags carry a subresource-integrity hash — without one, the tag is not
   * emitted at all, because an unpinned third-party script in an origin that holds a
   * script-readable session cookie is the whole risk.
   */
  cdn?: {
    enabled?: boolean;
    /** SRI hash for the Tailwind runtime script (`sha384-...`). */
    scriptIntegrity?: string;
    /** SRI hash for the Google Fonts stylesheet (`sha384-...`). */
    fontIntegrity?: string;
  };

  /**
   * Realtime (event stream and WebSocket) limits. Long-lived connections consume a
   * token from the rate limiter at most once, so these bounds — not the token bucket —
   * are what caps concurrent streams.
   */
  realtime?: {
    /** Maximum distinct topics with an open subscription (default: 1000). */
    maxTopics?: number;
    /** Maximum concurrently open realtime connections (default: 1000). */
    maxSubscriptions?: number;
    /** Maximum concurrently open realtime connections from one client (default: 8). */
    maxConnectionsPerClient?: number;
  };

  /**
   * Operator-supplied Content-Security-Policy. When present it is emitted as given —
   * the framework never weakens it — and replaces the built-in policy.
   */
  contentSecurityPolicy?: string;

  /**
   * Image optimizer security settings.
   * When `allowedDomains` is absent, any publicly routable host is permitted (loopback,
   * link-local, private and metadata addresses are always refused) and the documentation
   * says so rather than implying a restriction that is not enforced.
   */
  imageOptimizer?: {
    allowedDomains?: string[];
    /** Maximum bytes accepted from a remote image host (default: 10 MiB). */
    maxResponseBytes?: number;
    /** Maximum time a remote image fetch may take, in ms (default: 10,000). */
    timeoutMs?: number;
  };
}

export function defineConfig<TServices = Record<string, unknown>>(
  config: SynapseConfig<TServices>
): SynapseConfig<TServices> {
  return config;
}

const CONFIG_FILENAMES = ['synapse.config.ts', 'synapse.config.js', 'synapse.config.mjs'];

/**
 * Discovers and loads `synapse.config.(ts|js|mjs)` from the application root.
 *
 * A configuration file that exists but cannot be loaded is **fatal**: the config
 * carries security-relevant defaults (trusted proxy, body ceilings, realtime bounds),
 * so degrading to an empty configuration silently would start the server with
 * settings nobody chose. Absence of the file is not an error — it means "defaults".
 */
export async function loadSynapseConfig(appDir: string): Promise<SynapseConfig> {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(appDir, filename);

    if (!fs.existsSync(candidate)) {
      continue;
    }

    let mod: { default?: unknown } & Record<string, unknown>;

    try {
      mod = (await import(candidate)) as { default?: unknown } & Record<string, unknown>;
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);

      throw new Error(`[SynapseConfig] falha ao carregar ${filename}: ${errMessage}`);
    }

    const config = (mod.default || mod) as SynapseConfig | (() => SynapseConfig | Promise<SynapseConfig>);

    return typeof config === 'function' ? await config() : config;
  }

  return {};
}
