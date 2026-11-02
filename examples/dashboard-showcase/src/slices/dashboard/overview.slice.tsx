import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useState } from 'react';
import {
  type ActionContext,
  type DatabaseClient,
  defineCache,
  defineJob,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';
import {
  Badge,
  Button,
  Card,
  Drawer,
  DropdownItem,
  DropdownMenu,
  Modal,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  useToast
} from 'synapsejs/client';

// ============================================================================
// 1. DYNAMIC SEO & OPEN GRAPH (sliceMeta)
// ============================================================================
export function sliceMeta(data?: { metrics?: DashboardMetrics }) {
  const total = data?.metrics?.totalItems ?? 0;
  return {
    title: `Painel Executivo (${total} Itens) | SynapseJS Showcase`,
    description: 'Dashboard fullstack com fatias verticais, agregação SQL e micro-cache SSR no Bun.',
    openGraph: {
      title: 'SynapseJS Executive Dashboard',
      description: 'Arquitetura Locality of Behavior (N = 1) com SSR e Zero-Leak'
    }
  };
}

// ============================================================================
// 2. IN-MEMORY SSR MICRO-CACHE & ISR (defineCache)
// ============================================================================
export const sliceCache = defineCache({
  ttlSeconds: 10,
  staleWhileRevalidateSeconds: 30,
  tags: ['dashboard-overview']
});

// ============================================================================
// 3. BACKGROUND JOB (defineJob)
// ============================================================================
export const inventoryAuditJob = defineJob<{ initiatedBy: string }>({
  name: 'inventory-audit-job',
  retryLimit: 3,
  backoffSeconds: 5,
  handler: async (payload, ctx) => {
    const summary = await ctx.db.queryOne<{ totalStock: number }>(
      'SELECT COALESCE(sum(stock), 0) as totalStock FROM inventory'
    );
    ctx.logger.info(`[Audit Job] Concluído por ${payload.initiatedBy}: estoque global = ${summary?.totalStock ?? 0}`);
  }
});

// ============================================================================
// 4. CONTRATO DE ENTRADA & DOMÍNIO (Result<T, E>)
// ============================================================================
export const OverviewInputSchema = Type.Object(
  {
    refreshAudit: Type.Optional(Type.Boolean()),
    purgeCache: Type.Optional(Type.Boolean())
  },
  { additionalProperties: true }
);
export type OverviewInput = Static<typeof OverviewInputSchema>;

export interface DashboardMetrics {
  totalItems: number;
  totalStock: number;
  totalValue: number;
  lowStockCount: number;
  categoriesCount: number;
}

export type OverviewOutput = Result<
  { metrics: DashboardMetrics; auditEnqueued?: boolean; cacheInvalidated?: boolean },
  'INVALID_SCHEMA' | 'NO_DATABASE'
>;

// ============================================================================
// 5. SERVER ACTION
// ============================================================================
export async function overviewAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext,
  ctx?: ActionContext
): Promise<OverviewOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as OverviewInput;
  if (!Value.Check(OverviewInputSchema, input)) {
    return Err('INVALID_SCHEMA');
  }

  // Agregações SQL no SQLite em memória/WAL
  const countRow = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM inventory');
  const sumRow = await db.queryOne<{ totalValue: number; totalStock: number }>(
    'SELECT COALESCE(sum(price * stock), 0) as totalValue, COALESCE(sum(stock), 0) as totalStock FROM inventory'
  );
  const lowStockRow = await db.queryOne<{ count: number }>(
    "SELECT count(*) as count FROM inventory WHERE stock <= 5 OR status = 'low_stock'"
  );
  const catRow = await db.queryOne<{ count: number }>('SELECT count(DISTINCT category) as count FROM inventory');

  const metrics: DashboardMetrics = {
    totalItems: Number(countRow?.count ?? 0),
    totalStock: Number(sumRow?.totalStock ?? 0),
    totalValue: Number(sumRow?.totalValue ?? 0),
    lowStockCount: Number(lowStockRow?.count ?? 0),
    categoriesCount: Number(catRow?.count ?? 0)
  };

  let auditEnqueued = false;
  if (input.refreshAudit && ctx?.enqueue) {
    try {
      await ctx.enqueue(inventoryAuditJob, { initiatedBy: session?.userId ?? 'anon' });
      auditEnqueued = true;
    } catch {
      auditEnqueued = false;
    }
  }

  let cacheInvalidated = false;
  if (input.purgeCache && ctx?.invalidateCache) {
    ctx.invalidateCache(['dashboard-overview']);
    cacheInvalidated = true;
  }

  return Ok({ metrics, auditEnqueued, cacheInvalidated });
}

// ============================================================================
// 6. SERVER-SIDE LOADER (SSR com cache automático)
// ============================================================================
export async function OverviewLoader(
  context: SliceLoaderContext
): Promise<{ metrics: DashboardMetrics; timestamp: string; loadError?: string }> {
  const result = await overviewAction({}, context.db, context.session);

  if (!result.ok) {
    return {
      metrics: { totalItems: 0, totalStock: 0, totalValue: 0, lowStockCount: 0, categoriesCount: 0 },
      timestamp: new Date().toISOString(),
      loadError: result.error
    };
  }

  return {
    metrics: result.value.metrics,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// 7. UI REACT DO PAINEL EXECUTIVO
// ============================================================================
export interface OverviewViewProps {
  metrics?: DashboardMetrics;
  timestamp?: string;
  loadError?: string;
  onSubmitAction?: (payload: unknown) => Promise<OverviewOutput>;
}

export function OverviewTrigger({
  metrics = { totalItems: 0, totalStock: 0, totalValue: 0, lowStockCount: 0, categoriesCount: 0 },
  timestamp = '',
  loadError,
  onSubmitAction
}: OverviewViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const toast = useToast();

  const enqueueAudit = async () => {
    const result = await onSubmitAction?.({ refreshAudit: true });
    if (result?.ok && result.value.auditEnqueued) {
      toast.success('Auditoria enfileirada no worker.', 'Jobs');
    } else {
      toast.error('Não foi possível enfileirar a auditoria.', 'Jobs');
    }
    setIsModalOpen(false);
  };

  const purgeCache = async () => {
    const result = await onSubmitAction?.({ purgeCache: true });
    if (result?.ok && result.value.cacheInvalidated) {
      toast.success('Cache SSR do dashboard invalidado por tag.', 'Cache');
    } else {
      toast.error('O cache não pôde ser invalidado.', 'Cache');
    }
  };

  if (loadError) {
    return (
      <div className="p-4 rounded-xl border border-rose-800 bg-rose-950/40 text-rose-200 font-mono text-sm">
        Erro ao carregar métricas: {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6 md:p-8 max-w-7xl mx-auto w-full">
      {/* Hero Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 p-6 md:p-8 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-semibold text-cyan-400 uppercase tracking-widest">
              Painel de Controle em Tempo Real
            </span>
            <Badge variant="success">Online</Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Gestão Integrada de Estoque & Operações
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Arquitetura em Fatias Verticais Contíguas (<span className="text-cyan-400 font-mono">*.slice.tsx</span>) •
            Zero-Wiring Bun Server
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setIsModalOpen(true)}>
            ⚡ Ações Rápidas (Modal)
          </Button>
          <Button variant="secondary" onClick={() => setIsDrawerOpen(true)}>
            📜 Auditoria (Drawer)
          </Button>
          <DropdownMenu trigger={<Button variant="secondary">Opções ▾</Button>}>
            <DropdownItem
              onClick={() =>
                (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.(
                  '/inventory/list-items'
                )
              }
            >
              📊 Abrir catálogo (CSV)
            </DropdownItem>
            <DropdownItem onClick={() => void purgeCache()}>🔄 Purgar Cache</DropdownItem>
          </DropdownMenu>
          <a href="/inventory/create-item">
            <Button variant="primary">➕ Novo Produto</Button>
          </a>
        </div>
      </div>

      {/* Tabs Layout */}
      <Tabs defaultValue="kpis">
        <TabList>
          <Tab value="kpis">📊 Indicadores & Estoque</Tab>
          <Tab value="architecture">🏛️ Arquitetura SynapseJS</Tab>
        </TabList>

        <TabPanel value="kpis">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 pt-4">
            {/* Card 1: Total Produtos */}
            <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl shadow-lg hover:border-slate-700 transition-colors">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total de Produtos</span>
                <span className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 text-lg">📦</span>
              </div>
              <div className="mt-3 text-3xl font-extrabold text-white font-mono">{metrics.totalItems}</div>
              <div className="mt-2 text-xs text-slate-500 font-mono">Em {metrics.categoriesCount} categorias</div>
            </div>

            {/* Card 2: Unidades em Estoque */}
            <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl shadow-lg hover:border-slate-700 transition-colors">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Unidades em Estoque
                </span>
                <span className="p-2 rounded-lg bg-blue-500/10 text-blue-400 text-lg">📊</span>
              </div>
              <div className="mt-3 text-3xl font-extrabold text-white font-mono">{metrics.totalStock}</div>
              <div className="mt-2 text-xs text-slate-500 font-mono">Itens físicos disponíveis</div>
            </div>

            {/* Card 3: Valor Total de Inventário */}
            <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl shadow-lg hover:border-slate-700 transition-colors">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Patrimônio em Estoque
                </span>
                <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-lg">💰</span>
              </div>
              <div className="mt-3 text-3xl font-extrabold text-emerald-400 font-mono">
                R$ {metrics.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="mt-2 text-xs text-slate-500 font-mono">Avaliação a preço de venda</div>
            </div>

            {/* Card 4: Alertas de Baixo Estoque */}
            <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl shadow-lg hover:border-slate-700 transition-colors">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Alertas de Reposição
                </span>
                <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 text-lg">⚠️</span>
              </div>
              <div
                className={`mt-3 text-3xl font-extrabold font-mono ${metrics.lowStockCount > 0 ? 'text-amber-400' : 'text-slate-300'}`}
              >
                {metrics.lowStockCount}
              </div>
              <div className="mt-2 text-xs text-slate-500 font-mono">Estoque crítico (&le; 5 un)</div>
            </div>
          </div>
        </TabPanel>

        <TabPanel value="architecture">
          {/* Seção Informativa de Arquitetura */}
          <div className="pt-4">
            <Card
              title="Recursos Ativos nesta Aplicação"
              subtitle="Demonstração das 58 capacidades do SynapseJS v1.11.0"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-cyan-400 font-bold mb-1">⚡ Locality of Behavior (N=1)</div>
                  <p className="text-slate-400 font-sans">
                    Cada funcionalidade possui contrato TypeBox, DDL, Server Action, UI React e oráculo PBT em 1 único
                    arquivo.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-emerald-400 font-bold mb-1">🛡️ Zero-Leak Splitter</div>
                  <p className="text-slate-400 font-sans">
                    O compilador do Synapse extrai automaticamente código server-only do bundle cliente, garantindo 0
                    vazamento de SQL.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-purple-400 font-bold mb-1">🔄 Reversible Migrations</div>
                  <p className="text-slate-400 font-sans">
                    Blocos <span className="text-slate-300 font-mono">-- up:</span> e{' '}
                    <span className="text-slate-300 font-mono">-- down:</span> permitem migrações e rollbacks
                    transacionais instantâneos via CLI.
                  </p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
                <div>
                  Cache SSR: <span className="text-slate-400 font-mono">defineCache (10s TTL, 30s SWR)</span>
                </div>
                <div className="font-mono">Renderizado em: {timestamp}</div>
              </div>
            </Card>
          </div>
        </TabPanel>
      </Tabs>

      {/* Interactive Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Ações Rápidas do Sistema">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Execute rotinas operacionais com um clique. Notificações flutuantes utilizam o novo{' '}
            <code className="text-cyan-400">useToast()</code> integrado.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button variant="primary" onClick={() => void enqueueAudit()}>
              🔍 Disparar Auditoria
            </Button>
            <Button variant="secondary" onClick={() => void purgeCache()}>
              🔄 Invalidar Cache
            </Button>
          </div>
        </div>
      </Modal>

      {/* Interactive Drawer */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Auditoria e Métricas"
        position="right"
      >
        <div className="space-y-6 text-sm">
          <div>
            <h4 className="font-bold text-white mb-2">Estado da Conexão</h4>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 font-mono text-xs text-slate-400">
              <div>Engine: SQLite (WAL Mode)</div>
              <div>Timestamp: {timestamp}</div>
              <div>Status: Ativo e Conectado</div>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-white mb-2">Resumo Executivo</h4>
            <ul className="list-disc list-inside space-y-1 text-slate-300 text-xs font-mono">
              <li>{metrics.totalItems} produtos cadastrados</li>
              <li>{metrics.totalStock} unidades físicas em depósito</li>
              <li>{metrics.lowStockCount} alertas críticos de estoque</li>
            </ul>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setIsDrawerOpen(false)}>
            Fechar Painel
          </Button>
        </div>
      </Drawer>
    </div>
  );
}

// ============================================================================
// 8. ORÁCULOS DE INVARIANTES (Property-Based Testing via Fast-Check)
// ============================================================================
export const sliceTests = {
  description: 'Invariantes do Painel Executivo',
  cases: [
    {
      name: 'overviewAction retorna NO_DATABASE se db for indefinido',
      run: async () => {
        const res = await overviewAction({});
        if (res.ok || res.error !== 'NO_DATABASE') {
          throw new Error('esperava NO_DATABASE');
        }
      }
    },
    {
      name: 'overviewAction calcula métricas com banco vazio retornando zeros com status Ok',
      run: async () => {
        const mockDb = new MockDatabaseClient();
        mockDb.onQuery(/count\(\*\)/, () => [{ count: 0 }]);
        mockDb.onQuery(/sum\(price/, () => [{ totalValue: 0, totalStock: 0 }]);
        const res = await overviewAction({}, mockDb);
        if (!res.ok) {
          throw new Error('esperava Ok');
        }
        if (res.value.metrics.totalItems !== 0 || res.value.metrics.totalValue !== 0) {
          throw new Error('esperava métricas zeradas');
        }
      }
    }
  ]
};
