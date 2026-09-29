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
  createActionContext,
  createDefaultLogger,
  createSession,
  type DatabaseClient,
  getDatabase,
  loadSynapseConfig,
  optimizeImage,
  resetDatabaseInstance,
  type SessionContext,
  type SliceCacheConfig,
  type SliceSocketDefinition,
  type SynapseConfig,
  type SynapseWebSocket
} from '../core/index';
import { ROLES_COOKIE, SESSION_COOKIE } from '../core/session-cookie';
import { verifySessionToken } from '../core/session-token';
import { serializeClientProps } from './client-entry';
import { isAction, isCache, isComponent, isJob, isLoader, isMeta, isSocket, isWebhook } from './discovery-rules';
import { getEventHub } from './event-hub';
import { QueueEngine } from './queue-engine';
import { TokenBucketRateLimiter } from './rate-limiter';
import { saveUpload } from './uploads';

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
        if (newPropsScript) {
          try {
            eval(newPropsScript.textContent);
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
  private ssrCache = new Map<
    string,
    {
      html: string;
      expiresAt: number;
      staleUntil: number;
      ttlSeconds: number;
      swrSeconds: number;
      tags: string[];
    }
  >();

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
    this.rateLimiter = new TokenBucketRateLimiter();
    this.queueEngine = new QueueEngine({
      dbPath: path.join(this.baseDir, '.synapse/queue.sqlite'),
      logger: createDefaultLogger('QueueEngine')
    });
  }

  /**
   * Gracefully shuts down the HTTP server and closes database connections.
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.stop(true);
      this.httpServer = null;
    }
    this.rateLimiter.close();
    this.queueEngine.close();
    await this.db.close?.();
    resetDatabaseInstance();
  }

  get database(): DatabaseClient {
    return this.db;
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
      staticFileCount: this.metrics.staticFileCount
    };
  }

  get serverConfig(): SynapseConfig {
    return this.config;
  }

  private createActionContext(sliceName: string, session: SessionContext): ActionContext {
    return createActionContext({
      db: this.db,
      session,
      tenantId: session.tenantId,
      services: (this.config.services as Record<string, unknown>) || {},
      logger: createDefaultLogger(sliceName),
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
          if (isAction(exportName)) {
            actionFn = val;
          } else if (isLoader(exportName)) {
            loaderFn = val;
          } else if (isComponent(exportName)) {
            componentFn = val;
            componentExport = exportName;
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
        return AnonymousSession(tenantId);
      }
      const verified = verifySessionToken(token, secret);
      return verified.ok
        ? createSession({
            userId: verified.value.userId,
            tenantId: (verified.value as { tenantId?: string }).tenantId || tenantId,
            roles: verified.value.roles,
            token
          })
        : AnonymousSession(tenantId);
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
   * Returns stylesheet links, respecting SYNAPSE_DISABLE_CDN and detecting public/synapse.css
   */
  private renderStylesheets(): string {
    const disableCdn = process.env.SYNAPSE_DISABLE_CDN === 'true' || process.env.SYNAPSE_DISABLE_CDN === '1';
    const localCssPath = path.join(this.baseDir, 'public', 'synapse.css');
    const hasLocalCss = fs.existsSync(localCssPath);

    const elements: string[] = [];
    if (!disableCdn) {
      elements.push('  <script src="https://cdn.tailwindcss.com"></script>');
      elements.push('  <link rel="preconnect" href="https://fonts.googleapis.com">');
      elements.push('  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
      elements.push(
        '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">'
      );
    }
    if (hasLocalCss) {
      elements.push('  <link rel="stylesheet" href="/synapse.css">');
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
  ): Promise<{ html: string; dataProps: Record<string, unknown>; meta?: SliceMetadata }> {
    const session = this.sessionFrom(req);
    const actionCtx = this.createActionContext(slice.name, session);
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

    const clientUrl = loaderError ? null : await this.ensureClientBundle(slice);

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
    if (loaderError) {
      contentHtml = `<div class="text-rose-400">Falha no loader de ${escapeHtml(slice.key)}: ${escapeHtml(loaderError)}</div>`;
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
        const errMessage = e instanceof Error ? e.message : String(e);
        contentHtml = `<div class="text-rose-400">Erro na renderização SSR: ${escapeHtml(errMessage)}</div>`;
      }
    } else {
      contentHtml = '<div class="text-slate-400">Nenhum componente de UI exportado.</div>';
    }

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

    return { html, dataProps, meta };
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

  <script data-synapse-props>globalThis.__SYNAPSE_PROPS__ = ${propsJson};</script>
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
    <script data-synapse-props>globalThis.__SYNAPSE_PROPS__ = ${propsJson};</script>
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

    this.httpServer = Bun.serve({
      port: this.port,
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
        if (this.config.plugins) {
          for (const plugin of this.config.plugins) {
            if (plugin.onRequest) {
              const intercepted = await plugin.onRequest(req);
              if (intercepted instanceof Response) {
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
            const target = pathname.slice('/_synapse/ws/'.length);
            const resolved = this.resolveSlice(target);
            if (!resolved.ok) {
              return new Response(JSON.stringify({ error: resolved.message }), {
                status: resolved.status,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            const socketDef = resolved.slice.socketDef;
            if (!socketDef) {
              return new Response(JSON.stringify({ error: `Fatia ${resolved.slice.key} não declara sliceSocket` }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            const session = this.sessionFrom(req);
            const upgraded = (this.httpServer as any)?.upgrade(req, {
              data: {
                id: crypto.randomUUID(),
                sliceKey: resolved.slice.key,
                socketDef,
                session
              }
            });
            if (upgraded) {
              return undefined as any;
            }
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

            this.logRequest(req, pathname, httpStatus, startedAt);
            return Response.json(
              {
                status,
                framework: 'SynapseJS',
                version: '1.2.0',
                uptime: process.uptime(),
                database: dbHealthy ? 'connected' : 'disconnected',
                ...(dbError ? { databaseError: dbError } : {}),
                slicesLoaded: this.slices.size,
                slicesResolutionError: this.discoveryError,
                loadErrors: this.loadErrors,
                slices: Array.from(this.slices.values()).map((s) => ({
                  domain: s.domain,
                  name: s.name,
                  route: s.routePath,
                  rpc: s.rpcPath
                }))
              },
              { status: httpStatus }
            );
          }

          if (pathname === '/_synapse/api/metrics') {
            const uptimeSeconds = Math.round((Date.now() - this.metrics.startTime) / 1000);
            const formatParam = url.searchParams.get('format');
            const acceptHeader = req.headers.get('accept') || '';

            this.logRequest(req, pathname, 200, startedAt);

            if (formatParam === 'prometheus' || acceptHeader.includes('text/plain')) {
              const promText =
                [
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
                ].join('\n') + '\n';

              return new Response(promText, {
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

          // 3. Rate Limiter for Sensitive Endpoints (RPC, Uploads, Webhooks)
          if (
            pathname.startsWith('/_synapse/rpc/') ||
            pathname.startsWith('/_synapse/files/') ||
            pathname.startsWith('/_synapse/webhooks/')
          ) {
            const clientKey =
              req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
              req.headers.get('cf-connecting-ip') ||
              req.headers.get('authorization') ||
              'global';

            const rateResult = this.rateLimiter.consume(clientKey);
            if (!rateResult.allowed) {
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

            try {
              const body = await req.json();
              const session = this.sessionFrom(req);
              const actionCtx = this.createActionContext(slice.name, session);

              const result = await slice.actionFn(body, actionCtx, session, actionCtx);
              const status = result.ok ? 200 : httpStatusForError(result.error);
              const metricType = result.ok ? 'rpc_success' : 'rpc_error';
              this.logRequest(req, pathname, status, startedAt, session, metricType);

              return Response.json(result, { status, headers: cors ?? undefined });
            } catch (err: any) {
              this.logRequest(req, pathname, 500, startedAt, undefined, 'rpc_error');
              return Response.json({ ok: false, error: `Falha interna no RPC: ${err.message}` }, { status: 500 });
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

            try {
              const rawBody = new Uint8Array(await req.arrayBuffer());
              const bodyText = new TextDecoder().decode(rawBody);
              let json: unknown = null;
              try {
                json = JSON.parse(bodyText);
              } catch {
                json = null;
              }

              const session = this.sessionFrom(req);
              const actionCtx = this.createActionContext(slice.name, session);

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
              const message = err instanceof Error ? err.message : String(err);
              this.logRequest(req, pathname, 500, startedAt);
              return Response.json(
                { ok: false, error: `Falha no processamento de webhook: ${message}` },
                { status: 500 }
              );
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
              return Response.json({ ok: false, error: 'Tópico de subscrição inválido.' }, { status: 400 });
            }

            const eventHub = getEventHub();
            const session = this.sessionFrom(req);
            let unsubscribe: (() => void) | null = null;
            let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

            const stream = new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode(': connected\n\n'));

                keepAliveTimer = setInterval(() => {
                  try {
                    controller.enqueue(encoder.encode(': keep-alive\n\n'));
                  } catch {
                    if (keepAliveTimer) clearInterval(keepAliveTimer);
                  }
                }, 15000);

                unsubscribe = eventHub.subscribe(topic, (data) => {
                  try {
                    const eventData = JSON.stringify(data);
                    controller.enqueue(encoder.encode(`event: message\ndata: ${eventData}\n\n`));
                  } catch (err) {
                    console.error(`[SSE] Erro ao serializar evento para tópico "${topic}":`, err);
                  }
                });
              },
              cancel() {
                if (keepAliveTimer) clearInterval(keepAliveTimer);
                if (unsubscribe) unsubscribe();
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
              session: this.sessionFrom(req)
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
                const res = await fetch(fileUrl);
                if (!res.ok) {
                  return Response.json({ ok: false, error: 'FETCH_IMAGE_FAILED' }, { status: 502 });
                }
                buffer = new Uint8Array(await res.arrayBuffer());
                mimeType = res.headers.get('content-type') || mimeType;
              } else {
                const cleanRel = fileUrl.replace(/^\/+/, '');
                const candidate = path.resolve(this.baseDir, cleanRel);
                if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
                  return Response.json({ ok: false, error: 'IMAGE_NOT_FOUND' }, { status: 404 });
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
              const msg = err instanceof Error ? err.message : String(err);
              return Response.json({ ok: false, error: msg }, { status: 500 });
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
            const session = this.sessionFrom(req);
            const cacheConfig = slice.cacheConfig;
            const cacheKey = `${pathname}${url.search}`;
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
                  // Revalidação em background (ISR / Stale-While-Revalidate)
                  (async () => {
                    try {
                      const fresh = await this.renderSliceHtml(slice, req, url, matchedLocale);
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
                    } catch (err) {
                      console.error(`[SynapseServer] Revalidação ISR em background de ${slice.key} falhou:`, err);
                    }
                  })();

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

            const { html } = await this.renderSliceHtml(slice, req, url, matchedLocale);
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

        let response = await handleRequest();
        if (this.config.plugins) {
          for (const plugin of this.config.plugins) {
            if (plugin.onResponse) {
              response = await plugin.onResponse(response, req);
            }
          }
        }
        return response;
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
