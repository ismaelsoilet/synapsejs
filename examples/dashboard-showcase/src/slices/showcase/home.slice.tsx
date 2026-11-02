import type { DatabaseClient, SliceLoaderContext } from 'synapsejs';
import { MockDatabaseClient, projectStatus } from 'synapsejs';
import { Badge, Button } from 'synapsejs/client';
import { getHomeCounts, type HomeCounts } from '../../shared/showcase';
import { FeatureCard, PageHeader, Sparkline, StatCard } from '../../shared/ui';

export interface HomeMetrics extends HomeCounts {
  inventoryValue: number;
  lowStock: number;
  databaseOk: boolean;
}

export interface HomeLoaderData {
  metrics: HomeMetrics;
  platform: {
    version: string;
    stable: number;
    experimental: number;
    roadmap: number;
    tools: number;
    adoption: string;
  };
  generatedAt: string;
}

async function readHomeMetrics(db: DatabaseClient): Promise<HomeMetrics> {
  const counts = await getHomeCounts(db);
  let inventoryValue = 0;
  let lowStock = 0;
  let databaseOk = true;

  try {
    const value = await db.queryOne<{ total: number }>(
      'SELECT COALESCE(sum(price * stock), 0) AS total FROM inventory'
    );
    const low = await db.queryOne<{ count: number }>(
      "SELECT count(*) AS count FROM inventory WHERE stock <= 5 OR status = 'low_stock'"
    );
    inventoryValue = Number(value?.total ?? 0);
    lowStock = Number(low?.count ?? 0);
  } catch {
    databaseOk = false;
  }

  return { ...counts, inventoryValue, lowStock, databaseOk };
}

export async function HomeLoader(context: SliceLoaderContext): Promise<HomeLoaderData> {
  const status = projectStatus();
  const features = status.features;
  return {
    metrics: await readHomeMetrics(context.db),
    platform: {
      version: status.version,
      stable: features.filter((feature) => feature.status === 'stable').length,
      experimental: features.filter((feature) => feature.status === 'experimental').length,
      roadmap: features.filter((feature) => feature.status === 'roadmap').length,
      tools: status.toolCount,
      adoption: status.adoption.basis
    },
    generatedAt: new Date().toISOString()
  };
}

export interface HomeTriggerProps extends HomeLoaderData {}

export function HomeTrigger({ metrics, platform, generatedAt }: HomeTriggerProps) {
  const preview = [metrics.inventory, metrics.files, metrics.feed, metrics.jobEvents, metrics.inventory + 2];

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl md:p-10">
        <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div className="animate-fade-up">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                ● runtime online
              </span>
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-mono text-[10px] text-cyan-300">
                v{platform.version}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1 font-mono text-[10px] text-slate-400">
                {platform.tools} MCP tools
              </span>
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight text-white md:text-6xl">
              Um sistema inteiro,
              <span className="block bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 bg-clip-text text-transparent">
                em fatias vivas.
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
              Este app roda o SynapseJS de ponta a ponta: CRUD, upload/download, streaming HTTP, SSE, WebSocket, jobs em
              background, cache SSR, RBAC, webhooks assinados e rotas dinâmicas — cada feature em um único{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-cyan-300">*.slice.tsx</code>.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/showcase/files">
                <Button variant="primary">📎 Central de arquivos</Button>
              </a>
              <a href="/showcase/realtime">
                <Button variant="secondary">⚡ Tempo real</Button>
              </a>
              <a href="/showcase/platform">
                <Button variant="secondary">🧭 Catálogo de features</Button>
              </a>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-500">
              <span>● {platform.stable} capacidades stable</span>
              <span>● {platform.experimental} experimental</span>
              <span>● {platform.roadmap} roadmap</span>
              <span className="font-mono">render {generatedAt.slice(11, 19)} UTC</span>
            </div>
          </div>

          <div
            className="animate-fade-up rounded-2xl border border-slate-800 bg-slate-950/60 p-5"
            style={{ animationDelay: '120ms' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Pulso do sistema</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-black text-white">{metrics.inventory}</span>
                  <span className="text-[11px] text-slate-400">itens no catálogo</span>
                </div>
              </div>
              <Badge variant={metrics.databaseOk ? 'success' : 'danger'}>
                {metrics.databaseOk ? 'DB OK' : 'DB OFF'}
              </Badge>
            </div>
            <Sparkline values={preview} />
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
              <div>
                <div className="font-mono text-sm font-bold text-cyan-300">{metrics.files}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">arquivos</div>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-emerald-300">{metrics.feed}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">eventos</div>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-violet-300">{metrics.jobEvents}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">jobs</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Inventário"
          value={metrics.inventory}
          hint={`R$ ${metrics.inventoryValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em estoque`}
          icon="📦"
          tone="cyan"
        />
        <StatCard
          label="Arquivos"
          value={metrics.files}
          hint="uploads com download autenticado"
          icon="📎"
          tone="emerald"
          delay={60}
        />
        <StatCard
          label="Eventos em tempo real"
          value={metrics.feed}
          hint="SSE + WebSocket no mesmo processo"
          icon="⚡"
          tone="violet"
          delay={120}
        />
        <StatCard
          label="Alertas de estoque"
          value={metrics.lowStock}
          hint={metrics.lowStock > 0 ? 'reposição recomendada' : 'nenhum alerta crítico'}
          icon="⚠️"
          tone={metrics.lowStock > 0 ? 'amber' : 'emerald'}
          delay={180}
        />
      </div>

      <section>
        <PageHeader
          eyebrow="Explore o runtime"
          title="Demos que exercitam o framework de verdade"
          description="Cada cartão abre uma rota que usa a API real — sem mock de resultado no caminho de produção."
        />
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FeatureCard
            href="/inventory/list-items"
            icon="📦"
            title="CRUD + Query Builder"
            description="Listagem paginada, filtros, validação TypeBox, update parcial com allowlist e RBAC."
            tag="SQLite"
          />
          <FeatureCard
            href="/showcase/files"
            icon="📎"
            title="Upload & download"
            description="useUpload com progresso/abort, storage local, metadados no banco e rota de download autenticada."
            tag="multipart"
          />
          <FeatureCard
            href="/showcase/realtime"
            icon="⚡"
            title="SSE + WebSocket"
            description="Tópico declarado, broadcast no action context e canal bidirecional com defineSocket."
            tag="duplex"
          />
          <FeatureCard
            href="/showcase/jobs"
            icon="⚙️"
            title="Fila & worker"
            description="defineJob, enqueue, retry, cron e painel de status lendo o SQLite da fila."
            tag="background"
          />
          <FeatureCard
            href="/showcase/cache"
            icon="🧊"
            title="Cache SSR / ISR"
            description="defineCache com TTL, stale-while-revalidate e invalidação de tags pelo action context."
            tag="ISR"
          />
          <FeatureCard
            href="/showcase/stream"
            icon="🌊"
            title="Streaming HTTP"
            description="ctx.stream() entregando tokens em chunks reais, consumidos com ReadableStream no browser."
            tag="chunked"
          />
          <FeatureCard
            href="/showcase/webhooks"
            icon="🔐"
            title="Webhooks assinados"
            description="HMAC-SHA256, rawBody preservado, evento persistido e replay exibido no painel."
            tag="HMAC"
          />
          <FeatureCard
            href="/showcase/profile/demo-42"
            icon="🪪"
            title="Rotas dinâmicas"
            description="Loader e componente lendo params de /:domain/:name/:id, com hidratação isomórfica."
            tag="params"
          />
          <FeatureCard
            href="/showcase/platform"
            icon="🧭"
            title="Catálogo completo"
            description={`${platform.stable} features stable, ${platform.experimental} experimentais, ${platform.roadmap} roadmap e ${platform.tools} ferramentas MCP.`}
            tag="inventário"
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Checklist de um sistema completo</h2>
            <span className="font-mono text-[10px] text-slate-500">runtime v{platform.version}</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ['Frontend SSR + hidratação', '✓'],
              ['Design responsivo + animações', '✓'],
              ['CRUD e validação de contrato', '✓'],
              ['Upload, download e storage', '✓'],
              ['SSE e WebSocket', '✓'],
              ['Jobs, cron e retry', '✓'],
              ['Cache SSR e invalidação', '✓'],
              ['Auth assinada e RBAC', '✓'],
              ['Webhooks com HMAC', '✓'],
              ['Streaming HTTP', '✓'],
              ['Rotas dinâmicas', '✓'],
              ['Catálogo de features/MCP', '✓']
            ].map(([label, check]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-300"
              >
                <span>{label}</span>
                <span className="text-emerald-400">{check}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-violet-950/20 p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Transparência</div>
          <h2 className="mt-2 text-sm font-bold text-white">O que é real e o que é configuração</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Upload, download, SSE, WebSocket, jobs, cache, auth, webhook e streaming executam neste processo. OAuth
            social, S3/Postgres e e-mail exigem credenciais/provedores externos e aparecem no catálogo com status e
            evidência — não fingimos integrações que não estão configuradas.
          </p>
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 font-mono text-[10px] leading-relaxed text-slate-500">
            {platform.adoption}
          </div>
          <a
            href="/showcase/platform"
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-violet-300 hover:text-violet-200"
          >
            Ver catálogo completo <span>→</span>
          </a>
        </div>
      </section>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Synapse Showcase | Sistema completo em fatias',
    description: 'Showcase fullstack com CRUD, uploads, SSE, WebSocket, jobs, cache, RBAC, webhooks e streaming.'
  };
}

export const sliceTests = {
  description: 'Invariantes do showcase home',
  cases: [
    {
      name: 'getHomeCounts devolve zeros para um banco sem tabelas',
      run: async () => {
        const counts = await getHomeCounts(new MockDatabaseClient());
        if (counts.inventory !== 0 || counts.files !== 0) throw new Error('esperava contadores zerados');
      }
    },
    {
      name: 'projectStatus expõe o inventário e as ferramentas MCP',
      run: async () => {
        const status = projectStatus();
        if (status.features.length < 60 || status.toolCount !== 23) {
          throw new Error('inventário de features/MCP inesperado');
        }
      }
    }
  ]
};
