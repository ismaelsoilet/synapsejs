import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetEventHub } from '../src/runtime/event-hub';
import { SynapseServer } from '../src/runtime/server';

describe('Server-Sent Events (SSE) Realtime Gateway', () => {
  test('streams realtime events over HTTP with automatic connection and teardown', async () => {
    resetEventHub();
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-sse-'));
    const sliceDir = path.join(appDir, 'src', 'slices', 'tickets');
    fs.mkdirSync(sliceDir, { recursive: true });

    fs.writeFileSync(
      path.join(sliceDir, 'create-ticket.slice.tsx'),
      `
      export const createTicketAction = async (payload, ctx) => {
        ctx.broadcast('tickets', { type: 'TICKET_CREATED', id: 't-100' });
        return { ok: true, ticketId: 't-100' };
      };
      `
    );

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    // biome-ignore lint/suspicious/noExplicitAny: access internal server port for testing
    const port = (server as any).httpServer.port;
    const sseUrl = `http://localhost:${port}/_synapse/sse/tickets`;

    const response = await fetch(sseUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();

    // 1. Initial connection comment
    const chunk1 = await reader!.read();
    expect(chunk1.done).toBe(false);
    const text1 = decoder.decode(chunk1.value);
    expect(text1).toContain(': connected\n\n');

    // 2. Broadcast event via RPC action
    const rpcUrl = `http://localhost:${port}/_synapse/rpc/tickets/create-ticket`;
    const rpcRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Laptop display glitch' })
    });
    const rpcJson = await rpcRes.json();
    expect(rpcJson.ok).toBe(true);

    // 3. Receive stream message
    const chunk2 = await reader!.read();
    expect(chunk2.done).toBe(false);
    const text2 = decoder.decode(chunk2.value);
    expect(text2).toContain('event: message\n');
    expect(text2).toContain('"type":"TICKET_CREATED"');
    expect(text2).toContain('"id":"t-100"');

    // 4. Teardown
    await reader!.cancel();
    // biome-ignore lint/suspicious/noExplicitAny: stop internal server
    (server as any).httpServer.stop(true);
    resetEventHub();
    fs.rmSync(appDir, { recursive: true, force: true });
  });
});
