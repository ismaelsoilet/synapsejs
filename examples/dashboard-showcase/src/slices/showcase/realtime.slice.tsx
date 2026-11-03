import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useEffect, useRef, useState } from 'react';
import {
  type ActionContext,
  type DatabaseClient,
  defineSocket,
  defineTopic,
  Err,
  getEventHub,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext,
  type SynapseWebSocket
} from 'synapsejs';
import { useSubscription, useWebSocket } from 'synapsejs/client';
import { FeatureGuide, PageHeader } from '../../shared/ui';

export const RealtimeInputSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 500 })
  },
  { additionalProperties: true }
);
export type RealtimeInput = Static<typeof RealtimeInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS showcase_feed (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sse',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export const feedTopic = defineTopic({
  name: 'showcase/feed',
  owner: 'showcase/realtime',
  public: true
});

export interface FeedMessage {
  id: string;
  text: string;
  author: string;
  kind: 'sse' | 'ws' | 'system';
  createdAt: string;
}

export type RealtimeOutput = Result<
  { id: string; notified: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'BROADCAST_FAILED'
>;

export async function realtimeAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext,
  ctx?: ActionContext
): Promise<RealtimeOutput> {
  if (!db) return Err('NO_DATABASE');
  if (!Value.Check(RealtimeInputSchema, payload)) return Err('INVALID_SCHEMA');

  const input = payload as RealtimeInput;
  const id = crypto.randomUUID();
  const message: FeedMessage = {
    id,
    text: input.text,
    author: session?.userId ?? 'anon',
    kind: 'sse',
    createdAt: new Date().toISOString()
  };

  await db.insert('showcase_feed', {
    id: message.id,
    text: message.text,
    author: message.author,
    kind: message.kind
  });

  const notified = ctx?.broadcast('showcase/feed', message) ?? 0;
  return Ok({ id, notified });
}

export interface RealtimeLoaderData {
  messages: FeedMessage[];
  isAuthenticated: boolean;
}

export async function RealtimeLoader(context: SliceLoaderContext): Promise<RealtimeLoaderData> {
  try {
    const rows = await context.db.query<{
      id: string;
      text: string;
      author: string;
      kind: FeedMessage['kind'];
      created_at: string;
    }>(
      `SELECT * FROM (
         SELECT id, text, author, kind, created_at FROM showcase_feed ORDER BY created_at DESC LIMIT 30
       ) ORDER BY created_at ASC`
    );
    return {
      messages: rows.map((row) => ({
        id: row.id,
        text: row.text,
        author: row.author,
        kind: row.kind,
        createdAt: row.created_at
      })),
      isAuthenticated: context.session.isAuthenticated
    };
  } catch {
    return { messages: [], isAuthenticated: context.session.isAuthenticated };
  }
}

export interface InboundSocketMessage {
  type: 'CHAT';
  text: string;
}

export interface OutboundSocketMessage {
  type: 'CHAT' | 'SYSTEM';
  id?: string;
  text: string;
  author?: string;
  createdAt?: string;
}

const socketClients = new Set<SynapseWebSocket<OutboundSocketMessage>>();

export const sliceSocket = defineSocket<InboundSocketMessage, OutboundSocketMessage>({
  onOpen(ws) {
    socketClients.add(ws);
    ws.send({ type: 'SYSTEM', text: 'Conectado ao canal WebSocket do SynapseJS.' });
  },
  onMessage(ws, message) {
    if (message?.type !== 'CHAT' || typeof message.text !== 'string' || message.text.trim().length === 0) return;
    const event: FeedMessage = {
      id: crypto.randomUUID(),
      text: message.text.slice(0, 500),
      author: String(ws.data.userId ?? 'ws-user'),
      kind: 'ws',
      createdAt: new Date().toISOString()
    };

    for (const client of socketClients) {
      client.send({
        type: 'CHAT',
        id: event.id,
        text: event.text,
        author: event.author,
        createdAt: event.createdAt
      });
    }
    getEventHub().publish('global:showcase/feed', event);
  },
  onClose(ws) {
    socketClients.delete(ws);
  }
});

export interface RealtimeTriggerProps extends RealtimeLoaderData {
  onSubmitAction?: (payload: unknown) => Promise<RealtimeOutput>;
}

function mergeMessage(current: FeedMessage[], incoming: FeedMessage): FeedMessage[] {
  if (current.some((item) => item.id === incoming.id)) return current;
  return [...current, incoming].slice(-60);
}

export function RealtimeTrigger({ messages = [], isAuthenticated = false, onSubmitAction }: RealtimeTriggerProps) {
  const [feed, setFeed] = useState<FeedMessage[]>(messages);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useSubscription<FeedMessage>('showcase/feed', (message) => {
    setFeed((current) => mergeMessage(current, message));
  });

  const socket = useWebSocket<OutboundSocketMessage, InboundSocketMessage>('showcase/realtime', {
    onMessage: (message) => {
      if (message.type !== 'CHAT' || !message.id || !message.text) return;
      setFeed((current) =>
        mergeMessage(current, {
          id: message.id as string,
          text: message.text,
          author: message.author ?? 'ws-user',
          kind: 'ws',
          createdAt: message.createdAt ?? new Date().toISOString()
        })
      );
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the feed grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [feed.length]);

  const publish = async () => {
    const value = text.trim();
    if (!value) return;
    if (!onSubmitAction) {
      setStatus('A ação do slice não está conectada.');
      return;
    }

    const result = await onSubmitAction({ text: value });
    if (!result.ok) {
      setStatus(`Falha ao publicar: ${result.error}`);
      return;
    }
    setText('');
    setStatus(`Publicado via SSE para ${result.value.notified} inscrito(s).`);
  };

  const sendSocket = () => {
    const value = text.trim();
    if (!value) return;
    socket.send({ type: 'CHAT', text: value });
    setText('');
    setStatus('Mensagem enviada pelo WebSocket.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Realtime"
        title="SSE + WebSocket no mesmo runtime"
        description="O tópico é declarado com defineTopic; o action context publica via ctx.broadcast. O WebSocket é um canal bidirecional definido pelo mesmo slice."
        actions={
          <div className="flex gap-2 text-[10px] font-mono">
            <span
              className={`rounded-full border px-2.5 py-1 ${
                socket.isConnected
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 text-slate-500'
              }`}
            >
              WS {socket.isConnected ? 'connected' : 'offline'}
            </span>
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-cyan-300">
              SSE /showcase/feed
            </span>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Feed ao vivo</h2>
            <span className="font-mono text-[10px] text-slate-500">{feed.length} eventos</span>
          </div>
          <div className="mt-3 h-80 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            {feed.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Nenhum evento ainda. Envie a primeira mensagem.
              </div>
            ) : (
              feed.map((message) => (
                <div
                  key={message.id}
                  className={`animate-slide-in rounded-xl border px-3 py-2 ${
                    message.kind === 'ws' ? 'border-violet-400/20 bg-violet-400/5' : 'border-cyan-400/20 bg-cyan-400/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-slate-500">
                    <span>
                      {message.kind === 'ws' ? 'WebSocket' : 'SSE'} · {message.author}
                    </span>
                    <span>{message.createdAt.slice(11, 19)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-200">{message.text}</div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void publish();
                }
              }}
              placeholder="Escreva uma mensagem para o feed…"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={() => void publish()}
              className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-400"
            >
              SSE
            </button>
            <button
              type="button"
              onClick={sendSocket}
              className="rounded-xl border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-200 transition hover:bg-violet-400/20"
            >
              WS
            </button>
          </div>
          {status ? <div className="mt-2 font-mono text-[10px] text-slate-500">{status}</div> : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-bold text-white">Como funciona</h2>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-400">
              <p>
                <span className="font-mono text-cyan-300">
                  defineTopic({'{{'} name, owner, public {'}}'})
                </span>{' '}
                registra o tópico. O gateway SSE recusa um nome não declarado.
              </p>
              <p>
                <span className="font-mono text-violet-300">ctx.broadcast()</span> publica no hub; o mesmo action
                context expõe <span className="font-mono">stream()</span>, <span className="font-mono">enqueue()</span>{' '}
                e <span className="font-mono">invalidateCache()</span>.
              </p>
              <p>
                <span className="font-mono text-cyan-300">defineSocket()</span> monta o canal duplex em{' '}
                <span className="font-mono">/_synapse/ws/showcase/realtime</span>; o hook{' '}
                <span className="font-mono">useWebSocket()</span> cuida do reconnect.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-cyan-950/20 p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Sessão</div>
            <p className="mt-2 text-xs text-slate-400">
              {isAuthenticated
                ? 'Você está autenticado; o autor das mensagens SSE usa o userId da sessão assinada.'
                : 'O feed é público para a demonstração; faça login para gravar o userId real como autor.'}
            </p>
            {!isAuthenticated ? (
              <a
                href="/auth/login?redirectTo=/showcase/realtime"
                className="mt-3 inline-flex rounded-lg border border-cyan-400/30 px-2.5 py-1.5 text-[10px] font-bold text-cyan-300"
              >
                Entrar na demo
              </a>
            ) : null}
          </div>
        </div>
      </div>
      <FeatureGuide
        title="SSE e WebSocket: quando usar"
        icon="realtime"
        defaultOpen
        what="SSE entrega eventos do servidor para o browser em uma direção; WebSocket abre um canal bidirecional para conversas, presença e colaboração."
        useCases={[
          'Chat, suporte e colaboração em tempo real',
          'Presença, “digitando…” e cursores compartilhados',
          'Feeds e notificações unidirecionais com SSE',
          'Painéis de métricas, filas e jobs ao vivo'
        ]}
        steps={[
          'defineTopic declara nome, dono e quem pode ler o tópico.',
          'ctx.broadcast publica no hub; o gateway SSE entrega aos inscritos.',
          'defineSocket registra /_synapse/ws/showcase/realtime; useWebSocket conecta e envia.',
          'O feed persiste no SQLite e reaparece no próximo SSR.'
        ]}
        observe="Abra esta página em duas abas, envie pelo SSE e depois pelo WS. Compare o status da conexão, o autor e o selo SSE/WebSocket de cada mensagem."
      />
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Realtime | Synapse Showcase',
    description: 'SSE declarado e WebSocket bidirecional com o runtime SynapseJS.'
  };
}

export const sliceTests = {
  description: 'Invariantes de realtime',
  cases: [
    {
      name: 'sem banco a publicação retorna NO_DATABASE',
      run: async () => {
        const result = await realtimeAction({ text: 'oi' });
        if (result.ok || result.error !== 'NO_DATABASE') throw new Error('esperava NO_DATABASE');
      }
    },
    {
      name: 'publica no tópico e registra a mensagem',
      run: async () => {
        const db = new MockDatabaseClient();
        const messages: unknown[] = [];
        const result = await realtimeAction(
          { text: 'olá tempo real' },
          db,
          { isAuthenticated: true, roles: ['user'], userId: 'u1' },
          {
            broadcast: (topic: string, data: unknown) => {
              messages.push({ topic, data });
              return 1;
            }
          } as unknown as ActionContext
        );
        if (!result.ok || result.value.notified !== 1 || messages.length !== 1) {
          throw new Error('esperava Ok com um inscrito notificado');
        }
      }
    }
  ]
};
