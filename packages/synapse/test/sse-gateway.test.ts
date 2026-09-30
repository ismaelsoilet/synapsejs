import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { declaredTopics, defineTopic, REALTIME_REJECTIONS, resetDeclaredTopics } from '../src/core/topics';
import { resetEventHub } from '../src/runtime/event-hub';
import { SynapseServer } from '../src/runtime/server';

let appDir: string;

/** A slice that owns the `tickets` topic and broadcasts into it. */
function writeOwnerSlice(): void {
  const sliceDir = path.join(appDir, 'src', 'slices', 'tickets');
  fs.mkdirSync(sliceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sliceDir, 'create-ticket.slice.tsx'),
    `
    export const createTicketAction = async (payload, ctx) => {
      const notified = ctx.broadcast('tickets', { type: 'TICKET_CREATED', id: 't-100' });
      return { ok: true, notified };
    };
    `
  );
}

/** A different slice that tries to publish into `tickets`, which it does not own. */
function writeForeignPublisherSlice(): void {
  const sliceDir = path.join(appDir, 'src', 'slices', 'billing');
  fs.mkdirSync(sliceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sliceDir, 'charge.slice.tsx'),
    `
    export const chargeAction = async (payload, ctx) => {
      const notified = ctx.broadcast('tickets', { type: 'NOT_MINE' });
      return { ok: true, notified };
    };
    `
  );
}

async function bootServer(config?: Record<string, unknown>): Promise<SynapseServer> {
  const server = new SynapseServer(appDir, 0, undefined, config as never);
  await server.discoverSlices();
  await server.start();

  return server;
}

function serverPort(server: SynapseServer): number {
  // biome-ignore lint/suspicious/noExplicitAny: reaching the bound port for the test
  return (server as any).httpServer.port as number;
}

async function openStream(port: number, topic: string, headers: Record<string, string> = {}) {
  const response = await fetch(`http://localhost:${port}/_synapse/sse/${topic}`, { headers });
  const isStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');

  return { response, reader: isStream ? response.body?.getReader() : undefined };
}

async function callAction(port: number, slice: string, payload: unknown = {}) {
  const response = await fetch(`http://localhost:${port}/_synapse/rpc/${slice}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return response.json() as Promise<{ ok: boolean; notified?: number; error?: string }>;
}

beforeEach(() => {
  resetEventHub();
  resetDeclaredTopics();
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-sse-'));
  writeOwnerSlice();
  writeForeignPublisherSlice();
});

afterEach(() => {
  resetDeclaredTopics();
  resetEventHub();
  fs.rmSync(appDir, { recursive: true, force: true });
});

describe('Event stream gateway — declared topics and authenticated subscribers', () => {
  test('refuses an anonymous subscriber and opens nothing', async () => {
    defineTopic({ name: 'tickets', owner: 'tickets/create-ticket' });

    const server = await bootServer();
    try {
      const { response } = await openStream(serverPort(server), 'tickets');

      expect(response.status).toBe(401);
      const body = (await response.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe('UNAUTHENTICATED');
      // The refusal code is one the machine contract enumerates.
      expect(Object.keys(REALTIME_REJECTIONS)).toContain(body.error);
      expect(response.headers.get('content-type')).not.toContain('text/event-stream');
      expect(declaredTopics().length).toBe(1);
    } finally {
      await server.stop();
    }
  });

  test('admits an anonymous subscriber to a deliberately public topic', async () => {
    defineTopic({ name: 'status-publico', owner: 'tickets/create-ticket', public: true });

    const server = await bootServer();
    try {
      const { response, reader } = await openStream(serverPort(server), 'status-publico');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      await reader?.cancel();
    } finally {
      await server.stop();
    }
  });

  test('refuses an undeclared topic even for an authenticated session', async () => {
    const server = await bootServer();
    try {
      const { response } = await openStream(serverPort(server), 'nao-declarado', { 'x-user-id': 'u1' });

      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('TOPIC_NOT_FOUND');
    } finally {
      await server.stop();
    }
  });

  test('refuses a declared topic the session cannot read', async () => {
    defineTopic({ name: 'tickets', owner: 'tickets/create-ticket', readRoles: ['support'] });

    const server = await bootServer();
    try {
      const { response } = await openStream(serverPort(server), 'tickets', {
        'x-user-id': 'u1',
        'x-user-roles': 'sales'
      });

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('TOPIC_FORBIDDEN');
    } finally {
      await server.stop();
    }
  });

  test('delivers an event to an authorised subscriber and refuses cross-owner publishing', async () => {
    defineTopic({ name: 'tickets', owner: 'tickets/create-ticket', readRoles: ['support'] });

    const server = await bootServer();
    const port = serverPort(server);

    try {
      const { response, reader } = await openStream(port, 'tickets', {
        'x-user-id': 'u1',
        'x-user-roles': 'support'
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const decoder = new TextDecoder();
      const first = await reader?.read();
      expect(decoder.decode(first?.value)).toContain(': connected\n\n');

      // A different slice cannot publish into a topic it does not own.
      const foreign = await callAction(port, 'billing/charge');
      expect(foreign.notified).toBe(0);

      // The owner can.
      const owner = await callAction(port, 'tickets/create-ticket');
      expect(owner.notified).toBe(1);

      const second = await reader?.read();
      const text = decoder.decode(second?.value);
      expect(text).toContain('event: message\n');
      expect(text).toContain('"type":"TICKET_CREATED"');

      await reader?.cancel();
    } finally {
      await server.stop();
    }
  });

  test('keeps the same topic name isolated per tenant', async () => {
    defineTopic({ name: 'tickets', owner: 'tickets/create-ticket' });

    const server = await bootServer();
    const port = serverPort(server);

    try {
      const acme = await openStream(port, 'tickets', { 'x-user-id': 'u1', 'x-tenant-id': 'acme' });
      const globex = await openStream(port, 'tickets', { 'x-user-id': 'u2', 'x-tenant-id': 'globex' });

      expect(acme.response.status).toBe(200);
      expect(globex.response.status).toBe(200);

      const decoder = new TextDecoder();
      await acme.reader?.read();
      await globex.reader?.read();

      const published = await fetch(`http://localhost:${port}/_synapse/rpc/tickets/create-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'acme' },
        body: JSON.stringify({})
      });
      expect(((await published.json()) as { notified: number }).notified).toBe(1);

      const acmeEvent = await acme.reader?.read();
      expect(decoder.decode(acmeEvent?.value)).toContain('TICKET_CREATED');

      await acme.reader?.cancel();
      await globex.reader?.cancel();
    } finally {
      await server.stop();
    }
  });

  test('bounds the registry and the concurrent subscriptions, and releases on disconnect', async () => {
    defineTopic({ name: 'tickets', owner: 'tickets/create-ticket' });
    defineTopic({ name: 'faturas', owner: 'billing/charge' });

    const server = await bootServer({ realtime: { maxTopics: 1, maxSubscriptions: 5, maxConnectionsPerClient: 1 } });
    const port = serverPort(server);

    try {
      const headers = { 'x-user-id': 'u1' };
      const first = await openStream(port, 'tickets', headers);
      expect(first.response.status).toBe(200);
      await first.reader?.read();

      // A second concurrent connection from the same identity exceeds the per-client cap.
      const perClient = await openStream(port, 'tickets', headers);
      expect(perClient.response.status).toBe(429);
      expect(((await perClient.response.json()) as { error: string }).error).toBe('REALTIME_LIMIT_EXCEEDED');

      // A different client hits the topic-registry bound instead.
      const otherTopic = await openStream(port, 'faturas', { 'x-user-id': 'u2' });
      expect(otherTopic.response.status).toBe(429);

      await first.reader?.cancel();

      // Disconnect releases the topic entry and the client slot.
      const afterDisconnect = await openStream(port, 'tickets', headers);
      expect(afterDisconnect.response.status).toBe(200);
      await afterDisconnect.reader?.cancel();
    } finally {
      await server.stop();
    }
  });
});
