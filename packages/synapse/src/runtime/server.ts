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
import { runSliceMigrations } from '../compiler/migration-runner';
import { findSliceFiles, resolveSlicesDir } from '../compiler/slice-discovery';
import { AnonymousSession, createSession, type DatabaseClient, getDatabase, type SessionContext } from '../core/index';

export interface DiscoveredSlice {
  domain: string;
  name: string;
  /** `<domain>/<name>`: what identifies a slice unambiguously. */
  key: string;
  routePath: string;
  rpcPath: string;
  filePath: string;
  actionFn?: (payload: unknown, db: DatabaseClient, session?: SessionContext) => Promise<any>;
  componentFn?: React.ComponentType<any>;
  /** Optional server-side data for the component: `export function <Name>Loader(context)`. */
  loaderFn?: (context: SliceLoaderContext) => Promise<Record<string, unknown>>;
}

/**
 * What a slice loader receives. The loader runs on the server, on every SSR
 * request: it is how a component gets real data instead of hardcoded props.
 */
export interface SliceLoaderContext {
  url: string;
  params: Record<string, string>;
  db: DatabaseClient;
  session: SessionContext;
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

export function httpStatusForError(error: unknown): number {
  const code = typeof error === 'string' ? error : '';

  for (const entry of ERROR_STATUS) {
    if (entry.pattern.test(code)) {
      return entry.status;
    }
  }

  return 400;
}

export class SynapseServer {
  private slices: Map<string, DiscoveredSlice> = new Map();
  private baseDir: string;
  private db: DatabaseClient;
  private discoveryError: { code: string; message: string; candidates: string[] } | null = null;
  private loadErrors: SliceLoadError[] = [];
  public port: number;

  constructor(baseDir: string = process.cwd(), port: number = 3000) {
    this.baseDir = baseDir;
    this.port = port;
    this.db = getDatabase();
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

    for (const file of files) {
      const rel = path.relative(slicesDir, file);
      const parts = rel.split(path.sep);
      const domain = parts[0] || 'general';
      const name = path.basename(file, '.slice.tsx');
      const key = `${domain}/${name}`;
      const routePath = `/${domain}/${name}`;
      const rpcPath = `/_synapse/rpc/${domain}/${name}`;

      if (this.slices.has(key)) {
        this.loadErrors.push({ file, message: `chave de fatia duplicada: ${key}` });
        continue;
      }

      try {
        const mod = await import(file);
        let actionFn: any = null;
        let componentFn: any = null;
        let loaderFn: any = null;

        for (const [exportName, val] of Object.entries(mod)) {
          if (typeof val === 'function') {
            if (exportName.endsWith('Action')) {
              actionFn = val;
            } else if (exportName.endsWith('Loader')) {
              loaderFn = val;
            } else if (
              exportName.endsWith('Trigger') ||
              exportName.endsWith('View') ||
              exportName.endsWith('Form') ||
              exportName.endsWith('Component')
            ) {
              componentFn = val;
            }
          }
        }

        this.slices.set(key, {
          domain,
          name,
          key,
          routePath,
          rpcPath,
          filePath: file,
          actionFn,
          componentFn,
          loaderFn
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

  private sessionFrom(request: Request): SessionContext {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const userIdHeader = request.headers.get('x-user-id');
    const rolesHeader = request.headers.get('x-user-roles');

    // Qualquer um dos três headers identifica uma sessão. Antes, mandar apenas
    // `x-user-roles` (o que o cookie do browser produz) caía em sessão anônima em
    // silêncio e toda action respondia UNAUTHORIZED sem explicação.
    if (authHeader || userIdHeader || rolesHeader) {
      const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : undefined;
      return createSession({
        userId: userIdHeader || `user-${token?.slice(0, 8) || 'header'}`,
        roles: rolesHeader ? rolesHeader.split(',').map((role) => role.trim()) : ['user'],
        token
      });
    }

    return AnonymousSession();
  }

  /**
   * Generates the SSR HTML Shell with Inter font, Tailwind and client hydration
   */
  private renderHtmlShell(title: string, contentHtml: string, sliceName: string, rpcPath: string): string {
    return `<!DOCTYPE html>
<html lang="pt-BR" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | SynapseJS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
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
        <h1 class="text-2xl font-bold text-white tracking-tight">${title}</h1>
        <p class="text-sm text-slate-400 font-mono mt-1">Fatia Vertical: <span class="text-cyan-400">${sliceName}.slice.tsx</span></p>
      </div>
      <a href="/" class="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors">
        ← Voltar ao Hub
      </a>
    </div>

    <!-- Slice Render Container -->
    <div id="synapse-root" class="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-2xl backdrop-blur">
      ${contentHtml}
    </div>

    <!-- Client Hydration & Transparent RPC Script -->
    <script>
      (function() {
        const form = document.querySelector('form');
        if (!form) return;

        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          const submitBtn = form.querySelector('button[type="submit"]');
          const originalText = submitBtn ? submitBtn.innerText : 'Enviar';
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Processando via RPC...';
          }

          const formData = new FormData(form);
          const payload = {};
          formData.forEach((value, key) => {
            if (!isNaN(value) && value !== '') {
              payload[key] = value.includes('.') ? parseFloat(value) : parseInt(value, 10);
            } else {
              payload[key] = value;
            }
          });

          // Ensure customerId fallback if required
          if (!payload.customerId) {
            payload.customerId = 'cust-demo-1234567890';
          }

          try {
            // Credenciais do browser são repassadas por cookie para as Server Actions
            // que exigem SessionContext (ex.: definir synapse_token e synapse_roles).
            const readCookie = (name) => {
              const entry = document.cookie.split('; ').find((c) => c.startsWith(name + '='));
              return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
            };

            const rpcHeaders = { 'Content-Type': 'application/json' };
            const token = readCookie('synapse_token');
            const roles = readCookie('synapse_roles');
            if (token) rpcHeaders['Authorization'] = 'Bearer ' + token;
            if (roles) rpcHeaders['x-user-roles'] = roles;

            const res = await fetch('${rpcPath}', {
              method: 'POST',
              headers: rpcHeaders,
              body: JSON.stringify(payload)
            });
            const data = await res.json();

            let feedbackBox = document.getElementById('synapse-feedback');
            if (!feedbackBox) {
              feedbackBox = document.createElement('div');
              feedbackBox.id = 'synapse-feedback';
              feedbackBox.className = 'mt-4 p-4 rounded-lg font-mono text-sm border';
              form.parentNode.appendChild(feedbackBox);
            }

            if (data.ok) {
              feedbackBox.className = 'mt-4 p-4 rounded-lg font-mono text-sm border bg-emerald-950/60 border-emerald-800 text-emerald-300';
              feedbackBox.innerHTML = '<strong>Sucesso (Ok):</strong> ' + JSON.stringify(data.value, null, 2);
            } else {
              feedbackBox.className = 'mt-4 p-4 rounded-lg font-mono text-sm border bg-rose-950/60 border-rose-800 text-rose-300';
              feedbackBox.innerHTML = '<strong>Erro (Err):</strong> ' + JSON.stringify(data.error, null, 2);
            }
          } catch (err) {
            alert('Falha na requisição RPC: ' + err.message);
          } finally {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerText = originalText;
            }
          }
        });
      })();
    </script>
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
                ${s.domain}
              </span>
              <span class="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Pronto
              </span>
            </div>
            <h3 class="text-lg font-semibold text-white mb-1">${s.name}</h3>
            <p class="text-xs text-slate-400 font-mono mb-4 truncate">${s.filePath}</p>
          </div>
          <div class="flex items-center gap-2 pt-3 border-t border-slate-800/80">
            <a href="${s.routePath}" class="flex-1 text-center py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors">
              Abrir Interface UI →
            </a>
            <span class="text-xs font-mono text-slate-500 bg-slate-800/80 px-2 py-2 rounded-lg" title="RPC Endpoint">
              POST ${s.rpcPath}
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
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
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
        ${this.loadErrors.map((error) => `<li>${error.file}: ${error.message}</li>`).join('')}
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
    // 0. Auto-run declarative slice migrations on startup
    await runSliceMigrations(this.baseDir, this.db);

    const server = Bun.serve({
      port: this.port,
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        const pathname = url.pathname;

        // 1. Dashboard Hub
        if (pathname === '/' || pathname === '/index.html') {
          return new Response(this.renderDashboardHtml(), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        // 2. Machine Endpoints for AI
        if (pathname === '/_synapse/api/repo-map') {
          const repoMapPath = path.join(this.baseDir, '.codebase/repo-map.d.ts');
          if (fs.existsSync(repoMapPath)) {
            const content = fs.readFileSync(repoMapPath, 'utf-8');
            return new Response(content, {
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          }
          return new Response('repo-map.d.ts not generated yet', { status: 404 });
        }

        if (pathname === '/_synapse/api/health') {
          return Response.json({
            status: 'OK',
            framework: 'SynapseJS',
            version: '0.6.0',
            uptime: process.uptime(),
            slicesLoaded: this.slices.size,
            slicesResolutionError: this.discoveryError,
            loadErrors: this.loadErrors,
            slices: Array.from(this.slices.values()).map((s) => ({
              domain: s.domain,
              name: s.name,
              route: s.routePath,
              rpc: s.rpcPath
            }))
          });
        }

        // 3. RPC Actions Dispatcher (POST /_synapse/rpc/:sliceName)
        if (pathname.startsWith('/_synapse/rpc/')) {
          if (req.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
          }

          const target = pathname.replace('/_synapse/rpc/', '');
          const resolved = this.resolveSlice(target);

          if (!resolved.ok) {
            return Response.json({ ok: false, error: resolved.message }, { status: resolved.status });
          }

          const slice = resolved.slice;
          if (!slice.actionFn) {
            return Response.json(
              { ok: false, error: `A fatia '${slice.key}' não exporta nenhuma *Action.` },
              { status: 404 }
            );
          }

          try {
            const body = await req.json();
            const session = this.sessionFrom(req);

            const result = await slice.actionFn(body, this.db, session);
            return Response.json(result, {
              status: result.ok ? 200 : httpStatusForError(result.error)
            });
          } catch (err: any) {
            return Response.json({ ok: false, error: `Falha interna no RPC: ${err.message}` }, { status: 500 });
          }
        }

        // 4. UI Route Dispatcher (GET /:domain/:sliceName)
        for (const slice of this.slices.values()) {
          if (pathname === slice.routePath) {
            const session = this.sessionFrom(req);
            const params = Object.fromEntries(url.searchParams.entries());
            let props: Record<string, unknown> = { ...params };
            let loaderError: string | null = null;

            if (slice.loaderFn) {
              try {
                const loaded = await slice.loaderFn({ url: url.toString(), params, db: this.db, session });
                props = { ...props, ...loaded };
              } catch (err) {
                loaderError = err instanceof Error ? err.message : String(err);
                console.error(`[SynapseServer] Loader de ${slice.key} falhou: ${loaderError}`);
              }
            }

            let contentHtml: string;
            if (loaderError) {
              contentHtml = `<div class="text-rose-400">Falha no loader de ${slice.key}: ${loaderError}</div>`;
            } else if (slice.componentFn) {
              try {
                contentHtml = renderToString(React.createElement(slice.componentFn, props));
              } catch (e: any) {
                contentHtml = `<div class="text-rose-400">Erro na renderização SSR: ${e.message}</div>`;
              }
            } else {
              contentHtml = '<div class="text-slate-400">Nenhum componente de UI exportado.</div>';
            }

            const html = this.renderHtmlShell(slice.name, contentHtml, slice.name, slice.rpcPath);
            return new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
        }

        return new Response('404 Not Found in SynapseJS Router', { status: 404 });
      }
    });

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
