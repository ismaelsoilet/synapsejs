import { useMemo, useState } from 'react';
import { projectStatus } from 'synapsejs';
import { Badge } from 'synapsejs/client';
import { PageHeader, StatCard } from '../../shared/ui';

export type FeatureStatusRow = {
  feature: string;
  status: 'stable' | 'experimental' | 'roadmap';
  evidence: string;
};

export interface PlatformLoaderData {
  version: string;
  runtime: string;
  database: string;
  protocols: string[];
  toolCount: number;
  tools: string[];
  features: FeatureStatusRow[];
  commands: string[];
  adoption: string;
}

export function PlatformLoader(): PlatformLoaderData {
  const status = projectStatus();
  return {
    version: status.version,
    runtime: status.runtime,
    database: status.database,
    protocols: status.protocols,
    toolCount: status.toolCount,
    tools: status.tools,
    features: status.features.map(({ feature, status: featureStatus, evidence }) => ({
      feature,
      status: featureStatus,
      evidence
    })),
    commands: status.commands,
    adoption: status.adoption.basis
  };
}

const STATUS_LABEL: Record<FeatureStatusRow['status'], string> = {
  stable: 'stable',
  experimental: 'experimental',
  roadmap: 'roadmap'
};

const STATUS_CLASS: Record<FeatureStatusRow['status'], string> = {
  stable: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  experimental: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  roadmap: 'border-slate-600 bg-slate-800 text-slate-400'
};

export function PlatformTrigger({
  version,
  runtime,
  database,
  protocols,
  toolCount,
  tools,
  features,
  commands,
  adoption
}: PlatformLoaderData) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | FeatureStatusRow['status']>('all');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return features.filter((feature) => {
      if (status !== 'all' && feature.status !== status) return false;
      if (!term) return true;
      return (
        feature.feature.toLowerCase().includes(term) ||
        feature.evidence.toLowerCase().includes(term) ||
        feature.status.includes(term)
      );
    });
  }, [features, query, status]);

  const counts = useMemo(
    () => ({
      stable: features.filter((feature) => feature.status === 'stable').length,
      experimental: features.filter((feature) => feature.status === 'experimental').length,
      roadmap: features.filter((feature) => feature.status === 'roadmap').length
    }),
    [features]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventário do runtime"
        title="Tudo que o SynapseJS expõe"
        description="A tabela de features é a fonte única do projeto: versão, maturidade, evidência de teste, ferramentas MCP e comandos. Nada aqui é uma lista de marketing separada do código."
        actions={
          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            <a
              href="/_synapse/api/health"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:border-cyan-400/40 hover:text-cyan-300"
            >
              health JSON
            </a>
            <a
              href="/_synapse/api/repo-map"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:border-cyan-400/40 hover:text-cyan-300"
            >
              repo-map
            </a>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Versão" value={version} hint="manifest" icon="🏷️" tone="cyan" />
        <StatCard label="Stable" value={counts.stable} hint="com teste que falha" icon="✅" tone="emerald" delay={40} />
        <StatCard
          label="Experimental"
          value={counts.experimental}
          hint="evidência limitada"
          icon="🧪"
          tone="amber"
          delay={80}
        />
        <StatCard label="Roadmap" value={counts.roadmap} hint="não shipped" icon="🗺️" tone="violet" delay={120} />
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-3">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">runtime</div>
          <div className="mt-1 text-xs text-slate-300">{runtime}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">database</div>
          <div className="mt-1 text-xs text-slate-300">{database}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">protocols</div>
          <div className="mt-1 text-xs text-slate-300">{protocols.join(' · ')}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Features ({filtered.length})</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Filtre por nome, evidência ou maturidade.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar feature…"
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
            />
            {(['all', 'stable', 'experimental', 'roadmap'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-lg border px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider transition ${
                  status === value
                    ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {filtered.map((feature) => (
            <details
              key={feature.feature}
              className="group rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 transition open:border-slate-700"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="text-xs text-slate-200">{feature.feature}</span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider ${STATUS_CLASS[feature.status]}`}
                >
                  {STATUS_LABEL[feature.status]}
                </span>
              </summary>
              <div className="mt-2 border-t border-slate-800 pt-2 font-mono text-[10px] leading-relaxed text-slate-500">
                evidência: <span className="text-slate-400">{feature.evidence}</span>
              </div>
            </details>
          ))}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-xs text-slate-500">
              Nenhuma feature bate com o filtro.
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">MCP tools ({toolCount})</h2>
            <Badge variant="success">stdio JSON-RPC</Badge>
          </div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {tools.map((tool) => (
              <div
                key={tool}
                className="rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 font-mono text-[10px] text-cyan-200/80"
              >
                {tool}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 font-mono text-[10px] leading-relaxed text-slate-500">
            bun run mcp
            <br />
            bunx synapsejs contract
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-bold text-white">Comandos & transparência</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {commands.map((command) => (
              <span
                key={command}
                className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1 font-mono text-[10px] text-slate-400"
              >
                {command}
              </span>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-100/80">
            {adoption}
          </div>
          <div className="mt-4 text-[10px] leading-relaxed text-slate-500">
            Features com provedor externo aparecem como parte do contrato, mas só executam quando o serviço
            correspondente está configurado. O showcase não inventa uma integração que não existe.
          </div>
        </div>
      </div>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Plataforma | Synapse Showcase',
    description: 'Inventário completo de features, ferramentas MCP e comandos do SynapseJS.'
  };
}

export const sliceTests = {
  description: 'Invariantes do catálogo',
  cases: [
    {
      name: 'o catálogo lê a fonte única e expõe 23 ferramentas',
      run: async () => {
        const data = PlatformLoader();
        if (data.toolCount !== 23 || data.tools.length !== 23) throw new Error('esperava 23 ferramentas MCP');
        if (data.features.length < 60) throw new Error('esperava o inventário completo');
      }
    }
  ]
};
