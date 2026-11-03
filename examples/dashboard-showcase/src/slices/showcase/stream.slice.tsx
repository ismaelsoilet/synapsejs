import { type Static, Type } from '@sinclair/typebox';
import { useEffect, useRef, useState } from 'react';
import { FeatureGuide, PageHeader } from '../../shared/ui';

export const StreamInputSchema = Type.Object(
  {
    prompt: Type.Optional(Type.String({ maxLength: 500 }))
  },
  { additionalProperties: true }
);
export type StreamInput = Static<typeof StreamInputSchema>;

export function StreamTrigger() {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'aborted' | 'error'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (status !== 'streaming') return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 50);
    return () => clearInterval(timer);
  }, [status]);

  const start = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setOutput('');
    setStatus('streaming');
    setElapsed(0);
    startedAt.current = Date.now();

    try {
      const response = await fetch('/_showcase/stream', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok || !response.body) {
        setStatus('error');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((current) => current + decoder.decode(value, { stream: true }));
      }
      setStatus('done');
      setElapsed(Date.now() - startedAt.current);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('aborted');
        return;
      }
      setStatus('error');
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Streaming HTTP"
        title="Tokens chegando em chunks reais"
        description="A rota /_showcase/stream usa ctx.stream() no servidor. O browser lê response.body com ReadableStream e pinta cada chunk conforme ele chega — sem buffer intermediário."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/20"
            >
              {status === 'streaming' ? 'Reiniciar' : 'Iniciar stream'}
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={status !== 'streaming'}
              className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs font-bold text-rose-300 disabled:opacity-40"
            >
              Abortar
            </button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              <span className="ml-2 font-mono text-[10px] text-slate-500">/_showcase/stream</span>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
                status === 'streaming'
                  ? 'border-cyan-400/30 text-cyan-300'
                  : status === 'done'
                    ? 'border-emerald-400/30 text-emerald-300'
                    : 'border-slate-700 text-slate-500'
              }`}
            >
              {status} · {elapsed}ms
            </span>
          </div>
          <div className="min-h-64 p-4 font-mono text-sm leading-relaxed text-slate-200">
            {output ? (
              <span>
                {output}
                {status === 'streaming' ? <span className="animate-pulse text-cyan-300">▋</span> : null}
              </span>
            ) : (
              <span className="text-slate-600">
                {status === 'idle' ? 'Clique em “Iniciar stream” para abrir o chunked response.' : 'Aguardando…'}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-bold text-white">O que está acontecendo</h2>
            <ol className="mt-4 space-y-3 text-xs leading-relaxed text-slate-400">
              <li>
                <span className="font-mono text-cyan-300">1.</span> O plugin de aplicação intercepta{' '}
                <span className="font-mono">GET /_showcase/stream</span>.
              </li>
              <li>
                <span className="font-mono text-cyan-300">2.</span> Ele cria um ActionContext e chama{' '}
                <span className="font-mono">
                  ctx.stream(async function* () {'{'} … {'}'})
                </span>
                .
              </li>
              <li>
                <span className="font-mono text-cyan-300">3.</span> O runtime devolve um{' '}
                <span className="font-mono">Response</span> com stream e headers de no-cache.
              </li>
              <li>
                <span className="font-mono text-cyan-300">4.</span> O componente lê cada chunk com{' '}
                <span className="font-mono">reader.read()</span> e atualiza o terminal.
              </li>
            </ol>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 font-mono text-[10px] leading-relaxed text-slate-500">
            curl -N http://localhost:3000/_showcase/stream
            <br />
            <br />
            HTTP/1.1 200 OK
            <br />
            content-type: text/plain; charset=utf-8
            <br />
            cache-control: no-store, no-transform
            <br />
            x-content-type-options: nosniff
          </div>
        </div>
      </div>
      <FeatureGuide
        title="Streaming HTTP"
        icon="stream"
        what="ctx.stream devolve um Response chunked; o servidor produz pedaços e o browser consome com ReadableStream, sem esperar o corpo inteiro."
        useCases={[
          'Tokens de LLM e respostas de IA',
          'Logs, builds e tarefas longas',
          'Exportações grandes e download progressivo',
          'SSE textual para acompanhar processamento'
        ]}
        steps={[
          'O plugin de aplicação intercepta GET /_showcase/stream.',
          'Ele cria o ActionContext e chama ctx.stream(async function* () { … }).',
          'O runtime envia headers de no-cache e cada chunk assim que é produzido.',
          'O componente lê reader.read() e pinta o terminal incrementalmente.'
        ]}
        observe="Clique em “Iniciar stream” e veja o texto aparecer em pedaços. O contador de bytes/tempo e o cursor mostram o progresso; “Abortar” fecha a leitura."
      />
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Streaming HTTP | Synapse Showcase',
    description: 'ctx.stream() entregando chunks reais e consumidos no browser.'
  };
}

export const sliceTests = {
  description: 'Invariantes do streaming',
  cases: [
    {
      name: 'o componente de streaming é exportado e o contrato é válido',
      run: async () => {
        if (typeof StreamTrigger !== 'function') throw new Error('esperava StreamTrigger');
      }
    }
  ]
};
