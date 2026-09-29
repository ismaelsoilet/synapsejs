import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SliceOutlet, SliceOutletProvider } from '../src/client/outlet';
import { SubSlice } from '../src/client/sub-slice';
import { scaffoldShared } from '../src/compiler/scaffolder';
import { splitSlice } from '../src/compiler/slice-splitter';
import { defineCache, type SliceCacheConfig } from '../src/core/cache';
import { Ok, type Result } from '../src/core/index';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { defineSocket, type SliceSocketDefinition } from '../src/core/websocket';
import { isCache, isSocket } from '../src/runtime/discovery-rules';
import { SynapseServer } from '../src/runtime/server';

const tempAppDir = path.join(import.meta.dir, 'fixtures', 'onda7-test-app');

describe('Onda 7: Resolvendo as 6 Deficiências Estruturais do SynapseJS', () => {
  let server: SynapseServer;
  let serverPort: number;
  let testDb: SqliteDatabaseClient;

  beforeAll(async () => {
    // 1. Prepare isolated test app
    fs.mkdirSync(path.join(tempAppDir, 'src', 'slices', 'catalog'), { recursive: true });
    fs.mkdirSync(path.join(tempAppDir, 'src', 'slices', 'chat'), { recursive: true });
    fs.mkdirSync(path.join(tempAppDir, 'src', 'shared'), { recursive: true });

    // Slices for Catalog with ISR cache
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'catalog', 'products.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';
import { defineCache } from 'synapsejs';

export const ProductsInputSchema = Type.Object({ category: Type.Optional(Type.String()) });
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS onda7_products (id TEXT PRIMARY KEY, name TEXT);';

export const sliceCache = defineCache({
  ttlSeconds: 60,
  staleWhileRevalidateSeconds: 120,
  tags: ['catalog', 'products']
});

let renderCount = 0;

export async function productsAction(payload: any, dbOrCtx: any): Promise<Result<{ ok: boolean }, 'ERR'>> {
  if (dbOrCtx?.invalidateCache) {
    dbOrCtx.invalidateCache(['products']);
  }
  return Ok({ ok: true });
}

export async function ProductsLoader(ctx: any) {
  renderCount++;
  return { counter: renderCount, timestamp: Date.now() };
}

export function ProductsView(props: { counter?: number; timestamp?: number }) {
  return (
    <div id="products-view">
      <h1 data-counter={props.counter}>Catálogo de Produtos #{props.counter}</h1>
      <span data-ts={props.timestamp}>Gerado em {props.timestamp}</span>
    </div>
  );
}
`,
      'utf-8'
    );

    // Slice for Chat with bidirectional WebSocket
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'chat', 'room.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';
import { defineSocket } from 'synapsejs';

export const RoomInputSchema = Type.Object({});
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS onda7_messages (id TEXT PRIMARY KEY, text TEXT);';

export const sliceSocket = defineSocket<{ text: string }>({
  onOpen(ws) {
    ws.send(JSON.stringify({ type: 'WELCOME', msg: 'Conectado à sala de chat' }));
  },
  onMessage(ws, message) {
    ws.send(JSON.stringify({ type: 'ECHO', received: message }));
  },
  onClose(ws, code, reason) {
    // cleanup
  }
});

export async function roomAction(): Promise<Result<{ ok: boolean }, 'ERR'>> {
  return Ok({ ok: true });
}

export function RoomComponent() {
  return <div>Sala de Chat</div>;
}
`,
      'utf-8'
    );

    const dbPath = path.join(tempAppDir, '.synapse', 'onda7-test.sqlite');
    testDb = new SqliteDatabaseClient(dbPath);

    server = new SynapseServer(tempAppDir, 0, testDb, {
      compiler: {
        vendorPackages: ['canvas-confetti', 'lucide-react']
      }
    });

    await server.discoverSlices();
    await server.start();
    serverPort = server.port;
  });

  afterAll(async () => {
    try {
      await server.stop();
      testDb.close();
      fs.rmSync(tempAppDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // DEFICIÊNCIA 1: Concorrência e Write Lock no SQLite
  // =========================================================================
  describe('1. SQLite High-Concurrency Pragmas & Mutex (Deficiência 1)', () => {
    it('initializes SQLite with WAL mode, NORMAL synchronous, busy_timeout >= 5000 and memory temp_store', async () => {
      const journalMode = (await testDb.query<{ journal_mode: string }>('PRAGMA journal_mode;'))[0]?.journal_mode;
      const syncMode = (await testDb.query<{ synchronous: number }>('PRAGMA synchronous;'))[0]?.synchronous;
      const busyTimeout = (await testDb.query<{ timeout: number }>('PRAGMA busy_timeout;'))[0]?.timeout;
      const tempStore = (await testDb.query<{ temp_store: number }>('PRAGMA temp_store;'))[0]?.temp_store;

      expect(journalMode?.toLowerCase()).toBe('wal');
      // synchronous = 1 (NORMAL)
      expect(syncMode).toBe(1);
      // busy_timeout = 5000ms
      expect(busyTimeout).toBe(5000);
      // temp_store = 2 (MEMORY)
      expect(tempStore).toBe(2);
    });

    it('executes 100 concurrent transactional writes without SQLITE_BUSY', async () => {
      await testDb.query('CREATE TABLE IF NOT EXISTS onda7_bench (id INTEGER PRIMARY KEY, val TEXT);');

      const promises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          testDb.transaction(async (tx) => {
            await tx.query('INSERT INTO onda7_bench (val) VALUES (?);', [`val-${i}`]);
          })
        );
      }

      await expect(Promise.all(promises)).resolves.toBeDefined();
      const rows = await testDb.query<{ cnt: number }>('SELECT count(*) as cnt FROM onda7_bench;');
      expect(rows[0]?.cnt).toBe(100);
    });
  });

  // =========================================================================
  // DEFICIÊNCIA 2: Sub-Slices e Aninhamento de Outlets
  // =========================================================================
  describe('2. Sub-Slice & Nested Slice Outlets (Deficiência 2)', () => {
    it('<SliceOutletProvider> and <SliceOutlet> render content in declared named slots', () => {
      const outlets = {
        header: <h1>Cabeçalho Global</h1>,
        sidebar: <aside>Navegação Lateral</aside>
      };

      const tree = (
        <SliceOutletProvider outlets={outlets}>
          <div className="layout">
            <SliceOutlet name="header" />
            <main>Conteúdo Principal</main>
            <SliceOutlet name="sidebar" />
            <SliceOutlet name="footer" fallback={<footer>Rodapé Padrão</footer>} />
          </div>
        </SliceOutletProvider>
      );

      const html = renderToString(tree);
      expect(html).toContain('<h1>Cabeçalho Global</h1>');
      expect(html).toContain('Conteúdo Principal');
      expect(html).toContain('<aside>Navegação Lateral</aside>');
      expect(html).toContain('<footer>Rodapé Padrão</footer>');
    });

    it('<SubSlice> transparently binds RPC endpoints to action props without violating N=1', () => {
      function DummyChild(props: { action?: (p: any) => Promise<any>; customProp?: string }) {
        return (
          <div data-testid="dummy" data-has-action={Boolean(props.action)} data-custom={props.customProp}>
            Sub-Slice Carregado
          </div>
        );
      }

      const tree = (
        <SubSlice domain="catalog" name="products" component={DummyChild} props={{ customProp: 'valor-especial' }} />
      );

      const html = renderToString(tree);
      expect(html).toContain('data-has-action="true"');
      expect(html).toContain('data-custom="valor-especial"');
      expect(html).toContain('Sub-Slice Carregado');
    });

    it('<SubSlice> supports function-as-children pattern with injected actions', () => {
      const tree = (
        <SubSlice domain="catalog" name="products" props={{ title: 'Mini Catálogo' }}>
          {(injected) => (
            <div>
              <h2>{String(injected.title)}</h2>
              <span data-action-ready={Boolean(injected.action)} />
            </div>
          )}
        </SubSlice>
      );

      const html = renderToString(tree);
      expect(html).toContain('<h2>Mini Catálogo</h2>');
      expect(html).toContain('data-action-ready="true"');
    });
  });

  // =========================================================================
  // DEFICIÊNCIA 3: Bidirectional Native WebSockets
  // =========================================================================
  describe('3. Native Bidirectional WebSockets (Deficiência 3)', () => {
    it('discovers sliceSocket and registers WebSocket upgrade endpoint', async () => {
      expect(isSocket('sliceSocket')).toBe(true);
      expect(isSocket('chatSocket')).toBe(true);
      expect(isSocket('myAction')).toBe(false);

      const def = defineSocket({
        onOpen() {},
        onMessage() {},
        onClose() {}
      });
      expect(typeof def.onOpen).toBe('function');
      expect(typeof def.onMessage).toBe('function');
    });

    it('connects to slice WebSocket endpoint, receives WELCOME and echoes messages', async () => {
      const wsUrl = `ws://localhost:${serverPort}/_synapse/ws/chat/room`;

      const client = new WebSocket(wsUrl);
      const messages: any[] = [];

      await new Promise<void>((resolve, reject) => {
        client.onopen = () => {
          // Send first message after open
          client.send(JSON.stringify({ text: 'Olá do teste Bun!' }));
        };

        client.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data.toString());
            messages.push(data);
            if (messages.length >= 2) {
              client.close();
              resolve();
            }
          } catch (e) {
            reject(e);
          }
        };

        client.onerror = (err) => reject(err);
        setTimeout(() => reject(new Error('WebSocket timeout')), 3000);
      });

      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].type).toBe('WELCOME');
      expect(messages[1].type).toBe('ECHO');
      expect(messages[1].received.text).toBe('Olá do teste Bun!');
    });

    it('returns 404 if slice does not declare sliceSocket on websocket endpoint', async () => {
      const res = await fetch(`http://localhost:${serverPort}/_synapse/ws/catalog/products`);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('não declara sliceSocket');
    });
  });

  // =========================================================================
  // DEFICIÊNCIA 4: SSR Micro-Cache & ISR (Stale-While-Revalidate)
  // =========================================================================
  describe('4. SSR Micro-Cache & ISR (Deficiência 4)', () => {
    it('discovers sliceCache and sets up caching rules', () => {
      expect(isCache('sliceCache')).toBe(true);
      expect(isCache('catalogCache')).toBe(true);
      expect(isCache('ProductsLoader')).toBe(false);

      const cacheDef = defineCache({
        ttlSeconds: 10,
        staleWhileRevalidateSeconds: 30,
        tags: ['teste']
      });
      expect(cacheDef.ttlSeconds).toBe(10);
      expect(cacheDef.tags).toEqual(['teste']);
    });

    it('returns X-Synapse-Cache: MISS on first request, then HIT on immediate second request', async () => {
      // First request (MISS)
      const res1 = await fetch(`http://localhost:${serverPort}/catalog/products`);
      expect(res1.status).toBe(200);
      expect(res1.headers.get('X-Synapse-Cache')).toBe('MISS');
      expect(res1.headers.get('Cache-Control')).toContain('max-age=60');
      const html1 = await res1.text();
      expect(html1).toContain('data-counter="1"');

      // Second immediate request (HIT)
      const res2 = await fetch(`http://localhost:${serverPort}/catalog/products`);
      expect(res2.status).toBe(200);
      expect(res2.headers.get('X-Synapse-Cache')).toBe('HIT');
      const html2 = await res2.text();
      // Should serve exact cached content (#1, not #2)
      expect(html2).toContain('data-counter="1"');
    });

    it('flushes cache on action call via ctx.invalidateCache or server.invalidateCache', async () => {
      // Invalidate tags
      server.invalidateCache(['products']);

      // Next request must be a MISS and increment counter
      const res = await fetch(`http://localhost:${serverPort}/catalog/products`);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Synapse-Cache')).toBe('MISS');
      const html = await res.text();
      expect(html).toContain('data-counter="2"');
    });
  });

  // =========================================================================
  // DEFICIÊNCIA 5: Vendor Bundling para Terceiros
  // =========================================================================
  describe('5. Third-Party Vendor Bundling (Deficiência 5)', () => {
    it('includes configured compiler.vendorPackages in HTML shell importmap', async () => {
      const res = await fetch(`http://localhost:${serverPort}/catalog/products`);
      const html = await res.text();

      expect(html).toContain('<script type="importmap">');
      expect(html).toContain('"canvas-confetti": "/_synapse/client/_vendor.js"');
      expect(html).toContain('"lucide-react": "/_synapse/client/_vendor.js"');
      expect(html).toContain('"react": "/_synapse/client/_vendor.js"');
    });
  });

  // =========================================================================
  // DEFICIÊNCIA 6: Ergonomia de Módulos Compartilhados (Shared)
  // =========================================================================
  describe('6. Shared Module Scaffolding & Strict Isolation (Deficiência 6)', () => {
    it('scaffolds a transactional shared module via scaffoldShared', async () => {
      const result = scaffoldShared('pricing-engine', tempAppDir);
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(fs.existsSync(result.value)).toBe(true);
        const code = fs.readFileSync(result.value, 'utf-8');
        expect(code).toContain('export async function executeSharedPricingEngine(');
        expect(code).toContain('db: DatabaseClient');
        expect(code).toContain('db.transaction(');
        expect(code).toContain('Ok(');
      }
    });

    it('refuses to overwrite an existing shared module unless overwrite is true', async () => {
      const result = scaffoldShared('pricing-engine', tempAppDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SLICE_EXISTS');
      }
    });

    it('produces enriched SLICE_IMPORTS_SLICE diagnostic with synapse new-shared recommendation', () => {
      const leakySlicePath = path.join(tempAppDir, 'src', 'slices', 'catalog', 'leaky.slice.tsx');
      fs.writeFileSync(
        leakySlicePath,
        `import React from 'react';
import { Type } from '@sinclair/typebox';
import { productsAction } from './products.slice';

export const LeakyInputSchema = Type.Object({});
export const sliceSchema = '';
export async function leakyAction() { return productsAction({}); }
export function LeakyComponent() { return <div>Leaky</div>; }
`,
        'utf-8'
      );

      const split = splitSlice(leakySlicePath, tempAppDir);
      expect(split.ok).toBe(false);
      if (!split.ok) {
        expect(split.error.code).toBe('SLICE_IMPORTS_SLICE');
        expect(split.error.message).toContain('synapse new-shared');
      }
    });
  });
});
