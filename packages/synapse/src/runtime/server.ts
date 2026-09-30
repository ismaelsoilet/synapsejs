/**
 * SynapseJS - Zero-Wiring HTTP Server & Dynamic Slice Dispatcher
 *
 * Leverages native Bun.serve to provide:
 * 1. Automatic file-system slice discovery (Zero-Wiring Routing)
 * 2. SSR HTML Shell with client-side RPC form wiring & Tailwind styling
 * 3. RPC Endpoint Dispatcher (/_synapse/rpc/:sliceName) executing server actions
 * 4. Machine Endpoints for AI agents (/_synapse/api/repo-map, health)
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SynapseProvider } from '../client/context';
import {
  buildClientBundle,
  buildVendorBundle,
  type ClientManifest,
  freshBundleFrom,
  readClientManifest,
  VENDOR_BUNDLE_NAME
} from '../compiler/client-bundler';
import { runSliceMigrations } from '../compiler/migration-runner';
import { findSliceFiles, resolveSlicesDir } from '../compiler/slice-discovery';
import {
  type ActionContext,
  AnonymousSession,
  BoundedLruCache,
  createActionContext,
  createDefaultLogger,
  createSession,
  type DatabaseClient,
  getDatabase,
  hasAnyRole,
  loadSynapseConfig,
  normalizeCacheKey,
  optimizeImage,
  resetDatabaseInstance,
  type SessionContext,
  type SliceCacheConfig,
  type SliceSocketDefinition,
  type SynapseConfig,
  serializeCookie
} from '../core/index';
import { ROLES_COOKIE, SESSION_COOKIE } from '../core/session-cookie';
import { isSessionTokenRevoked, isSessionTokenRevokedInDb, verifySessionToken } from '../core/session-token';
import { declaredTopic, type RealtimeRejectionCode, scopedTopic } from '../core/topics';
import { SYNAPSE_VERSION } from '../version';
import { serializeClientProps } from './client-entry';
import { isAction, isCache, isComponent, isJob, isLoader, isMeta, isSocket, isWebhook } from './discovery-rules';
import { getEventHub } from './event-hub';
import { validateExternalUrl } from './network-guard';
import { QueueEngine } from './queue-engine';
import { TokenBucketRateLimiter } from './rate-limiter';
import { readBodyWithinLimit, saveUpload } from './uploads';

export interface SliceMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  canonical?: string;
  noIndex?: boolean;
  extraTags?: Array<{ name?: string; property?: string; content: string }>;
}

export interface WebhookEvent<TJson = unknown> {
  readonly rawBody: Uint8Array;
  readonly bodyText: string;
  readonly json: TJson;
  readonly headers: Headers;
}

export interface DiscoveredSlice {
  domain: string;
  name: string;
  /** `<domain>/<name>`: what identifies a slice unambiguously. */
  key: string;
  routePath: string;
  rpcPath: string;
  webhookPath: string;
  wsPath: string;
  filePath: string;
  actionFn?: (payload: unknown, dbOrCtx?: any, session?: SessionContext, extraCtx?: ActionContext) => Promise<any>;
  componentFn?: React.ComponentType<any>;
  /** Export name of the component, so the generated client entry can import it. */
  componentExport?: string;
  /** Optional server-side data for the component: `export function <Name>Loader(context)`. */
  loaderFn?: (context: SliceLoaderContext) => Promise<Record<string, unknown>>;
  /** Optional metadata generator for SSR `<head>`: `export function <Name>Meta(props, context)` or `sliceMeta`. */
  metaFn?: (props: Record<string, unknown>, context: SliceLoaderContext) => SliceMetadata | Promise<SliceMetadata>;
  /** Optional Webhook handler receiving rawBody and ActionContext */
  webhookFn?: (event: WebhookEvent, ctx: ActionContext) => Promise<any>;
  /** Optional SSR cache and ISR policy */
  cacheConfig?: SliceCacheConfig;
  /** Optional bidirectional WebSocket handler */
  socketDef?: SliceSocketDefinition;
}

/**
 * What a slice loader receives. The loader runs on the server, on every SSR
 * request: it is how a component gets real data instead of hardcoded props.
 */
export const I18N_LOCALE_REGEX = /^\/([a-z]{2}(?:-[A-Z]{2})?)(?:\/|$)/;

export interface SliceLoaderContext {
  url: string;
  params: Record<string, string>;
  db: DatabaseClient;
  session: SessionContext;
  ctx?: ActionContext;
  services?: Record<string, unknown>;
  locale?: string;
}

export interface SliceLoadError {
  file: string;
  message: string;
}

/**
 * Domain error codes are the contract; the HTTP status is a transport detail
 * derived from them. Before this, every failure was 400, so a client could not
 * tell an expired session (401) from a missing row (404) or a duplicate (409).
 * Unknown codes keep 400: the domain, not the transport, decides.
 */
const ERROR_STATUS: Array<{ pattern: RegExp; status: number }> = [
  { pattern: /^UNAUTHORIZED$/, status: 401 },
  { pattern: /^FORBIDDEN$/, status: 403 },
  { pattern: /_NOT_FOUND$/, status: 404 },
  { pattern: /^(DUPLICATE_|ALREADY_|CONFLICT)/, status: 409 },
  { pattern: /^(INVALID_|MALFORMED)/, status: 422 },
  { pattern: /^(NO_DATABASE|PERSISTENCE_FAILED)/, status: 500 },
  { pattern: /_FAILED$/, status: 500 }
];

const RATE_LIMITED_PREFIXES = [
  '/_synapse/rpc/',
  '/_synapse/files/',
  '/_synapse/webhooks/',
  '/_synapse/sse/',
  '/_synapse/images/',
  '/_synapse/api/'
];

export const TURBO_ROUTER_SCRIPT = `(function() {
  if (window.__synapseNavInstalled) return;
  window.__synapseNavInstalled = true;

  async function navigate(href, push) {
    try {
      const res = await fetch(href, { headers: { 'X-Synapse-Morph': 'true' } });
      if (!res.ok) { window.location.href = href; return; }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const newRoot = doc.querySelector('#synapse-root');
      const curRoot = document.querySelector('#synapse-root');
      if (newRoot && curRoot) {
        curRoot.innerHTML = newRoot.innerHTML;
        document.title = doc.title;
        var newPropsScript = doc.querySelector('script[data-synapse-props]');
        if (newPropsScript && newPropsScript.textContent) {
          try {
            window.__SYNAPSE_PROPS__ = JSON.parse(newPropsScript.textContent);
          } catch (_) {}
        }
        if (push) history.pushState({}, '', href);
        window.dispatchEvent(new CustomEvent('synapse:morphed', { detail: { url: href } }));
        var newClientScript = doc.querySelector('script[data-synapse-client]');
        if (newClientScript && newClientScript.src) {
          import(newClientScript.src).then(function(mod) {
            if (mod && typeof mod.hydrate === 'function') {
              mod.hydrate();
            }
          }).catch(function(err) {
            console.error('[Synapse Router] Hydration error:', err);
          });
        }
      } else {
        window.location.href = href;
      }
    } catch {
      window.location.href = href;
    }
  }

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a || !a.href || a.target || a.hasAttribute('download')) return;
    var url = new URL(a.href, location.origin);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/_synapse/')) return;
    e.preventDefault();
    navigate(url.href, true);
  });

  window.addEventListener('popstate', function() {
    navigate(location.href, false);
  });
})();`;

export function httpStatusForError(error: unknown): number {
  const code = typeof error === 'string' ? error : '';

  for (const entry of ERROR_STATUS) {
    if (entry.pattern.test(code)) {
      return entry.status;
    }
  }

  return 400;
}

/** Escapes special HTML characters to prevent Reflected/Stored XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parses Cookie request header safely into key-value pairs. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const rawVal = trimmed.slice(eqIdx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(rawVal);
      } catch {
        cookies[key] = rawVal;
      }
    }
  }
  return cookies;
}

/** One JSON line per request when SYNAPSE_LOG=json, so an app can be observed. */
export function formatLogLine(entry: {
  method: string;
  path: string;
  status: number;
  ms: number;
  userId?: string | null;
  roles?: string[];
}): string {
  return JSON.stringify({ ts: new Date().toISOString(), ...entry });
}

/** Backstop ceiling for any request body: 12 MiB, above every per-route limit. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024;

/** The runtime mode, from SYNAPSE_ENV or NODE_ENV. */
function runtimeMode(): string {
  return (process.env.SYNAPSE_ENV ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
}

/**
 * True when the process declares a mode other than the development ones — an exact
 * `production` spelling, but also `prod`, `staging` or any other value an operator
 * clearly intends as a real deployment. An unset value is not production-like here:
 * the request layer still requires the explicit development opt-in below.
 */
export function isProductionLikeMode(): boolean {
  const mode = runtimeMode();

  if (!mode) {
    return false;
  }

  return !['development', 'dev', 'test'].includes(mode);
}

/**
 * Caller-supplied identity (x-user-id, x-user-roles, the roles cookie) is honoured
 * only under an explicit development opt-in: `SYNAPSE_DEV_HEADERS=true`, or a
 * development/test runtime mode. Any other state — unset, staging, production —
 * resolves to an anonymous session, so a mistyped variable cannot grant identity,
 * and the explicit flag is the acknowledgement an operator gives by name.
 */
export function headerTrustEnabled(): boolean {
  const explicit = (process.env.SYNAPSE_DEV_HEADERS ?? '').trim().toLowerCase();

  if (explicit === 'true') {
    return true;
  }

  if (explicit === 'false') {
    return false;
  }

  if (isProductionLikeMode()) {
    return false;
  }

  const mode = runtimeMode();

  return mode === 'development' || mode === 'dev' || mode === 'test';
}

/**
 * The process-level body ceiling: explicit config first, then
 * SYNAPSE_MAX_REQUEST_BODY_BYTES, then the default.
 */
export function maxRequestBodyBytes(config?: SynapseConfig): number {
  const configured = config?.maxRequestBodyBytes;

  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  const raw = Number(process.env.SYNAPSE_MAX_REQUEST_BODY_BYTES);

  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_REQUEST_BODY_BYTES;
}

export interface ExternalFetchResult {
  ok: boolean;
  body?: Uint8Array;
  contentType?: string;
  status?: number;
  code?: string;
}

/**
 * Fetches a URL whose host has already passed `validateExternalUrl`, connecting to the
 * address that was validated rather than resolving the hostname a second time: the URL
 * is rewritten to the pinned address, the original Host header is preserved and TLS
 * validation still checks the certificate against the real hostname (serverName).
 *
 * The response is read through the same streaming ceiling as every other body reader,
 * the whole fetch is bounded by a timeout, and redirects are refused rather than
 * followed (a hop would have to be revalidated, and refusing cannot be defeated).
 */
export async function fetchPinnedExternal(
  rawUrl: string,
  resolvedIp: string | undefined,
  options: { maxBytes: number; timeoutMs: number }
): Promise<ExternalFetchResult> {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname;
  const pinnedHost = resolvedIp?.includes(':') ? `[${resolvedIp}]` : resolvedIp;
  const port = parsed.port ? `:${parsed.port}` : '';
  const target = pinnedHost ? `${parsed.protocol}//${pinnedHost}${port}${parsed.pathname}${parsed.search}` : rawUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(target, {
      headers: { host: parsed.host },
      redirect: 'manual',
      signal: controller.signal,
      ...(parsed.protocol === 'https:' ? { tls: { serverName: hostname } } : {})
    } as RequestInit);

    if (!response.ok) {
      return { ok: false, status: 502, code: 'UPSTREAM_RESPONSE_FAILED' };
    }

    const body = await readBodyWithinLimit(response.body, options.maxBytes);

    if (!body.ok) {
      return { ok: false, status: 413, code: 'UPSTREAM_RESPONSE_TOO_LARGE' };
    }

    return {
      ok: true,
      body: body.value,
      contentType: response.headers.get('content-type') || 'application/octet-stream'
    };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));

    return aborted
      ? { ok: false, status: 504, code: 'UPSTREAM_TIMEOUT' }
      : { ok: false, status: 502, code: 'UPSTREAM_FETCH_FAILED' };
  } finally {
    clearTimeout(timer);
  }
}

export interface ShutdownSummary {
  /** Requests that were still being handled when the drain began and finished in time. */
  drained: number;
  /** Requests still running when the drain timeout expired; each received 503 DRAINING. */
  aborted: number;
  /** Jobs returned to the queue by the shutdown, exactly one attempt counted. */
  jobsRequeued: number;
  /** Jobs whose attempt budget was already exhausted; marked failed. */
  jobsFailed: number;
}

export class SynapseServer {
  private slices: Map<string, DiscoveredSlice> = new Map();
  private baseDir: string;
  private db: DatabaseClient;
  private discoveryError: { code: string; message: string; candidates: string[] } | null = null;
  private loadErrors: SliceLoadError[] = [];
  private clientBundles = new Map<string, { url: string; builtFor: string }>();
  private clientManifest: ClientManifest | null | undefined;
  private httpServer: ReturnType<typeof Bun.serve> | null = null;
  public config: SynapseConfig = {};
  private queueEngine: QueueEngine;
  private layoutComponent: React.ComponentType<any> | null = null;
  private domainLayouts: Map<string, React.ComponentType<any>> = new Map();
  private rateLimiter: TokenBucketRateLimiter;
  private ssrCache: BoundedLruCache<{
    html: string;
    expiresAt: number;
    staleUntil: number;
    ttlSeconds: number;
    swrSeconds: number;
    tags: string[];
  }>;
  private revalidatingKeys = new Set<string>();

  public invalidateCache(tags?: string[]): void {
    if (!tags || tags.length === 0) {
      this.ssrCache.clear();
      return;
    }
    const tagSet = new Set(tags);
    for (const [key, entry] of this.ssrCache.entries()) {
      if (entry.tags.some((t) => tagSet.has(t))) {
        this.ssrCache.delete(key);
      }
    }
  }

  private metrics = {
    startTime: Date.now(),
    totalRequests: 0,
    statusCodes: {} as Record<number, number>,
    rpcSuccessCount: 0,
    rpcErrorCount: 0,
    ssrRenderCount: 0,
    staticFileCount: 0
  };
  public port: number;

  constructor(baseDir: string = process.cwd(), port: number = 3000, db?: DatabaseClient, config?: SynapseConfig) {
    this.baseDir = baseDir;
    this.port = port;
    this.db = db || getDatabase();
    if (config) {
      this.config = { ...config };
    }
    this.rateLimiter = new TokenBucketRateLimiter({
      maxBuckets: config?.rateLimit?.maxBuckets ?? 10_000,
      capacity: config?.rateLimit?.capacity,
      refillRate: config?.rateLimit?.refillRate
    });
    this.ssrCache = new BoundedLruCache(this.config.cache?.maxEntries || 1000);
    this.queueEngine = new QueueEngine({
      dbPath: path.join(this.baseDir, '.synapse/queue.sqlite'),
      logger: createDefaultLogger('QueueEngine')
    });

    // Pending until shutdown reaches its drain deadline; every request races it.
    this.drainSignal = new Promise<Response>((resolve) => {
      this.drainSignalResolve = resolve;
    });
  }

  /**
   * Resolves when in-flight requests must stop waiting — the drain deadline. It stays
   * pending while the server is running, so every handler races it from the moment it
   * begins and a request that is still running when the deadline fires is answered
   * with 503 DRAINING instead of being cut off with no response.
   */
  private drainSignal: Promise<Response>;
  private drainSignalResolve: ((response: Response) => void) | null = null;
  private inFlightCount = 0;
  private abortedCount = 0;
  private drainedCount = 0;
  private shutdownPromise: Promise<ShutdownSummary> | null = null;
  private openStreams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /** What a `stop()` call reports and logs: the observable result of the drain. */
  private lastShutdownSummary: ShutdownSummary | null = null;

  /**
   * Gracefully shuts down the HTTP server and closes database connections.
   *
   * Waits for the promise Bun's own drain returns, raced against the configured
   * timeout — the value is honoured instead of being replaced by a shorter fixed
   * wait — and only then closes the rate limiter, the queue engine and the
   * database, so a request that queries the database late in the drain still can.
   * A second call is safe: it resolves with the same summary and closes nothing twice.
   */
  async stop(drainTimeoutMs = 5000): Promise<ShutdownSummary> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown(drainTimeoutMs);

    return this.shutdownPromise;
  }

  private async performShutdown(drainTimeoutMs: number): Promise<ShutdownSummary> {
    // No new background work is claimed from this point on: a job enqueued by an
    // in-flight request stays pending for the next process.
    this.queueEngine.stopClaiming();

    const inFlightAtStart = this.inFlightCount;
    const stopPromise: Promise<unknown> = this.httpServer ? this.httpServer.stop(false) : Promise.resolve();
    this.httpServer = null;

    let timedOut = false;

    if (drainTimeoutMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), drainTimeoutMs);
      });

      // Fires only when the deadline expires: everything still outstanding is then
      // answered with 503 DRAINING, deliberately, before persistence is closed.
      deadline.then(() => {
        this.abortedCount = this.inFlightCount;
        this.closeOpenStreams();

        this.drainSignalResolve?.(
          Response.json(
            { ok: false, error: 'DRAINING', message: 'O servidor está encerrando e não concluiu esta requisição.' },
            { status: 503 }
          )
        );
      });

      // The wait is always bounded: a connection that never finishes producing its
      // request must not hold the shutdown open past the configured timeout.
      const outcome = await Promise.race([stopPromise.then(() => 'drained' as const), deadline]);

      if (timer) {
        clearTimeout(timer);
      }

      timedOut = outcome === 'timeout';
    }
    // A configured timeout of zero skips the wait entirely.

    if (timedOut) {
      // What outlived the deadline is terminated deliberately and reported; the
      // race in the request path has already answered each one with 503 DRAINING.
      this.closeOpenStreams();
    }

    this.drainedCount = inFlightAtStart - this.abortedCount;

    const jobs = this.queueEngine.interruptRunningJobs();

    this.rateLimiter.close();
    this.queueEngine.close();
    await this.db.close?.();
    resetDatabaseInstance();

    this.lastShutdownSummary = {
      drained: Math.max(0, this.drainedCount),
      aborted: this.abortedCount,
      jobsRequeued: jobs.requeued,
      jobsFailed: jobs.failed
    };

    return this.lastShutdownSummary;
  }

  private closeOpenStreams(): void {
    for (const controller of this.openStreams) {
      try {
        controller.close();
      } catch {
        // already closed
      }
    }

    this.openStreams.clear();
  }

  get shutdownSummary(): ShutdownSummary | null {
    return this.lastShutdownSummary;
  }

  get database(): DatabaseClient {
    return this.db;
  }

  /** How many slices were discovered and registered — the benchmark's own sanity check. */
  get loadedSliceCount(): number {
    return this.slices.size;
  }

  get queue(): QueueEngine {
    return this.queueEngine;
  }

  get rateLimitEngine(): TokenBucketRateLimiter {
    return this.rateLimiter;
  }

  get serverMetrics() {
    return {
      startTime: this.metrics.startTime,
      totalRequests: this.metrics.totalRequests,
      statusCodes: { ...this.metrics.statusCodes },
      rpcSuccessCount: this.metrics.rpcSuccessCount,
      rpcErrorCount: this.metrics.rpcErrorCount,
      ssrRenderCount: this.metrics.ssrRenderCount,
      staticFileCount: this.metrics.staticFileCount,
      /** Requests that have begun handling and not yet produced a response. */
      inFlightRequests: this.inFlightCount,
      /** Open event streams: reported apart from drainable work. */
      openStreams: this.openStreams.size,
      shuttingDown: this.shutdownPromise !== null,
      shutdown: this.lastShutdownSummary
    };
  }

  get serverConfig(): SynapseConfig {
    return this.config;
  }

  private createActionContext(sliceKey: string, session: SessionContext): ActionContext {
    return createActionContext({
      db: this.db,
      session,
      tenantId: session.tenantId,
      services: (this.config.services as Record<string, unknown>) || {},
      logger: createDefaultLogger(sliceKey),
      // Publishing is owner-checked: only the slice that declared a topic may write to it.
      sliceOwner: sliceKey,
      enqueue: (jobOrName, payload, options) => this.queueEngine.enqueue(jobOrName, payload, options),
      invalidateCache: (tags) => this.invalidateCache(tags)
    });
  }

  /**
   * Discovers and registers all slices from src/slices
   */
  async discoverSlices(): Promise<number> {
    const resolution = resolveSlicesDir(this.baseDir);

    if (!resolution.ok) {
      this.discoveryError = {
        code: resolution.error.code,
        message: resolution.error.message,
        candidates: resolution.error.candidates
      };
      console.error(`[SynapseServer] ${resolution.error.code}: ${resolution.error.message}`);
      console.error(`[SynapseServer] Candidatos examinados: ${resolution.error.candidates.join(', ')}`);
      this.slices.clear();
      return 0;
    }

    this.discoveryError = null;
    const slicesDir = resolution.value.slicesDir;
    const files = findSliceFiles(slicesDir);
    this.slices.clear();
    this.loadErrors = [];
    this.layoutComponent = null;
    this.domainLayouts.clear();

    // Detect optional root layout (_layout.tsx or layout.tsx)
    const layoutCandidates = [path.join(slicesDir, '_layout.tsx'), path.join(slicesDir, 'layout.tsx')];
    for (const cand of layoutCandidates) {
      if (fs.existsSync(cand)) {
        try {
          const candStat = fs.statSync(cand);
          const layoutMod = await import(`${cand}?t=${candStat.mtimeMs}`);
          this.layoutComponent = layoutMod.default || layoutMod.Layout || null;
          break;
        } catch (e) {
          console.error(`[SynapseServer] Falha ao carregar layout ${cand}:`, e);
        }
      }
    }

    for (const file of files) {
      const rel = path.relative(slicesDir, file);
      const parts = rel.split(path.sep);
      const domain = parts[0] || 'general';
      const name = path.basename(file, '.slice.tsx');
      const key = `${domain}/${name}`;
      const routePath = `/${domain}/${name}`;
      const rpcPath = `/_synapse/rpc/${domain}/${name}`;

      if (!this.domainLayouts.has(domain)) {
        const domainDir = path.join(slicesDir, domain);
        const domainCandidates = [path.join(domainDir, '_layout.tsx'), path.join(domainDir, 'layout.tsx')];
        for (const cand of domainCandidates) {
          if (fs.existsSync(cand)) {
            try {
              const candStat = fs.statSync(cand);
              const domainMod = await import(`${cand}?t=${candStat.mtimeMs}`);
              const domainComp = domainMod.default || domainMod.Layout || null;
              if (domainComp) {
                this.domainLayouts.set(domain, domainComp);
                break;
              }
            } catch (e) {
              console.error(`[SynapseServer] Falha ao carregar layout de domínio ${cand}:`, e);
            }
          }
        }
      }

      if (this.slices.has(key)) {
        this.loadErrors.push({ file, message: `chave de fatia duplicada: ${key}` });
        continue;
      }

      try {
        const fileStat = fs.existsSync(file) ? fs.statSync(file) : null;
        const mod = await import(fileStat ? `${file}?t=${fileStat.mtimeMs}` : file);
        let actionFn: any = null;
        let componentFn: any = null;
        let componentExport: string | undefined;
        let loaderFn: any = null;
        let webhookFn: any = null;
        let metaFn: any = null;
        let cacheConfig: any = null;
        let socketDef: any = null;

        for (const [exportName, val] of Object.entries(mod)) {
          if (
            isJob(exportName) &&
            val &&
            typeof val === 'object' &&
            'name' in (val as Record<string, unknown>) &&
            'handler' in (val as Record<string, unknown>)
          ) {
            this.queueEngine.registerJob(val as any);
          }
          if (isCache(exportName) && val && typeof val === 'object') {
            cacheConfig = val;
          }
          if (isSocket(exportName) && val && typeof val === 'object') {
            socketDef = val;
          }
          if (typeof val !== 'function') {
            continue;
          }
          if (exportName === 'default' && typeof val === 'function') {
            componentFn = val;
            componentExport = 'default';
          } else if (isAction(exportName)) {
            actionFn = val;
          } else if (isLoader(exportName)) {
            loaderFn = val;
          } else if (isComponent(exportName)) {
            if (componentExport !== 'default') {
              if (!componentFn || exportName.endsWith('View')) {
                componentFn = val;
                componentExport = exportName;
              }
            }
          } else if (isWebhook(exportName)) {
            webhookFn = val;
          } else if (isMeta(exportName)) {
            metaFn = val;
          }
        }

        this.slices.set(key, {
          domain,
          name,
          key,
          routePath,
          rpcPath,
          webhookPath: `/_synapse/webhooks/${domain}/${name}`,
          wsPath: `/_synapse/ws/${domain}/${name}`,
          filePath: file,
          actionFn,
          componentFn,
          componentExport,
          loaderFn,
          metaFn,
          webhookFn,
          cacheConfig,
          socketDef
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.loadErrors.push({ file: path.relative(this.baseDir, file), message });
        console.error(`[SynapseServer] Falha ao carregar a fatia ${file}: ${message}`);
      }
    }

    return this.slices.size;
  }

  /**
   * Registers a slice directly on this server instance (useful for programmatic slices and testing).
   */
  public registerSlice(slice: DiscoveredSlice): void {
    this.slices.set(slice.key, slice);
  }

  /**
   * `<domain>/<name>` resolves directly. A bare name resolves only while it is
   * unique across domains; ambiguity is an explicit conflict, never a guess.
   */
  private resolveSlice(
    target: string
  ): { ok: true; slice: DiscoveredSlice } | { ok: false; status: number; message: string } {
    const direct = this.slices.get(target);
    if (direct) {
      return { ok: true, slice: direct };
    }

    const matches = [...this.slices.values()].filter((slice) => slice.name === target);
    if (matches.length === 1) {
      return { ok: true, slice: matches[0] };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        status: 409,
        message:
          `'${target}' é ambíguo entre ${matches.map((m) => m.key).join(', ')}. ` +
          `Use /_synapse/rpc/<domain>/${target}.`
      };
    }

    return { ok: false, status: 404, message: `Action para a fatia '${target}' não encontrada.` };
  }

  /**
   * Cross-origin policy: same-origin by default. An app serving its UI from
   * another origin lists them in SYNAPSE_ALLOWED_ORIGINS; anything else gets no
   * CORS headers, so the browser blocks it.
   */
  private corsHeaders(request: Request): Record<string, string> | null {
    const origin = request.headers.get('origin');
    if (!origin) {
      return null;
    }

    const allowed = (process.env.SYNAPSE_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (!allowed.includes(origin) && !allowed.includes('*')) {
      return null;
    }

    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type, authorization, x-user-id, x-user-roles',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin'
    };
  }

  /**
   * Client identity for rate limiting. Forwarding headers are honoured only when the
   * deployment explicitly declares a trusted proxy (SYNAPSE_TRUST_PROXY=true or
   * config.trustProxy), so a direct client rotating X-Forwarded-For cannot mint a
   * fresh allowance out of thin air.
   */
  private clientIdentity(req: Request): string {
    const peer = this.httpServer?.requestIP(req)?.address || '127.0.0.1';
    const trustProxy = process.env.SYNAPSE_TRUST_PROXY === 'true' || this.config.trustProxy === true;

    if (!trustProxy) {
      return peer;
    }

    return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || peer;
  }

  /**
   * Consumes one token for the request's client identity. Returns a 429 response when
   * the allowance is exhausted, or null when the request may proceed.
   */
  private rateLimitRefusal(req: Request, pathname: string, startedAt: number): Response | null {
    const rateResult = this.rateLimiter.consume(this.clientIdentity(req));

    if (rateResult.allowed) {
      return null;
    }

    const cors = this.corsHeaders(req);
    this.logRequest(req, pathname, 429, startedAt);

    return new Response(
      JSON.stringify({
        ok: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Muitas requisições. Tente novamente mais tarde.'
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(Math.ceil(rateResult.resetMs / 1000)),
          'X-RateLimit-Limit': String(rateResult.limit),
          'X-RateLimit-Remaining': String(rateResult.remaining),
          'X-RateLimit-Reset': String(Math.ceil((Date.now() + rateResult.resetMs) / 1000)),
          ...(cors ?? {})
        }
      }
    );
  }

  /** Records request metrics and writes one JSON line per request when SYNAPSE_LOG=json. */
  private logRequest(
    request: Request,
    pathname: string,
    status: number,
    startedAt: number,
    session?: SessionContext,
    metricType?: 'rpc_success' | 'rpc_error' | 'ssr' | 'static' | 'sse'
  ): void {
    this.metrics.totalRequests++;
    this.metrics.statusCodes[status] = (this.metrics.statusCodes[status] || 0) + 1;
    if (metricType === 'rpc_success') this.metrics.rpcSuccessCount++;
    if (metricType === 'rpc_error') this.metrics.rpcErrorCount++;
    if (metricType === 'ssr') this.metrics.ssrRenderCount++;
    if (metricType === 'static') this.metrics.staticFileCount++;

    if (process.env.SYNAPSE_LOG !== 'json') {
      return;
    }

    process.stdout.write(
      `${formatLogLine({
        method: request.method,
        path: pathname,
        status,
        ms: Math.round(performance.now() - startedAt),
        userId: session?.userId || null,
        roles: session?.roles?.length ? session.roles : undefined
      })}\n`
    );
  }

  private sessionFrom(request: Request): SessionContext {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const userIdHeader = request.headers.get('x-user-id');
    const rolesHeader = request.headers.get('x-user-roles');
    const tenantHeader = request.headers.get('x-tenant-id');
    const cookieHeader = request.headers.get('cookie') || request.headers.get('Cookie');
    const cookies = parseCookies(cookieHeader);

    // Resolves multi-tenant ID from subdomain (acme.myapp.com) or header
    const host = request.headers.get('host') || '';
    const hostParts = host.split(':')[0].split('.');
    let subdomainTenant: string | undefined;
    if (hostParts.length > 2 && hostParts[0] !== 'www' && hostParts[0] !== 'localhost') {
      subdomainTenant = hostParts[0];
    }
    const tenantId = tenantHeader || subdomainTenant;

    // Com um segredo configurado, a sessão vem OBRIGATORIAMENTE da assinatura
    // criptográfica válida (Bearer header ou cookie synapse_token).
    // Headers de papel (x-user-id, x-user-roles) e cookies não assinados são
    // terminantemente ignorados, prevenindo bypass de autenticação.
    const secret = process.env.SYNAPSE_SESSION_SECRET;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : undefined;
    const token = bearer || cookies[SESSION_COOKIE];

    if (secret) {
      if (!token) {
        return AnonymousSession();
      }
      const verified = verifySessionToken(token, secret);

      // The tenant comes exclusively from the verified claims: with a secret
      // configured, neither the tenant header nor the subdomain can supply one.
      return verified.ok
        ? createSession({
            userId: verified.value.userId,
            tenantId: verified.value.tenantId,
            roles: verified.value.roles,
            token
          })
        : AnonymousSession();
    }

    // Sem segredo, a identidade forjável por header só é aceita sob opt-in explícito
    // de desenvolvimento; qualquer outro estado resolve para anônimo.
    if (!headerTrustEnabled()) {
      return AnonymousSession(tenantId);
    }

    // Modo de desenvolvimento (sem segredo configurado):
    // Aceita headers diretos ou cookies para conveniência local.
    const cookieRoles = cookies[ROLES_COOKIE];
    if (authHeader || userIdHeader || rolesHeader || cookieRoles || token) {
      const rawRoles = rolesHeader || cookieRoles;
      const roles = rawRoles
        ? rawRoles
            .split(',')
            .map((role) => role.trim())
            .filter((role) => role.length > 0)
        : ['user'];

      return createSession({
        userId: userIdHeader || (cookies[SESSION_COOKIE] ? 'user-cookie' : `user-${token?.slice(0, 8) || 'header'}`),
        tenantId,
        roles,
        token: token || undefined
      });
    }

    return AnonymousSession(tenantId);
  }

  /** Signature -> memoised revocation verdict, bounded by TTL and entry cap. */
  private revocationMemo = new Map<string, { revoked: boolean; checkedAt: number }>();

  /**
   * The session for a request, with revocation consulted on every request. A
   * signature is queried against the persisted store at most once per TTL window,
   * so the common case costs nothing; the in-process set short-circuits it entirely.
   */
  async requestSession(request: Request): Promise<SessionContext> {
    const session = this.sessionFrom(request);

    if (!session.isAuthenticated || !session.token) {
      return session;
    }

    return (await this.isTokenRevoked(session.token)) ? AnonymousSession() : session;
  }

  private async isTokenRevoked(token: string): Promise<boolean> {
    if (isSessionTokenRevoked(token)) {
      return true;
    }

    const signature = token.split('.')[1];

    if (!signature) {
      return true;
    }

    const ttlMs = Number(process.env.SYNAPSE_REVOCATION_MEMO_TTL_MS ?? '');
    const ttl = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : 30_000;
    const cached = this.revocationMemo.get(signature);

    if (cached && Date.now() - cached.checkedAt < ttl) {
      return cached.revoked;
    }

    const revoked = await isSessionTokenRevokedInDb(this.db, token);

    while (this.revocationMemo.size >= 5000) {
      const oldest = this.revocationMemo.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.revocationMemo.delete(oldest);
    }

    this.revocationMemo.set(signature, { revoked, checkedAt: Date.now() });

    return revoked;
  }

  /**
   * Builds the browser bundle for a slice from the splitter's client artifact.
   *
   * The splitter is what keeps database code out of the browser: only its
   * `client.tsx` (UI plus RPC stubs) is bundled, with the generated entry that
   * hydrates the component and wires `onSubmitAction` to the slice endpoint.
   * Cached per mtime, so editing a slice rebuilds it on the next request.
   */
  private async ensureClientBundle(slice: DiscoveredSlice): Promise<string | null> {
    if (!slice.componentExport) {
      return null;
    }

    const stat = fs.existsSync(slice.filePath) ? fs.statSync(slice.filePath) : null;
    const signature = stat ? String(stat.mtimeMs) : 'missing';
    const cached = this.clientBundles.get(slice.key);
    if (cached?.builtFor === signature) {
      const version = stat ? `?v=${Math.floor(stat.mtimeMs)}` : '';
      return `${cached.url}${version}`;
    }

    // `synapse build` já empacotou esta fatia e o arquivo não mudou desde então:
    // o runtime serve o artefato pronto em vez de refazer o trabalho no primeiro request.
    if (this.clientManifest === undefined) {
      this.clientManifest = readClientManifest(this.baseDir);
    }

    const prebuilt = freshBundleFrom(this.clientManifest, slice.key, Number(signature));
    if (prebuilt) {
      this.clientBundles.set(slice.key, { url: prebuilt, builtFor: signature });
      const version = stat ? `?v=${Math.floor(stat.mtimeMs)}` : '';
      return `${prebuilt}${version}`;
    }

    const built = await buildClientBundle(
      {
        key: slice.key,
        name: slice.name,
        domain: slice.domain,
        filePath: slice.filePath,
        rpcPath: slice.rpcPath
      },
      this.baseDir,
      { vendorPackages: this.config.compiler?.vendorPackages }
    );

    if (!built.ok) {
      console.error(`[SynapseServer] Nao foi possivel empacotar ${slice.key}: ${built.error.message}`);
      return null;
    }

    this.clientBundles.set(slice.key, { url: built.value.url, builtFor: signature });

    const version = stat ? `?v=${Math.floor(stat.mtimeMs)}` : '';
    return `${built.value.url}${version}`;
  }

  /**
   * The third-party origins, opt-in only. Enabling them without an integrity hash
   * emits nothing: an unpinned third-party script (or stylesheet) in an origin that
   * holds a script-readable session cookie is the risk this switch exists to gate.
   */
  private thirdPartyOrigins(): { enabled: boolean; script?: string; fontStyles?: string; fontFiles?: string } {
    const enabled =
      this.config.cdn?.enabled === true ||
      process.env.SYNAPSE_ENABLE_CDN === 'true' ||
      process.env.SYNAPSE_ENABLE_CDN === '1';

    if (!enabled) {
      return { enabled: false };
    }

    return {
      enabled: true,
      script: this.config.cdn?.scriptIntegrity || process.env.SYNAPSE_CDN_INTEGRITY || undefined,
      fontStyles: this.config.cdn?.fontIntegrity || process.env.SYNAPSE_FONTS_INTEGRITY || undefined,
      fontFiles: 'https://fonts.gstatic.com'
    };
  }

  /**
   * The Content-Security-Policy every HTML response carries. An operator-supplied
   * policy replaces it (never weakened); otherwise the policy is same-origin, with
   * third-party origins appearing only when explicitly enabled and pinned.
   */
  private contentSecurityPolicy(): string {
    const operatorPolicy = this.config.contentSecurityPolicy || process.env.SYNAPSE_CSP;

    if (operatorPolicy) {
      return operatorPolicy;
    }

    const thirdParty = this.thirdPartyOrigins();
    const scriptSources = ["'self'", "'unsafe-inline'"];
    const styleSources = ["'self'", "'unsafe-inline'"];
    const fontSources = ["'self'", 'data:'];

    if (thirdParty.script) {
      scriptSources.push('https://cdn.tailwindcss.com');
    }

    if (thirdParty.fontStyles) {
      styleSources.push('https://fonts.googleapis.com');
      fontSources.push('https://fonts.gstatic.com');
    }

    return [
      "default-src 'self'",
      `script-src ${scriptSources.join(' ')}`,
      `style-src ${styleSources.join(' ')}`,
      "img-src 'self' data: https:",
      `font-src ${fontSources.join(' ')}`,
      "connect-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ');
  }

  /** The baseline headers every response carries — routed, unrouted, static or error. */
  private baselineHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': this.contentSecurityPolicy()
    };

    const forwardedProto = req.headers.get('x-forwarded-proto');
    const trustProxy = process.env.SYNAPSE_TRUST_PROXY === 'true' || this.config.trustProxy === true;
    const isTls =
      new URL(req.url).protocol === 'https:' || (trustProxy && forwardedProto?.split(',')[0]?.trim() === 'https');

    if (isTls) {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }

    return headers;
  }

  /** Adds the baseline headers to a response without overriding what it already sets. */
  private withBaselineHeaders(response: Response, req: Request): Response {
    for (const [name, value] of Object.entries(this.baselineHeaders(req))) {
      if (!response.headers.has(name)) {
        response.headers.set(name, value);
      }
    }

    // The response is returned as it came, so a `Bun.file` body keeps its
    // zero-copy send instead of being re-wrapped as a stream.
    return response;
  }

  /**
   * A realtime refusal: the same machine-readable shape on both transports, with the
   * code always drawn from the set the machine contract enumerates.
   */
  private realtimeRefusal(
    code: RealtimeRejectionCode,
    status: number,
    message: string,
    cors?: Record<string, string> | null
  ): Response {
    return Response.json({ ok: false, error: code, message }, { status, headers: cors ?? undefined });
  }

  /** Concurrent realtime connections held per client identity. */
  private realtimeConnections = new Map<string, number>();

  private releaseRealtimeConnection(clientKey: string): void {
    const open = this.realtimeConnections.get(clientKey) ?? 0;

    if (open <= 1) {
      this.realtimeConnections.delete(clientKey);
    } else {
      this.realtimeConnections.set(clientKey, open - 1);
    }
  }

  private realtimeBounds(): { maxTopics: number; maxSubscriptions: number; maxConnectionsPerClient: number } {
    return {
      maxTopics: this.config.realtime?.maxTopics ?? 1000,
      maxSubscriptions: this.config.realtime?.maxSubscriptions ?? 1000,
      maxConnectionsPerClient: this.config.realtime?.maxConnectionsPerClient ?? 8
    };
  }

  /**
   * The origin check for a WebSocket upgrade, fail-closed: an allow-list must be
   * configured and must contain the request's origin (or the wildcard). An absent
   * origin and the opaque `null` origin are refused. The one carve-out is a loopback
   * origin, so local development works without a production-grade allow-list.
   */
  private webSocketOriginAllowed(req: Request): boolean {
    const origin = req.headers.get('origin');

    if (!origin || origin === 'null') {
      return false;
    }

    if (this.isLoopbackOrigin(origin)) {
      return true;
    }

    const allowed = (process.env.SYNAPSE_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return allowed.includes('*') || allowed.includes(origin);
  }

  private isLoopbackOrigin(origin: string): boolean {
    try {
      const parsed = new URL(origin);

      return (
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1' ||
        parsed.hostname === '[::1]'
      );
    } catch {
      return false;
    }
  }

  /**
   * The response for an unexpected internal failure: a stable code plus a
   * correlation identifier that also appears on the log record. Outside development
   * the exception text is never part of the body — it goes to the log only.
   */
  private internalFailure(err: unknown, pathname: string, cors?: Record<string, string> | null): Response {
    const correlationId = crypto.randomUUID();
    const message = err instanceof Error ? err.message : String(err);

    console.error(`[SynapseServer] Falha interna [${correlationId}] em ${pathname}: ${message}`);

    return Response.json(
      {
        ok: false,
        error: 'INTERNAL_ERROR',
        correlationId,
        ...(isProductionLikeMode() ? {} : { message })
      },
      { status: 500, headers: cors ?? undefined }
    );
  }

  /**
   * Returns stylesheet links. The application's own stylesheet always wins; nothing
   * third-party is referenced unless explicitly enabled and integrity-pinned.
   */
  private renderStylesheets(): string {
    const localCssPath = path.join(this.baseDir, 'public', 'synapse.css');

    if (fs.existsSync(localCssPath)) {
      return '  <link rel="stylesheet" href="/synapse.css">';
    }

    const thirdParty = this.thirdPartyOrigins();

    if (!thirdParty.enabled) {
      return '';
    }

    const elements: string[] = [];

    if (thirdParty.script) {
      elements.push(
        `  <script src="https://cdn.tailwindcss.com" integrity="${thirdParty.script}" crossorigin="anonymous"></script>`
      );
    } else {
      console.warn(
        '[SynapseServer] CDN habilitado sem um hash de integridade (SYNAPSE_CDN_INTEGRITY): o script de terceiros não será emitido.'
      );
    }

    if (thirdParty.fontStyles) {
      elements.push('  <link rel="preconnect" href="https://fonts.googleapis.com">');
      elements.push('  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
      elements.push(
        `  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" integrity="${thirdParty.fontStyles}" crossorigin="anonymous">`
      );
    }

    return elements.join('\n');
  }

  /**
   * Renders the slice SSR component tree and packages the complete HTML shell
   */
  private async renderSliceHtml(
    slice: DiscoveredSlice,
    req: Request,
    url: URL,
    matchedLocale?: string
  ): Promise<{
    html: string;
    dataProps: Record<string, unknown>;
    meta?: SliceMetadata;
    hasError?: boolean;
    error?: string;
  }> {
    const session = await this.requestSession(req);
    const actionCtx = this.createActionContext(slice.key, session);
    const params = Object.fromEntries(url.searchParams.entries());
    const dataProps: Record<string, unknown> = {
      ...params,
      ...(matchedLocale ? { locale: matchedLocale } : {})
    };
    let loaderError: string | null = null;

    const loaderCtx: SliceLoaderContext = {
      url: url.toString(),
      params,
      db: this.db,
      session,
      ctx: actionCtx,
      services: (this.config.services as Record<string, unknown>) || {},
      locale: matchedLocale
    };

    if (slice.loaderFn) {
      try {
        const loaded = await slice.loaderFn(loaderCtx);
        Object.assign(dataProps, loaded);
      } catch (err) {
        loaderError = err instanceof Error ? err.message : String(err);
        console.error(`[SynapseServer] Loader de ${slice.key} falhou: ${loaderError}`);
      }
    }

    let meta: SliceMetadata | undefined;
    if (slice.metaFn && !loaderError) {
      try {
        meta = await slice.metaFn(dataProps, loaderCtx);
      } catch (err) {
        console.error(`[SynapseServer] sliceMeta de ${slice.key} falhou:`, err);
      }
    }

    const renderProps: Record<string, unknown> = {
      ...dataProps,
      ...(slice.actionFn
        ? {
            onSubmitAction: (payload: unknown) => slice.actionFn?.(payload, actionCtx, session, actionCtx),
            action: (payload: unknown) => slice.actionFn?.(payload, actionCtx, session, actionCtx)
          }
        : {})
    };

    let contentHtml: string;
    let hasError = false;
    let renderError: string | null = loaderError;

    const isProduction = isProductionLikeMode();
    if (loaderError) {
      hasError = true;
      console.error(`[SynapseServer] Loader de ${slice.key} falhou: ${loaderError}`);
      const displayMsg = isProduction ? 'Ocorreu um erro interno ao carregar os dados.' : escapeHtml(loaderError);
      contentHtml = `<div class="text-rose-400">Falha no loader de ${escapeHtml(slice.key)}: ${displayMsg}</div>`;
    } else if (slice.componentFn) {
      try {
        const sliceEl = React.createElement(slice.componentFn, renderProps);
        const domainLayout = this.domainLayouts.get(slice.domain);
        const treeWithDomainLayout = domainLayout
          ? React.createElement(domainLayout, { session, url: url.toString() }, sliceEl)
          : sliceEl;
        const treeWithLayout = this.layoutComponent
          ? React.createElement(this.layoutComponent, { session, url: url.toString() }, treeWithDomainLayout)
          : treeWithDomainLayout;
        const rootEl = React.createElement(SynapseProvider, { props: dataProps, session }, treeWithLayout);
        contentHtml = renderToString(rootEl);
      } catch (e: any) {
        hasError = true;
        const errMessage = e instanceof Error ? e.message : String(e);
        console.error(`[SynapseServer] Erro na renderização SSR de ${slice.key}: ${errMessage}`);
        renderError = errMessage;
        const displayMsg = isProduction ? 'Ocorreu um erro interno durante a renderização.' : escapeHtml(errMessage);
        contentHtml = `<div class="text-rose-400">Erro na renderização SSR: ${displayMsg}</div>`;
      }
    } else {
      contentHtml = '<div class="text-slate-400">Nenhum componente de UI exportado.</div>';
    }

    const clientUrl = hasError ? null : await this.ensureClientBundle(slice);

    const hasCustomLayout = Boolean(this.layoutComponent || this.domainLayouts.get(slice.domain));
    const html = this.renderHtmlShell(
      meta?.title || slice.name,
      contentHtml,
      slice.name,
      serializeClientProps(dataProps),
      clientUrl,
      meta,
      matchedLocale || 'pt-BR',
      hasCustomLayout
    );

    return { html, dataProps, meta, hasError, error: renderError || undefined };
  }

  /**
   * Generates the SSR HTML Shell with Inter font, Tailwind and client hydration
   */
  private renderHtmlShell(
    title: string,
    contentHtml: string,
    sliceName: string,
    propsJson: string,
    clientUrl: string | null,
    meta?: SliceMetadata,
    locale = 'pt-BR',
    hasLayout = false
  ): string {
    const safeTitle = escapeHtml(title);
    const safeSliceName = escapeHtml(sliceName);
    const pageTitle = meta?.title ? escapeHtml(meta.title) : `${safeTitle} | SynapseJS`;

    const metaTags: string[] = [];
    if (meta?.description) {
      metaTags.push(`  <meta name="description" content="${escapeHtml(meta.description)}">`);
      metaTags.push(`  <meta property="og:description" content="${escapeHtml(meta.description)}">`);
    }
    if (meta?.keywords && meta.keywords.length > 0) {
      metaTags.push(`  <meta name="keywords" content="${escapeHtml(meta.keywords.join(', '))}">`);
    }
    metaTags.push(`  <meta property="og:title" content="${meta?.title ? escapeHtml(meta.title) : safeTitle}">`);
    if (meta?.ogImage) {
      metaTags.push(`  <meta property="og:image" content="${escapeHtml(meta.ogImage)}">`);
    }
    if (meta?.canonical) {
      metaTags.push(`  <link rel="canonical" href="${escapeHtml(meta.canonical)}">`);
    }
    if (meta?.noIndex) {
      metaTags.push(`  <meta name="robots" content="noindex, nofollow">`);
    }
    if (meta?.extraTags) {
      for (const tag of meta.extraTags) {
        const nameAttr = tag.name ? ` name="${escapeHtml(tag.name)}"` : '';
        const propAttr = tag.property ? ` property="${escapeHtml(tag.property)}"` : '';
        metaTags.push(`  <meta${nameAttr}${propAttr} content="${escapeHtml(tag.content)}">`);
      }
    }
    const metaSection = metaTags.length > 0 ? `\n${metaTags.join('\n')}` : '';

    const vendorImports: Record<string, string> = {
      react: '/_synapse/client/_vendor.js',
      'react/jsx-runtime': '/_synapse/client/_vendor.js',
      'react/jsx-dev-runtime': '/_synapse/client/_vendor.js',
      'react-dom': '/_synapse/client/_vendor.js',
      'react-dom/client': '/_synapse/client/_vendor.js',
      'synapsejs/client': '/_synapse/client/_vendor.js',
      '@ismaelsoilet/synapsejs/client': '/_synapse/client/_vendor.js'
    };
    if (this.config.compiler?.vendorPackages) {
      for (const pkg of this.config.compiler.vendorPackages) {
        vendorImports[pkg] = '/_synapse/client/_vendor.js';
      }
    }
    const importMapScript = `  <script type="importmap">\n  ${JSON.stringify({ imports: vendorImports }, null, 4).split('\n').join('\n  ')}\n  </script>`;

    if (hasLayout) {
      return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}" class="min-h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>${metaSection}
${this.renderStylesheets()}
${importMapScript}
  <script type="module" src="/_synapse/client/_vendor.js"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="min-h-full flex flex-col">
  <div id="synapse-root" class="min-h-full flex-1 flex flex-col">${contentHtml}</div>

  <script data-synapse-props id="__SYNAPSE_PROPS_DATA__" type="application/json">${propsJson}</script>
  <script>globalThis.__SYNAPSE_PROPS__ = JSON.parse(document.getElementById('__SYNAPSE_PROPS_DATA__').textContent || '{}');</script>
  ${clientUrl ? `<script data-synapse-client type="module" src="${clientUrl}"></script>` : '<!-- sem componente hidratavel -->'}

  <script type="module" src="/_synapse/turbo-router.js"></script>
</body>
</html>`;
    }

    return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>${metaSection}
${this.renderStylesheets()}
${importMapScript}
  <script type="module" src="/_synapse/client/_vendor.js"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="h-full flex flex-col justify-between">
  <!-- Top Bar -->
  <header class="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="h-8 w-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
        ⚡
      </div>
      <div>
        <a href="/" class="font-bold tracking-tight text-white hover:text-cyan-400 transition-colors">SynapseJS</a>
        <span class="text-xs text-slate-400 ml-2 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">Machine-Centric Runtime</span>
      </div>
    </div>
    <div class="flex items-center gap-4 text-xs font-mono text-slate-400">
      <a href="/_synapse/api/repo-map" target="_blank" class="hover:text-cyan-400 hover:underline">repo-map.d.ts</a>
      <a href="/_synapse/api/health" target="_blank" class="hover:text-cyan-400 hover:underline">status: online</a>
    </div>
  </header>

  <!-- Main Container -->
  <main class="flex-1 max-w-4xl w-full mx-auto p-6 md:p-10">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white tracking-tight">${safeTitle}</h1>
        <p class="text-sm text-slate-400 font-mono mt-1">Fatia Vertical: <span class="text-cyan-400">${safeSliceName}.slice.tsx</span></p>
      </div>
      <a href="/" class="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors">
        ← Voltar ao Hub
      </a>
    </div>

    <!-- Slice Render Container -->
    <div id="synapse-root" class="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-2xl backdrop-blur">${contentHtml}</div>

    <!-- Props de hidratacao e a entrada de cliente gerada -->
    <script data-synapse-props id="__SYNAPSE_PROPS_DATA__" type="application/json">${propsJson}</script>
    <script>globalThis.__SYNAPSE_PROPS__ = JSON.parse(document.getElementById('__SYNAPSE_PROPS_DATA__').textContent || '{}');</script>
    ${clientUrl ? `<script data-synapse-client type="module" src="${clientUrl}"></script>` : '<!-- sem componente hidratavel -->'}

    <!-- Turbo Morphing SPA Navigation (<1.5kb, Zero Dependencies) -->
    <script type="module" src="/_synapse/turbo-router.js"></script>
  </main>

  <!-- Footer -->
  <footer class="border-t border-slate-900 bg-slate-950 px-6 py-4 text-center text-xs text-slate-500">
    SynapseJS Machine-Centric Engine • Deterministic Vertical Slices • Zero-Wiring Bun Server
  </footer>
</body>
</html>`;
  }

  /**
   * Generates the Main Hub Dashboard HTML
   */
  private renderDashboardHtml(): string {
    const sliceList = Array.from(this.slices.values())
      .map(
        (s) => `
        <div class="p-5 bg-slate-900/60 border border-slate-800 rounded-xl hover:border-cyan-500/50 transition-all flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-mono uppercase tracking-wider text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded">
                ${escapeHtml(s.domain)}
              </span>
              <span class="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Pronto
              </span>
            </div>
            <h3 class="text-lg font-semibold text-white mb-1">${escapeHtml(s.name)}</h3>
            <p class="text-xs text-slate-400 font-mono mb-4 truncate">${escapeHtml(s.filePath)}</p>
          </div>
          <div class="flex items-center gap-2 pt-3 border-t border-slate-800/80">
            <a href="${escapeHtml(s.routePath)}" class="flex-1 text-center py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors">
              Abrir Interface UI →
            </a>
            <span class="text-xs font-mono text-slate-500 bg-slate-800/80 px-2 py-2 rounded-lg" title="RPC Endpoint">
              POST ${escapeHtml(s.rpcPath)}
            </span>
          </div>
        </div>
      `
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="pt-BR" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hub de Fatias Verticais | SynapseJS</title>
${this.renderStylesheets()}
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="h-full flex flex-col justify-between">
  <header class="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-8 py-5 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
        ⚡
      </div>
      <div>
        <h1 class="text-xl font-bold tracking-tight text-white">SynapseJS Runtime</h1>
        <p class="text-xs text-slate-400 font-mono">Fullstack Machine-Centric Engine</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <a href="/_synapse/api/repo-map" target="_blank" class="text-xs font-mono px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-cyan-400 hover:bg-slate-700 transition-colors">
        Ver repo-map.d.ts (< 3k tokens)
      </a>
    </div>
  </header>

  <main class="flex-1 max-w-6xl w-full mx-auto p-8">
    <div class="mb-8">
      <h2 class="text-2xl font-bold text-white tracking-tight">Fatias Verticais Descobertas</h2>
      <p class="text-sm text-slate-400 mt-1">Roteamento autônomo baseado no sistema de arquivos (Zero-Wiring Routing via AST).</p>
    </div>

    ${
      this.loadErrors.length > 0
        ? `<div class="mb-8 p-5 rounded-xl border border-rose-800 bg-rose-950/50">
      <h3 class="text-rose-300 font-semibold mb-2">${this.loadErrors.length} fatia(s) falharam ao carregar</h3>
      <ul class="text-xs font-mono text-rose-200 space-y-1">
        ${this.loadErrors.map((error) => `<li>${escapeHtml(error.file)}: ${escapeHtml(error.message)}</li>`).join('')}
      </ul>
    </div>`
        : ''
    }

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${sliceList}
    </div>
  </main>

  <footer class="border-t border-slate-900 bg-slate-950 px-8 py-4 text-center text-xs text-slate-500">
    SynapseJS • ${this.slices.size} fatias carregadas • SQLite conectado em .synapse/synapse.sqlite
  </footer>
</body>
</html>`;
  }

  /**
   * Starts the Bun.serve HTTP server
   */
  async start() {
    const loadedConfig = await loadSynapseConfig(this.baseDir);
    this.config = {
      ...loadedConfig,
      ...this.config,
      compiler: {
        ...(loadedConfig.compiler || {}),
        ...(this.config?.compiler || {})
      },
      plugins: [...(loadedConfig.plugins || []), ...(this.config?.plugins || [])]
    };

    // 0. Auto-run declarative slice migrations on startup
    await runSliceMigrations(this.baseDir, this.db);

    if (this.config.plugins) {
      for (const plugin of this.config.plugins) {
        if (plugin.onMigrate) {
          await plugin.onMigrate(this.db);
        }
        if (plugin.onBootstrap) {
          await plugin.onBootstrap(this);
        }
      }
    }

    /**
     * Process-level ceiling on any request body. It is the backstop behind the
     * per-route limits (RPC 5 MiB, webhook 10 MiB, upload 5 MiB): every body-reading
     * path is bounded even before its own guard runs, so no single request can
     * exhaust process memory.
     */
    const processBodyCeiling = maxRequestBodyBytes(this.config);

    this.httpServer = Bun.serve({
      port: this.port,
      maxRequestBodySize: processBodyCeiling,
      websocket: {
        open: async (ws: any) => {
          const socketDef = ws.data?.socketDef;
          if (socketDef?.onOpen) {
            try {
              await socketDef.onOpen(ws);
            } catch (err) {
              console.error(`[SynapseServer] Erro no onOpen do WebSocket (${ws.data?.sliceKey}):`, err);
            }
          }
        },
        message: async (ws: any, message: any) => {
          const socketDef = ws.data?.socketDef;
          if (socketDef?.onMessage) {
            try {
              let parsed = message;
              if (typeof message === 'string') {
                try {
                  parsed = JSON.parse(message);
                } catch {
                  // mantém texto puro
                }
              }
              await socketDef.onMessage(ws, parsed);
            } catch (err) {
              console.error(`[SynapseServer] Erro no onMessage do WebSocket (${ws.data?.sliceKey}):`, err);
            }
          }
        },
        close: async (ws: any, code: number, reason: string) => {
          if (ws.data?.clientKey) {
            this.releaseRealtimeConnection(ws.data.clientKey);
          }

          const socketDef = ws.data?.socketDef;
          if (socketDef?.onClose) {
            try {
              await socketDef.onClose(ws, code, reason);
            } catch (err) {
              console.error(`[SynapseServer] Erro no onClose do WebSocket (${ws.data?.sliceKey}):`, err);
            }
          }
        }
      },
      fetch: async (req: Request) => {
        // Every request that has begun handling and has not produced a response is
        // outstanding work the drain waits for. An unbounded event stream is not:
        // it is tracked separately and closed when shutdown begins.
        this.inFlightCount++;
        let released = false;
        const releaseInFlight = () => {
          if (!released) {
            released = true;
            this.inFlightCount--;
          }
        };

        if (this.config.plugins) {
          for (const plugin of this.config.plugins) {
            if (plugin.onRequest) {
              const intercepted = await plugin.onRequest(req);
              if (intercepted instanceof Response) {
                releaseInFlight();
                return intercepted;
              }
            }
          }
        }

        const handleRequest = async (): Promise<Response> => {
          const url = new URL(req.url);
          const pathname = url.pathname;
          const startedAt = performance.now();

          // WebSocket Upgrade for slices: /_synapse/ws/:domain/:name
          if (pathname.startsWith('/_synapse/ws/')) {
            // Fail-closed: no allow-list means no upgrade, with a loopback carve-out
            // for local development. An absent or opaque origin is refused too.
            if (!this.webSocketOriginAllowed(req)) {
              this.logRequest(req, pathname, 403, startedAt);
              return this.realtimeRefusal(
                'ORIGIN_NOT_ALLOWED',
                403,
                'Origem não permitida para conexão WebSocket.',
                this.corsHeaders(req)
              );
            }

            const rateRefusal = this.rateLimitRefusal(req, pathname, startedAt);

            if (rateRefusal) {
              return rateRefusal;
            }

            const wsBounds = this.realtimeBounds();
            const wsClientKey = this.clientIdentity(req);
            const wsOpen = this.realtimeConnections.get(wsClientKey) ?? 0;

            if (wsOpen >= wsBounds.maxConnectionsPerClient) {
              this.logRequest(req, pathname, 429, startedAt);
              return this.realtimeRefusal(
                'REALTIME_LIMIT_EXCEEDED',
                429,
                'Limite de conexões simultâneas por cliente atingido.'
              );
            }

            this.realtimeConnections.set(wsClientKey, wsOpen + 1);

            const target = pathname.slice('/_synapse/ws/'.length);
            const resolved = this.resolveSlice(target);
            if (!resolved.ok) {
              this.releaseRealtimeConnection(wsClientKey);
              return new Response(JSON.stringify({ error: resolved.message }), {
                status: resolved.status,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            const socketDef = resolved.slice.socketDef;
            if (!socketDef) {
              this.releaseRealtimeConnection(wsClientKey);
              return new Response(JSON.stringify({ error: `Fatia ${resolved.slice.key} não declara sliceSocket` }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            const session = await this.requestSession(req);
            const upgraded = (this.httpServer as any)?.upgrade(req, {
              data: {
                id: crypto.randomUUID(),
                sliceKey: resolved.slice.key,
                socketDef,
                session,
                clientKey: wsClientKey
              }
            });
            if (upgraded) {
              return undefined as any;
            }

            this.releaseRealtimeConnection(wsClientKey);
            return new Response('Falha no upgrade de WebSocket', { status: 400 });
          }

          // Arquivos estáticos primeiro: `public/` do app, estritamente contido no diretório.
          if (!pathname.startsWith('/_synapse/') && pathname !== '/') {
            const publicDir = path.resolve(this.baseDir, 'public');
            const relative = pathname.replace(/^\/+/, '');
            const candidate = path.resolve(publicDir, relative);

            if (
              relative.length > 0 &&
              candidate.startsWith(publicDir + path.sep) &&
              fs.existsSync(candidate) &&
              fs.statSync(candidate).isFile()
            ) {
              const served = new Response(Bun.file(candidate));
              this.logRequest(req, pathname, served.status, startedAt, undefined, 'static');
              return served;
            }
          }

          // 1. Dashboard Hub
          if (pathname === '/' || pathname === '/index.html') {
            this.logRequest(req, pathname, 200, startedAt);
            return new Response(this.renderDashboardHtml(), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }

          // 1.5 Rate Limiter for every accepting surface (machine endpoints, RPC,
          // uploads, webhooks, SSE, images). Server-rendered page loads are covered
          // separately, right before the render begins. Static files, the dashboard
          // and the generated client bundles are not part of this budget.
          if (RATE_LIMITED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
            const refusal = this.rateLimitRefusal(req, pathname, startedAt);

            if (refusal) {
              return refusal;
            }
          }

          // 2. Machine Endpoints for AI
          if (pathname === '/_synapse/api/repo-map') {
            const repoMapPath = path.join(this.baseDir, '.codebase/repo-map.d.ts');
            if (fs.existsSync(repoMapPath)) {
              const content = fs.readFileSync(repoMapPath, 'utf-8');
              this.logRequest(req, pathname, 200, startedAt);
              return new Response(content, {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
              });
            }
            this.logRequest(req, pathname, 404, startedAt);
            return new Response('repo-map.d.ts not generated yet', { status: 404 });
          }

          if (pathname === '/_synapse/api/health') {
            let dbHealthy = false;
            let dbError: string | null = null;
            try {
              await this.db.query('SELECT 1;');
              dbHealthy = true;
            } catch (err) {
              dbError = err instanceof Error ? err.message : String(err);
            }

            const healthy = dbHealthy && !this.discoveryError;
            const status = healthy ? 'OK' : 'DEGRADED';
            const httpStatus = healthy ? 200 : 503;
            const session = await this.requestSession(req);

            // This endpoint requires no authentication, so it discloses only the
            // aggregate verdict: no absolute path, no discovery candidate, no load-error
            // text and no route inventory. The detailed inventory is authenticated.
            const payload: Record<string, unknown> = {
              status,
              framework: 'SynapseJS',
              version: SYNAPSE_VERSION,
              uptime: process.uptime(),
              database: dbHealthy ? 'connected' : 'disconnected',
              slicesLoaded: this.slices.size
            };

            if (session.isAuthenticated) {
              payload.databaseError = dbError;
              payload.slicesResolutionError = this.discoveryError;
              payload.loadErrors = this.loadErrors;
              payload.slices = Array.from(this.slices.values()).map((s) => ({
                domain: s.domain,
                name: s.name,
                route: s.routePath,
                rpc: s.rpcPath
              }));
            }

            this.logRequest(req, pathname, httpStatus, startedAt, session);
            return Response.json(payload, { status: httpStatus });
          }

          if (pathname === '/_synapse/api/metrics') {
            const uptimeSeconds = Math.round((Date.now() - this.metrics.startTime) / 1000);
            const formatParam = url.searchParams.get('format');
            const acceptHeader = req.headers.get('accept') || '';

            this.logRequest(req, pathname, 200, startedAt);

            if (formatParam === 'prometheus' || acceptHeader.includes('text/plain')) {
              const promText = [
                '# HELP synapse_uptime_seconds SynapseJS server uptime in seconds',
                '# TYPE synapse_uptime_seconds gauge',
                `synapse_uptime_seconds ${uptimeSeconds}`,
                '# HELP synapse_requests_total Total number of HTTP requests received',
                '# TYPE synapse_requests_total counter',
                `synapse_requests_total ${this.metrics.totalRequests}`,
                '# HELP synapse_rpc_success_total Total successful RPC action calls',
                '# TYPE synapse_rpc_success_total counter',
                `synapse_rpc_success_total ${this.metrics.rpcSuccessCount}`,
                '# HELP synapse_rpc_error_total Total failed RPC action calls',
                '# TYPE synapse_rpc_error_total counter',
                `synapse_rpc_error_total ${this.metrics.rpcErrorCount}`,
                '# HELP synapse_ssr_renders_total Total server-side rendered pages',
                '# TYPE synapse_ssr_renders_total counter',
                `synapse_ssr_renders_total ${this.metrics.ssrRenderCount}`
              ].join('\n');

              const promTextWithNewline = `${promText}\n`;

              return new Response(promTextWithNewline, {
                headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }
              });
            }

            return Response.json({
              uptimeSeconds,
              totalRequests: this.metrics.totalRequests,
              statusCodes: this.metrics.statusCodes,
              rpcSuccessCount: this.metrics.rpcSuccessCount,
              rpcErrorCount: this.metrics.rpcErrorCount,
              ssrRenderCount: this.metrics.ssrRenderCount,
              staticFileCount: this.metrics.staticFileCount
            });
          }

          // 3. RPC Actions Dispatcher (POST /_synapse/rpc/:sliceName)
          if (pathname.startsWith('/_synapse/rpc/')) {
            const cors = this.corsHeaders(req);

            if (req.method === 'OPTIONS') {
              const status = cors ? 204 : 404;
              this.logRequest(req, pathname, status, startedAt);
              return new Response(null, { status, headers: cors ?? undefined });
            }

            if (req.method !== 'POST') {
              this.logRequest(req, pathname, 405, startedAt);
              return new Response('Method Not Allowed', { status: 405, headers: cors ?? undefined });
            }

            // CSRF: um formulario de outra origem so consegue mandar
            // urlencoded/plain/text, nunca application/json.
            if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
              this.logRequest(req, pathname, 415, startedAt);
              return Response.json(
                { ok: false, error: 'Requisicao RPC exige Content-Type: application/json.' },
                { status: 415, headers: cors ?? undefined }
              );
            }

            const target = pathname.replace('/_synapse/rpc/', '');
            const resolved = this.resolveSlice(target);

            if (!resolved.ok) {
              this.logRequest(req, pathname, resolved.status, startedAt);
              return Response.json({ ok: false, error: resolved.message }, { status: resolved.status });
            }

            const slice = resolved.slice;
            if (!slice.actionFn) {
              this.logRequest(req, pathname, 404, startedAt);
              return Response.json(
                { ok: false, error: `A fatia '${slice.key}' não exporta nenhuma *Action.` },
                { status: 404 }
              );
            }

            const maxRpcBytes = this.config.maxRpcPayloadBytes ?? 5 * 1024 * 1024; // 5 MB
            const rpcContentLengthHeader = req.headers.get('content-length');
            const rpcContentLength = rpcContentLengthHeader ? parseInt(rpcContentLengthHeader, 10) : NaN;
            if (Number.isFinite(rpcContentLength) && rpcContentLength > maxRpcBytes) {
              this.logRequest(req, pathname, 413, startedAt, undefined, 'rpc_error');
              return Response.json(
                {
                  ok: false,
                  error: 'PAYLOAD_TOO_LARGE',
                  message: `Payload RPC excede o limite máximo permitido de ${maxRpcBytes} bytes.`
                },
                { status: 413, headers: cors ?? undefined }
              );
            }

            const bodyResult = await readBodyWithinLimit(req.body, maxRpcBytes);
            if (!bodyResult.ok) {
              this.logRequest(req, pathname, 413, startedAt, undefined, 'rpc_error');
              return Response.json(
                {
                  ok: false,
                  error: 'PAYLOAD_TOO_LARGE',
                  message: `Payload RPC excede o limite máximo permitido de ${maxRpcBytes} bytes.`
                },
                { status: 413, headers: cors ?? undefined }
              );
            }

            let body: unknown;
            try {
              const bodyText = new TextDecoder().decode(bodyResult.value);
              body = bodyText.trim().length > 0 ? JSON.parse(bodyText) : {};
            } catch {
              this.logRequest(req, pathname, 400, startedAt, undefined, 'rpc_error');
              return Response.json(
                {
                  ok: false,
                  error: 'INVALID_JSON_PAYLOAD',
                  message: 'Payload da requisição não é um JSON válido.'
                },
                { status: 400, headers: cors ?? undefined }
              );
            }

            try {
              const session = await this.requestSession(req);
              const actionCtx = this.createActionContext(slice.key, session);

              const result = await slice.actionFn(body, actionCtx, session, actionCtx);
              const status = result.ok ? 200 : httpStatusForError(result.error);
              const metricType = result.ok ? 'rpc_success' : 'rpc_error';
              this.logRequest(req, pathname, status, startedAt, session, metricType);

              const headers = new Headers(cors ?? {});
              headers.set('Content-Type', 'application/json');

              if (actionCtx._pendingCookies && actionCtx._pendingCookies.length > 0) {
                for (const cookie of actionCtx._pendingCookies) {
                  headers.append('Set-Cookie', serializeCookie(cookie.name, cookie.value, cookie.options));
                }
              }

              return new Response(JSON.stringify(result), { status, headers });
            } catch (err: unknown) {
              this.logRequest(req, pathname, 500, startedAt, undefined, 'rpc_error');
              return this.internalFailure(err, pathname, cors);
            }
          }

          // 4. Webhooks Gateway (POST /_synapse/webhooks/:sliceName)
          if (pathname.startsWith('/_synapse/webhooks/')) {
            const cors = this.corsHeaders(req);

            if (req.method === 'OPTIONS') {
              const status = cors ? 204 : 404;
              this.logRequest(req, pathname, status, startedAt);
              return new Response(null, { status, headers: cors ?? undefined });
            }

            if (req.method !== 'POST') {
              this.logRequest(req, pathname, 405, startedAt);
              return new Response('Method Not Allowed', { status: 405, headers: cors ?? undefined });
            }

            const target = pathname.replace('/_synapse/webhooks/', '');
            const resolved = this.resolveSlice(target);

            if (!resolved.ok) {
              this.logRequest(req, pathname, resolved.status, startedAt);
              return Response.json({ ok: false, error: resolved.message }, { status: resolved.status });
            }

            const slice = resolved.slice;
            if (!slice.webhookFn) {
              this.logRequest(req, pathname, 404, startedAt);
              return Response.json(
                { ok: false, error: `A fatia '${slice.key}' não exporta nenhum *Webhook handler.` },
                { status: 404 }
              );
            }

            const maxWebhookBytes = this.config.maxWebhookPayloadBytes ?? 10 * 1024 * 1024; // 10 MB
            const webhookContentLengthHeader = req.headers.get('content-length');
            const webhookContentLength = webhookContentLengthHeader ? parseInt(webhookContentLengthHeader, 10) : NaN;
            if (Number.isFinite(webhookContentLength) && webhookContentLength > maxWebhookBytes) {
              this.logRequest(req, pathname, 413, startedAt);
              return Response.json(
                {
                  ok: false,
                  error: 'PAYLOAD_TOO_LARGE',
                  message: `Payload Webhook excede o limite máximo permitido de ${maxWebhookBytes} bytes.`
                },
                { status: 413, headers: cors ?? undefined }
              );
            }

            const bodyResult = await readBodyWithinLimit(req.body, maxWebhookBytes);
            if (!bodyResult.ok) {
              this.logRequest(req, pathname, 413, startedAt);
              return Response.json(
                {
                  ok: false,
                  error: 'PAYLOAD_TOO_LARGE',
                  message: `Payload Webhook excede o limite máximo permitido de ${maxWebhookBytes} bytes.`
                },
                { status: 413, headers: cors ?? undefined }
              );
            }

            try {
              const rawBody = bodyResult.value;
              const bodyText = new TextDecoder().decode(rawBody);
              let json: unknown = null;
              try {
                json = JSON.parse(bodyText);
              } catch {
                json = null;
              }

              const session = await this.requestSession(req);
              const actionCtx = this.createActionContext(slice.key, session);

              const result = await slice.webhookFn(
                {
                  rawBody,
                  bodyText,
                  json,
                  headers: req.headers
                },
                actionCtx
              );

              const status = typeof result === 'object' && result !== null && 'ok' in result && !result.ok ? 400 : 200;

              this.logRequest(req, pathname, status, startedAt, session);
              if (result === undefined || result === null) {
                return new Response('OK', { status: 200, headers: cors ?? undefined });
              }
              return Response.json(result, { status, headers: cors ?? undefined });
            } catch (err: unknown) {
              this.logRequest(req, pathname, 500, startedAt);
              return this.internalFailure(err, pathname, cors);
            }
          }

          // 4.5. Realtime SSE Gateway (GET /_synapse/sse/:topic*)
          if (pathname.startsWith('/_synapse/sse/')) {
            const cors = this.corsHeaders(req);

            if (req.method === 'OPTIONS') {
              return new Response(null, { status: cors ? 204 : 404, headers: cors ?? undefined });
            }

            if (req.method !== 'GET') {
              return new Response('Method Not Allowed', { status: 405, headers: cors ?? undefined });
            }

            const rawTopic = pathname.replace('/_synapse/sse/', '');
            const topic = decodeURIComponent(rawTopic);

            if (!topic) {
              return this.realtimeRefusal('TOPIC_NOT_FOUND', 404, 'Tópico de subscrição inválido.', cors);
            }

            const session = await this.requestSession(req);

            // Access is declared, not inferred: a name is not a permission.
            const declaration = declaredTopic(topic, session.tenantId);

            if (!session.isAuthenticated && !declaration?.public) {
              return this.realtimeRefusal('UNAUTHENTICATED', 401, 'Subscrição requer uma sessão autenticada.', cors);
            }

            if (!declaration) {
              return this.realtimeRefusal('TOPIC_NOT_FOUND', 404, 'Tópico não declarado.', cors);
            }

            if (declaration.readRoles?.length && !hasAnyRole(session, declaration.readRoles)) {
              return this.realtimeRefusal('TOPIC_FORBIDDEN', 403, 'Sessão sem papel para este tópico.', cors);
            }

            const bounds = this.realtimeBounds();

            if (this.openStreams.size >= bounds.maxSubscriptions) {
              return this.realtimeRefusal(
                'REALTIME_LIMIT_EXCEEDED',
                429,
                'Limite de subscrições simultâneas atingido.',
                cors
              );
            }

            const effectiveTopic = scopedTopic(topic, session.tenantId);
            const eventHub = getEventHub();
            const isNewTopic = eventHub.listenerCount(effectiveTopic) === 0;

            if (isNewTopic && eventHub.activeTopics().length >= bounds.maxTopics) {
              return this.realtimeRefusal(
                'REALTIME_LIMIT_EXCEEDED',
                429,
                'Limite de tópicos registrados atingido.',
                cors
              );
            }

            const clientKey = this.clientIdentity(req);
            const openForClient = this.realtimeConnections.get(clientKey) ?? 0;

            if (openForClient >= bounds.maxConnectionsPerClient) {
              return this.realtimeRefusal(
                'REALTIME_LIMIT_EXCEEDED',
                429,
                'Limite de conexões simultâneas por cliente atingido.',
                cors
              );
            }

            this.realtimeConnections.set(clientKey, openForClient + 1);

            let unsubscribe: (() => void) | null = null;
            let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

            const cleanup = () => {
              if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
                keepAliveTimer = null;
              }
              if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
              }
              const open = this.realtimeConnections.get(clientKey) ?? 0;
              if (open <= 1) {
                this.realtimeConnections.delete(clientKey);
              } else {
                this.realtimeConnections.set(clientKey, open - 1);
              }
            };

            req.signal.addEventListener('abort', cleanup);

            let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
            const server = this;
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
                // An open stream is not drainable work: it never completes on its own.
                // It is tracked separately and closed deliberately when shutdown begins.
                server.openStreams.add(controller);
                releaseInFlight();

                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode(': connected\n\n'));

                keepAliveTimer = setInterval(() => {
                  try {
                    controller.enqueue(encoder.encode(': keep-alive\n\n'));
                  } catch {
                    cleanup();
                  }
                }, 15000);

                unsubscribe = eventHub.subscribe(effectiveTopic, (data) => {
                  try {
                    const eventData = JSON.stringify(data);
                    controller.enqueue(encoder.encode(`event: message\ndata: ${eventData}\n\n`));
                  } catch (err) {
                    console.error(`[SSE] Erro ao serializar evento para tópico "${effectiveTopic}":`, err);
                  }
                });
              },
              cancel() {
                if (streamController) {
                  server.openStreams.delete(streamController);
                }
                cleanup();
              }
            });

            this.logRequest(req, pathname, 200, startedAt, session, 'sse');

            const sseHeaders: Record<string, string> = {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              ...(cors ?? {})
            };

            return new Response(stream, { headers: sseHeaders });
          }

          // 5. Uploads (o RPC é JSON de propósito; arquivo precisa de outra porta)
          if (pathname.startsWith('/_synapse/files/')) {
            const cors = this.corsHeaders(req);

            if (req.method === 'OPTIONS') {
              return new Response(null, { status: cors ? 204 : 404, headers: cors ?? undefined });
            }

            if (req.method !== 'POST') {
              return new Response('Method Not Allowed', { status: 405, headers: cors ?? undefined });
            }

            const uploadTarget = pathname.replace('/_synapse/files/', '');
            const resolvedUpload = this.resolveSlice(uploadTarget);

            if (!resolvedUpload.ok) {
              return Response.json({ ok: false, error: resolvedUpload.message }, { status: resolvedUpload.status });
            }

            const outcome = await saveUpload(req, {
              baseDir: this.baseDir,
              domain: resolvedUpload.slice.domain,
              session: await this.requestSession(req)
            });

            this.logRequest(req, pathname, outcome.status, startedAt);

            return Response.json(outcome.body, { status: outcome.status, headers: cors ?? undefined });
          }

          // 5. Image Optimization on-demand (DEF-02)
          if (pathname === '/_synapse/images/optimize') {
            const cors = this.corsHeaders(req);
            if (req.method === 'OPTIONS') {
              return new Response(null, { status: cors ? 204 : 404, headers: cors ?? undefined });
            }

            const session = await this.requestSession(req);
            if (!session.isAuthenticated) {
              return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401, headers: cors ?? undefined });
            }

            const fileUrl = url.searchParams.get('url');
            const widthParam = url.searchParams.get('w');
            const heightParam = url.searchParams.get('h');
            const qualityParam = url.searchParams.get('q');
            const formatParam = url.searchParams.get('format') as 'webp' | 'jpeg' | 'png' | 'avif' | null;

            if (!fileUrl) {
              return Response.json({ ok: false, error: 'MISSING_URL_PARAM' }, { status: 400 });
            }

            try {
              let buffer: Uint8Array;
              let mimeType = 'image/jpeg';

              if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
                const allowedDomains =
                  this.config.imageOptimizer?.allowedDomains ||
                  (process.env.SYNAPSE_ALLOWED_IMAGE_DOMAINS
                    ? process.env.SYNAPSE_ALLOWED_IMAGE_DOMAINS.split(',').map((s) => s.trim())
                    : undefined);

                const validation = await validateExternalUrl(fileUrl, { allowedDomains });
                if (!validation.ok) {
                  return Response.json(
                    { ok: false, error: validation.error || 'FORBIDDEN_TARGET_URL' },
                    { status: 403, headers: cors ?? undefined }
                  );
                }

                const fetched = await fetchPinnedExternal(fileUrl, validation.resolvedIp, {
                  maxBytes: this.config.imageOptimizer?.maxResponseBytes ?? 10 * 1024 * 1024,
                  timeoutMs: this.config.imageOptimizer?.timeoutMs ?? 10_000
                });

                if (!fetched.ok || !fetched.body) {
                  return Response.json(
                    { ok: false, error: fetched.code || 'FETCH_IMAGE_FAILED' },
                    { status: fetched.status ?? 502, headers: cors ?? undefined }
                  );
                }

                buffer = fetched.body;
                mimeType = fetched.contentType || mimeType;
              } else {
                const publicDir = path.resolve(this.baseDir, 'public');
                const cleanRel = fileUrl.replace(/^\/+/, '');
                const candidate = path.resolve(publicDir, cleanRel);

                if (!candidate.startsWith(publicDir + path.sep) && candidate !== publicDir) {
                  return Response.json(
                    { ok: false, error: 'FORBIDDEN_FILE_PATH' },
                    { status: 403, headers: cors ?? undefined }
                  );
                }
                if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
                  return Response.json(
                    { ok: false, error: 'IMAGE_NOT_FOUND' },
                    { status: 404, headers: cors ?? undefined }
                  );
                }
                buffer = new Uint8Array(await Bun.file(candidate).arrayBuffer());
              }

              const optimized = await optimizeImage(buffer, mimeType, {
                width: widthParam ? parseInt(widthParam, 10) : undefined,
                height: heightParam ? parseInt(heightParam, 10) : undefined,
                quality: qualityParam ? parseInt(qualityParam, 10) : undefined,
                format: formatParam || undefined
              });

              return new Response(Buffer.from(optimized.data), {
                status: 200,
                headers: {
                  'Content-Type': optimized.contentType,
                  'Cache-Control': 'public, max-age=31536000, immutable',
                  'X-Synapse-Engine': optimized.engine,
                  ...(cors ?? {})
                }
              });
            } catch (err: unknown) {
              return this.internalFailure(err, pathname, cors);
            }
          }

          // 5. Client bundles produced by the splitter
          if (pathname === '/_synapse/turbo-router.js') {
            this.logRequest(req, pathname, 200, startedAt, undefined, 'static');
            return new Response(TURBO_ROUTER_SCRIPT, {
              headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            });
          }

          if (pathname.startsWith('/_synapse/client/')) {
            const bundleFilename = path.basename(pathname);
            const bundleFile = path.join(this.baseDir, '.synapse/client', bundleFilename);
            if (!fs.existsSync(bundleFile) && bundleFilename === VENDOR_BUNDLE_NAME) {
              await buildVendorBundle(this.baseDir, this.config.compiler?.vendorPackages);
            }
            if (!fs.existsSync(bundleFile)) {
              this.logRequest(req, pathname, 404, startedAt);
              return new Response('Client bundle not found', { status: 404 });
            }
            this.logRequest(req, pathname, 200, startedAt, undefined, 'static');
            return new Response(Bun.file(bundleFile), {
              headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            });
          }

          // 5. UI Route Dispatcher (GET /:domain/:sliceName with optional i18n locale prefix)
          let resolvedSlice: DiscoveredSlice | undefined;
          let matchedLocale: string | undefined;

          for (const slice of this.slices.values()) {
            if (pathname === slice.routePath) {
              resolvedSlice = slice;
              break;
            }
          }

          if (!resolvedSlice && !pathname.startsWith('/_synapse/')) {
            const localeMatch = pathname.match(I18N_LOCALE_REGEX);
            if (localeMatch) {
              const strippedPath = pathname.replace(I18N_LOCALE_REGEX, '/');
              for (const slice of this.slices.values()) {
                if (strippedPath === slice.routePath) {
                  resolvedSlice = slice;
                  matchedLocale = localeMatch[1];
                  break;
                }
              }
            }
          }

          if (resolvedSlice) {
            const slice = resolvedSlice;

            // A rendered page load is an accepting surface too, and it is the most
            // expensive one: refuse before any loader or action runs.
            const pageRefusal = this.rateLimitRefusal(req, pathname, startedAt);

            if (pageRefusal) {
              return pageRefusal;
            }

            const session = await this.requestSession(req);
            const cacheConfig = slice.cacheConfig;
            const scopePrefix = `${session.tenantId || 'global'}:${session.userId !== 'anon' ? session.userId : 'public'}`;
            const normalizedKey = cacheConfig
              ? normalizeCacheKey(url, cacheConfig.allowedParams)
              : `${pathname}${url.search}`;
            const cacheKey = `${scopePrefix}:${normalizedKey}`;
            const now = Date.now();

            if (cacheConfig && req.method === 'GET') {
              const cached = this.ssrCache.get(cacheKey);
              if (cached) {
                if (now < cached.expiresAt) {
                  this.logRequest(req, pathname, 200, startedAt, session, 'ssr');
                  return new Response(cached.html, {
                    headers: {
                      'Content-Type': 'text/html; charset=utf-8',
                      'X-Synapse-Cache': 'HIT',
                      'Cache-Control': `public, max-age=${cached.ttlSeconds}, stale-while-revalidate=${cached.swrSeconds}`
                    }
                  });
                }
                if (now < cached.staleUntil) {
                  this.logRequest(req, pathname, 200, startedAt, session, 'ssr');
                  // Revalidação em background (ISR / Stale-While-Revalidate) - Thundering Herd Guard
                  if (!this.revalidatingKeys.has(cacheKey)) {
                    this.revalidatingKeys.add(cacheKey);
                    (async () => {
                      try {
                        const fresh = await this.renderSliceHtml(slice, req, url, matchedLocale);
                        if (!fresh.hasError) {
                          const ttl = cacheConfig.ttlSeconds;
                          const swr = cacheConfig.staleWhileRevalidateSeconds ?? 0;
                          this.ssrCache.set(cacheKey, {
                            html: fresh.html,
                            expiresAt: Date.now() + ttl * 1000,
                            staleUntil: Date.now() + (ttl + swr) * 1000,
                            ttlSeconds: ttl,
                            swrSeconds: swr,
                            tags: cacheConfig.tags || []
                          });
                        }
                      } catch (err) {
                        console.error(`[SynapseServer] Revalidação ISR em background de ${slice.key} falhou:`, err);
                      } finally {
                        this.revalidatingKeys.delete(cacheKey);
                      }
                    })();
                  }

                  return new Response(cached.html, {
                    headers: {
                      'Content-Type': 'text/html; charset=utf-8',
                      'X-Synapse-Cache': 'STALE',
                      'Cache-Control': `public, max-age=${cached.ttlSeconds}, stale-while-revalidate=${cached.swrSeconds}`
                    }
                  });
                }
              }
            }

            const { html, hasError } = await this.renderSliceHtml(slice, req, url, matchedLocale);

            if (hasError) {
              this.logRequest(req, pathname, 500, startedAt, session, 'ssr');
              return new Response(html, {
                status: 500,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'X-Robots-Tag': 'noindex, nofollow'
                }
              });
            }

            const headers: Record<string, string> = {
              'Content-Type': 'text/html; charset=utf-8'
            };

            if (cacheConfig && req.method === 'GET') {
              const ttl = cacheConfig.ttlSeconds;
              const swr = cacheConfig.staleWhileRevalidateSeconds ?? 0;
              this.ssrCache.set(cacheKey, {
                html,
                expiresAt: now + ttl * 1000,
                staleUntil: now + (ttl + swr) * 1000,
                ttlSeconds: ttl,
                swrSeconds: swr,
                tags: cacheConfig.tags || []
              });
              headers['X-Synapse-Cache'] = 'MISS';
              headers['Cache-Control'] = `public, max-age=${ttl}, stale-while-revalidate=${swr}`;
            }

            this.logRequest(req, pathname, 200, startedAt, session, 'ssr');
            return new Response(html, { headers });
          }

          this.logRequest(req, pathname, 404, startedAt);
          return new Response('404 Not Found in SynapseJS Router', { status: 404 });
        };

        let response: Response | undefined;

        try {
          response = await Promise.race([handleRequest(), this.drainSignal]);
        } finally {
          releaseInFlight();
        }

        // A successful WebSocket upgrade returned nothing: the connection is no
        // longer an HTTP response, so neither plugins nor headers apply to it.
        if (!(response instanceof Response)) {
          return response as unknown as Response;
        }

        if (this.config.plugins) {
          for (const plugin of this.config.plugins) {
            if (plugin.onResponse) {
              response = await plugin.onResponse(response, req);
            }
          }
        }

        // The baseline security headers are applied here, so every response — routed,
        // unrouted, static or an error page — carries the same set.
        return this.withBaselineHeaders(response, req);
      }
    });

    const server = this.httpServer;
    this.port = server.port ?? this.port;
    console.log(`⚡ [SynapseJS Server] Executando em http://localhost:${server.port}`);
    console.log(`   - Fatias descobertas: ${this.slices.size}`);
    console.log(`   - Hub Principal: http://localhost:${server.port}/`);
    console.log(`   - Banco SQLite: .synapse/synapse.sqlite`);

    return server;
  }
}

if (import.meta.main) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = new SynapseServer(process.cwd(), port);
  await server.discoverSlices();
  server.start();
}
