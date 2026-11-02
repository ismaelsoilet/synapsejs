import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useState } from 'react';
import {
  type ActionContext,
  type DatabaseClient,
  defineCache,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';
import { Icon } from '../../shared/icons';
import { PageHeader, StatCard } from '../../shared/ui';

export const CacheInputSchema = Type.Object(
  {
    operation: Type.Literal('invalidate')
  },
  { additionalProperties: true }
);
export type CacheInput = Static<typeof CacheInputSchema>;

export const sliceCache = defineCache({
  ttlSeconds: 4,
  staleWhileRevalidateSeconds: 12,
  tags: ['showcase-cache']
});

export type CacheOutput = Result<{ invalidated: boolean; at: string }, 'INVALID_SCHEMA' | 'CACHE_UNAVAILABLE'>;

export async function cacheAction(
  payload: unknown,
  _db?: DatabaseClient,
  _session?: SessionContext,
  ctx?: ActionContext
): Promise<CacheOutput> {
  if (!Value.Check(CacheInputSchema, payload)) return Err('INVALID_SCHEMA');
  if (!ctx?.invalidateCache) return Err('CACHE_UNAVAILABLE');
  ctx.invalidateCache(['showcase-cache']);
  return Ok({ invalidated: true, at: new Date().toISOString() });
}

export interface CacheLoaderData {
  generatedAt: string;
  nonce: string;
  ttlSeconds: number;
  staleWhileRevalidateSeconds: number;
  tag: string;
}

export function CacheLoader(_context: SliceLoaderContext): CacheLoaderData {
  return {
    generatedAt: new Date().toISOString(),
    nonce: Math.random().toString(36).slice(2, 10),
    ttlSeconds: 4,
    staleWhileRevalidateSeconds: 12,
    tag: 'showcase-cache'
  };
}

export interface CacheTriggerProps extends CacheLoaderData {
  onSubmitAction?: (payload: unknown) => Promise<CacheOutput>;
}

export function CacheTrigger({
  generatedAt,
  nonce,
  ttlSeconds,
  staleWhileRevalidateSeconds,
  tag,
  onSubmitAction
}: CacheTriggerProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = async () => {
    if (!onSubmitAction || busy) return;
    setBusy(true);
    const result = await onSubmitAction({ operation: 'invalidate' });
    setBusy(false);
    if (result.ok) {
      setStatus('Cache invalidado por tag. Recarregando para executar o loader novamente…');
      setTimeout(() => {
        (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
      }, 450);
    } else {
      setStatus(`Falha ao invalidar: ${result.error}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="SSR cache & ISR"
        title="Cache com TTL, stale-while-revalidate e tag"
        description="O loader abaixo é cacheado pelo runtime e só executa de novo após o TTL ou após a invalidação explícita pelo action context."
        actions={
          <div className="flex gap-2">
            <a
              href={`/showcase/cache?nonce=${Date.now()}`}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
            >
              Forçar novo cache key
            </a>
            <button
              type="button"
              onClick={() => void invalidate()}
              disabled={busy}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Invalidando…' : 'Invalidar tag'}
            </button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="TTL"
          value={`${ttlSeconds}s`}
          hint="fresh window"
          icon={<Icon name="clock" className="h-4 w-4" />}
          tone="cyan"
        />
        <StatCard
          label="SWR"
          value={`${staleWhileRevalidateSeconds}s`}
          hint="stale enquanto revalida"
          icon={<Icon name="refresh" className="h-4 w-4" />}
          tone="emerald"
          delay={60}
        />
        <StatCard
          label="Tag"
          value={tag}
          hint="invalidação por grupo"
          icon={<Icon name="layers" className="h-4 w-4" />}
          tone="violet"
          delay={120}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Loader executado</h2>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-[9px] text-emerald-300">
              rendered
            </span>
          </div>
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4 font-mono text-xs leading-relaxed text-slate-300">
            <div>
              <span className="text-slate-500">generatedAt:</span> {generatedAt}
            </div>
            <div>
              <span className="text-slate-500">nonce:</span> <span className="text-cyan-300">{nonce}</span>
            </div>
            <div>
              <span className="text-slate-500">tag:</span> {tag}
            </div>
            <div>
              <span className="text-slate-500">strategy:</span> stale-while-revalidate
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-400">
            Recarregue a página dentro de {ttlSeconds}s: o <code className="text-cyan-300">nonce</code> e o{' '}
            <code className="text-cyan-300">generatedAt</code> permanecem iguais. Depois disso, o cache revalida. O
            botão acima chama <code className="text-cyan-300">ctx.invalidateCache([&apos;showcase-cache&apos;])</code> e
            força uma nova execução imediatamente.
          </p>
          {status ? <div className="mt-3 font-mono text-[10px] text-cyan-300">{status}</div> : null}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
          <h2 className="text-sm font-bold text-white">Onde o cache age</h2>
          <ul className="mt-4 space-y-3 text-xs leading-relaxed text-slate-400">
            <li>
              <span className="font-mono text-cyan-300">defineCache()</span> declara TTL, janela SWR, tags e params
              permitidos.
            </li>
            <li>O runtime normaliza a URL, remove parâmetros de tracking e usa um LRU limitado.</li>
            <li>
              <span className="font-mono text-cyan-300">ctx.invalidateCache()</span> remove todas as entradas com a tag
              declarada.
            </li>
            <li>O estado é por processo: reiniciar o servidor limpa o cache.</li>
          </ul>
          <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-200/80">
            Em múltiplas instâncias, cada processo tem seu próprio cache — não há backend compartilhado.
          </div>
        </div>
      </div>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Cache SSR | Synapse Showcase',
    description: 'Cache SSR com TTL, stale-while-revalidate e invalidação por tag.'
  };
}

export const sliceTests = {
  description: 'Invariantes do cache SSR',
  cases: [
    {
      name: 'invalidate sem action context retorna CACHE_UNAVAILABLE',
      run: async () => {
        const result = await cacheAction({ operation: 'invalidate' }, new MockDatabaseClient());
        if (result.ok || result.error !== 'CACHE_UNAVAILABLE') throw new Error('esperava CACHE_UNAVAILABLE');
      }
    },
    {
      name: 'invalidate chama o invalidador com a tag declarada',
      run: async () => {
        const tags: string[][] = [];
        const result = await cacheAction({ operation: 'invalidate' }, undefined, undefined, {
          invalidateCache: (value?: string[]) => tags.push(value ?? [])
        } as unknown as ActionContext);
        if (!result.ok || tags[0]?.[0] !== 'showcase-cache') throw new Error('esperava invalidateCache');
      }
    }
  ]
};
