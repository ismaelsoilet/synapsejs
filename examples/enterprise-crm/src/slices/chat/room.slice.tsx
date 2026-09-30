import { type Static, Type } from '@sinclair/typebox';
import {
  createActionContext,
  createSession,
  defineSocket,
  defineTopic,
  Err,
  getEventHub,
  MockDatabaseClient,
  Ok,
  type Result,
  requireAuth,
  type SessionContext,
  type SynapseWebSocket
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA
// ============================================================================
export const RoomInputSchema = Type.Object({
  room: Type.String({ minLength: 1 })
});
export type RoomInput = Static<typeof RoomInputSchema>;

// ============================================================================
// 2. CANAL BIDIRECIONAL NATIVO (defineSocket)
// ============================================================================
// ============================================================================
// 2. TÓPICO DECLARADO: o nome não é a permissão, a declaração é
// ============================================================================
export const roomTopic = defineTopic({
  name: 'chat/room',
  owner: 'chat/room',
  readRoles: ['support', 'sales']
});

export type AnnounceOutput = Result<{ notified: number }, 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_SCHEMA'>;

/**
 * Publica no tópico declarado. `ctx.broadcast` entrega ao hub escopado pelo tenant e
 * notifica zero inscritos quando quem publica não é o dono da declaração.
 */
export async function announceRoomAction(
  payload: unknown,
  _db?: unknown,
  session?: SessionContext,
  ctx?: { broadcast: (topic: string, data: unknown) => number }
): Promise<AnnounceOutput> {
  const auth = requireAuth(session, ['support', 'sales']);

  if (!auth.ok) {
    return Err(auth.error);
  }

  const text = (payload as { text?: unknown })?.text;

  if (typeof text !== 'string' || text.length === 0) {
    return Err('INVALID_SCHEMA');
  }

  const notified = ctx?.broadcast('chat/room', { type: 'MESSAGE', text }) ?? 0;

  return Ok({ notified });
}

interface RoomInbound {
  type: 'JOIN' | 'MESSAGE';
  room?: string;
  text?: string;
}

interface RoomOutbound {
  type: 'JOINED' | 'ECHO';
  room?: string;
  text?: string;
}

export const sliceSocket = defineSocket<RoomInbound, RoomOutbound>({
  onOpen(ws: SynapseWebSocket<RoomOutbound>) {
    ws.send({ type: 'JOINED', room: String(ws.data?.room ?? 'lobby') });
  },
  onMessage(ws: SynapseWebSocket<RoomOutbound>, message: RoomInbound) {
    if (message.type === 'JOIN') {
      ws.data = { ...ws.data, room: message.room ?? 'lobby' };
      ws.send({ type: 'JOINED', room: String(ws.data.room) });
      return;
    }

    ws.send({ type: 'ECHO', room: String(ws.data?.room ?? 'lobby'), text: message.text ?? '' });
  }
});

// ============================================================================
// 2.5. UI: a sala em tempo real pelo socket do slice
// ============================================================================
export interface RoomViewProps {
  room?: string;
}

export function RoomView({ room = 'lobby' }: RoomViewProps) {
  return (
    <section data-room={room}>
      <h3>Sala {room}</h3>
      <p>Mensagens chegam pelo canal WebSocket deste slice.</p>
    </section>
  );
}

// ============================================================================
// 3. ORÁCULO: exercita os handlers reais com um socket de teste
// ============================================================================
function fakeSocket() {
  const sent: RoomOutbound[] = [];

  const socket = {
    id: 'socket-1',
    sliceKey: 'chat/room',
    data: {} as Record<string, unknown>,
    send: (message: RoomOutbound | string) => {
      sent.push(typeof message === 'string' ? { type: 'ECHO', text: message } : message);
    },
    close: () => {}
  } as unknown as SynapseWebSocket<RoomOutbound>;

  return { socket, sent };
}

export const sliceTests = {
  description: 'Invariantes do canal de sala',
  cases: [
    {
      name: 'a ação publica no tópico declarado e notifica os inscritos',
      run: async () => {
        const hub = getEventHub();
        const received: unknown[] = [];
        const unsubscribe = hub.subscribe('global:chat/room', (data) => received.push(data));

        const session = createSession({ userId: 'u1', roles: ['support'] });
        const actionCtx = createActionContext({
          db: new MockDatabaseClient(),
          session,
          sliceOwner: 'chat/room'
        });

        const result = await announceRoomAction(
          { text: 'olá' },
          undefined,
          session,
          actionCtx as { broadcast: (topic: string, data: unknown) => number }
        );

        unsubscribe();

        if (!result.ok || result.value.notified !== 1 || received.length !== 1) {
          throw new Error(`esperava um inscrito notificado, obtive ${JSON.stringify({ result, received })}`);
        }
      }
    },
    {
      name: 'um papel fora da declaração é recusado antes de publicar',
      run: async () => {
        const result = await announceRoomAction(
          { text: 'olá' },
          undefined,
          createSession({ userId: 'u2', roles: ['guest'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(`esperava FORBIDDEN, obtive ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'o primeiro frame anuncia a sala padrão',
      run: async () => {
        const { socket, sent } = fakeSocket();

        await sliceSocket.onOpen?.(socket);

        if (sent.length !== 1 || sent[0].type !== 'JOINED' || sent[0].room !== 'lobby') {
          throw new Error(`esperava JOINED em lobby, obtive ${JSON.stringify(sent)}`);
        }
      }
    },
    {
      name: 'um JOIN move o socket de sala e as mensagens seguintes ecoam na sala nova',
      run: async () => {
        const { socket, sent } = fakeSocket();

        await sliceSocket.onMessage(socket, { type: 'JOIN', room: 'suporte' });
        await sliceSocket.onMessage(socket, { type: 'MESSAGE', text: 'olá' });

        if (sent[0].type !== 'JOINED' || sent[0].room !== 'suporte') {
          throw new Error(`esperava JOINED em suporte, obtive ${JSON.stringify(sent)}`);
        }

        if (sent[1].type !== 'ECHO' || sent[1].room !== 'suporte' || sent[1].text !== 'olá') {
          throw new Error(`esperava ECHO em suporte, obtive ${JSON.stringify(sent)}`);
        }
      }
    }
  ]
};
