import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useCallback, useEffect, useState } from 'react';
import {
  type ActionContext,
  type DatabaseClient,
  defineJob,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';
import { Icon } from '../../shared/icons';
import { getJobStats, type JobStats } from '../../shared/showcase';
import { formatDate, PageHeader, StatCard } from '../../shared/ui';

export const JobsInputSchema = Type.Object(
  {
    operation: Type.Union([Type.Literal('enqueue'), Type.Literal('stats')]),
    fail: Type.Optional(Type.Boolean())
  },
  { additionalProperties: true }
);
export type JobsInput = Static<typeof JobsInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS showcase_job_events (
    id TEXT PRIMARY KEY,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export interface JobEventRow {
  id: string;
  job_name: string;
  status: string;
  message: string | null;
  created_at: string;
}

export type JobsOutput = Result<
  { stats: JobStats; events: JobEventRow[]; jobId?: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'QUEUE_FAILED'
>;

export const showcaseDemoJob = defineJob<{ requestedBy: string; fail?: boolean }>({
  name: 'showcase-demo-job',
  retryLimit: 2,
  backoffSeconds: 1,
  handler: async (payload, ctx) => {
    if (payload.fail) {
      throw new Error('Falha proposital: demonstra retry e failed.');
    }
    await ctx.insert('showcase_job_events', {
      id: crypto.randomUUID(),
      job_name: 'showcase-demo-job',
      status: 'COMPLETED',
      message: `Processado para ${payload.requestedBy}`
    });
  }
});

export const showcaseHeartbeatJob = defineJob<{ at: string }>({
  name: 'showcase-heartbeat',
  cron: '*/1 * * * *',
  retryLimit: 1,
  backoffSeconds: 1,
  cronPayload: () => ({ at: new Date().toISOString() }),
  handler: async (payload, ctx) => {
    await ctx.insert('showcase_job_events', {
      id: crypto.randomUUID(),
      job_name: 'showcase-heartbeat',
      status: 'COMPLETED',
      message: `Heartbeat cron em ${payload.at}`
    });
  }
});

async function readEvents(db: DatabaseClient): Promise<JobEventRow[]> {
  try {
    return await db.query<JobEventRow>('SELECT * FROM showcase_job_events ORDER BY created_at DESC LIMIT 12');
  } catch {
    return [];
  }
}

export async function jobsAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext,
  ctx?: ActionContext
): Promise<JobsOutput> {
  if (!db) return Err('NO_DATABASE');
  if (!Value.Check(JobsInputSchema, payload)) return Err('INVALID_SCHEMA');

  const input = payload as JobsInput;
  const stats = getJobStats();

  if (input.operation === 'stats') {
    return Ok({ stats, events: await readEvents(db) });
  }

  if (!ctx?.enqueue) return Err('QUEUE_FAILED');

  try {
    const jobId = await ctx.enqueue(showcaseDemoJob, {
      requestedBy: session?.userId ?? 'anon',
      fail: Boolean(input.fail)
    });
    return Ok({ jobId, stats: getJobStats(), events: await readEvents(db) });
  } catch {
    return Err('QUEUE_FAILED');
  }
}

export interface JobsLoaderData {
  stats: JobStats;
  events: JobEventRow[];
}

export async function JobsLoader(context: SliceLoaderContext): Promise<JobsLoaderData> {
  return {
    stats: getJobStats(),
    events: await readEvents(context.db)
  };
}

export interface JobsTriggerProps extends JobsLoaderData {
  onSubmitAction?: (payload: unknown) => Promise<JobsOutput>;
}

export function JobsTrigger({ stats: initialStats, events: initialEvents = [], onSubmitAction }: JobsTriggerProps) {
  const [stats, setStats] = useState<JobStats>(initialStats);
  const [events, setEvents] = useState<JobEventRow[]>(initialEvents);
  const [message, setMessage] = useState<string | null>(null);
  const [fail, setFail] = useState(false);

  const refresh = useCallback(async () => {
    if (!onSubmitAction) return;
    const result = await onSubmitAction({ operation: 'stats' });
    if (result.ok) {
      setStats(result.value.stats);
      setEvents(result.value.events);
    }
  }, [onSubmitAction]);

  useEffect(() => {
    if (!onSubmitAction) return;
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [onSubmitAction, refresh]);

  const enqueue = async () => {
    if (!onSubmitAction) return;
    const result = await onSubmitAction({ operation: 'enqueue', fail });
    if (result.ok) {
      setStats(result.value.stats);
      setEvents(result.value.events);
      setMessage(`Job ${result.value.jobId ?? ''} enfileirado${fail ? ' (falha proposital).' : '.'}`);
    } else {
      setMessage(`Falha ao enfileirar: ${result.error}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Background jobs"
        title="Fila, cron e retry"
        description="O action enfileira via ctx.enqueue; o worker CLI processa o SQLite isolado. O painel lê o estado real da fila e os eventos gravados pelo handler. A DLQ é do engine PostgreSQL; no SQLite o job esgotado fica como failed."
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
          >
            Atualizar agora
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Pendentes"
          value={stats.pending}
          icon={<Icon name="clock" className="h-4 w-4" />}
          tone="amber"
        />
        <StatCard
          label="Em execução"
          value={stats.running}
          icon={<Icon name="jobs" className="h-4 w-4" />}
          tone="cyan"
          delay={40}
        />
        <StatCard
          label="Concluídos"
          value={stats.completed}
          icon={<Icon name="check" className="h-4 w-4" />}
          tone="emerald"
          delay={80}
        />
        <StatCard
          label="Falharam"
          value={stats.failed}
          icon={<Icon name="zap" className="h-4 w-4" />}
          tone="rose"
          delay={120}
        />
        <StatCard
          label="DLQ (Postgres)"
          value={stats.deadLetter}
          hint="SQLite usa failed"
          icon={<Icon name="layers" className="h-4 w-4" />}
          tone="violet"
          delay={160}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-bold text-white">Enfileirar trabalho</h2>
          <p className="mt-1 text-xs text-slate-400">
            O handler grava em <code className="text-cyan-300">showcase_job_events</code>; a falha proposital exercita
            retry e o estado failed.
          </p>
          <label className="mt-4 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={fail}
              onChange={(event) => setFail(event.target.checked)}
              className="h-4 w-4 accent-rose-500"
            />
            Simular falha (retryLimit 2)
          </label>
          <button
            type="button"
            onClick={() => void enqueue()}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
          >
            Enfileirar job de demonstração
          </button>
          {message ? <div className="mt-3 font-mono text-[10px] text-slate-400">{message}</div> : null}

          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-3 font-mono text-[10px] leading-relaxed text-slate-500">
            worker: <span className="text-cyan-300">bun run worker</span>
            <br />
            cron: <span className="text-cyan-300">showcase-heartbeat */1 * * * *</span>
            <br />
            queue: <span className="text-cyan-300">.synapse/queue.sqlite</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Eventos dos handlers</h2>
            <span className="font-mono text-[10px] text-slate-500">atualização 4s</span>
          </div>
          <div className="mt-3 space-y-2">
            {events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-xs text-slate-500">
                Nenhum evento ainda. Enfileire um job e mantenha <code>bun run worker</code> ativo.
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="animate-slide-in flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-200">
                      {event.message ?? event.job_name}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{event.job_name}</div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
                        event.status === 'COMPLETED'
                          ? 'border-emerald-400/30 text-emerald-300'
                          : 'border-rose-400/30 text-rose-300'
                      }`}
                    >
                      {event.status}
                    </span>
                    <div className="mt-1 font-mono text-[9px] text-slate-600">{formatDate(event.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
        <h2 className="text-sm font-bold text-white">Últimos jobs na fila</h2>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[1.3fr_0.7fr_0.5fr_1.5fr] border-b border-slate-800 px-2 py-2 font-mono text-[9px] uppercase tracking-wider text-slate-500">
              <span>Job</span>
              <span>Status</span>
              <span>Tentativas</span>
              <span>Erro</span>
            </div>
            {stats.recent.map((job) => (
              <div
                key={job.id}
                className="grid grid-cols-[1.3fr_0.7fr_0.5fr_1.5fr] items-center border-b border-slate-900/80 px-2 py-2.5 text-slate-300"
              >
                <span className="truncate font-mono text-[10px]">{job.name}</span>
                <span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px]">{job.status}</span>
                </span>
                <span className="font-mono text-[10px]">{job.attempts}</span>
                <span className="truncate font-mono text-[9px] text-rose-300">{job.last_error ?? '—'}</span>
              </div>
            ))}
            {stats.recent.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-slate-500">A fila está vazia.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Jobs | Synapse Showcase',
    description: 'Fila SQLite, worker, cron e retry no SynapseJS; DLQ é do engine Postgres.'
  };
}

export const sliceTests = {
  description: 'Invariantes da fila de jobs',
  cases: [
    {
      name: 'enqueue sem action context retorna QUEUE_FAILED',
      run: async () => {
        const result = await jobsAction({ operation: 'enqueue' }, new MockDatabaseClient());
        if (result.ok || result.error !== 'QUEUE_FAILED') throw new Error('esperava QUEUE_FAILED');
      }
    },
    {
      name: 'o handler do job grava o evento de conclusão',
      run: async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const fakeCtx = {
          insert: async (_table: string, data: Record<string, unknown>) => {
            inserted.push(data);
            return data;
          }
        } as unknown as ActionContext;
        await showcaseDemoJob.handler?.({ requestedBy: 'oracle' }, fakeCtx);
        if (inserted.length !== 1 || inserted[0].status !== 'COMPLETED') {
          throw new Error('esperava um evento COMPLETED');
        }
      }
    }
  ]
};
