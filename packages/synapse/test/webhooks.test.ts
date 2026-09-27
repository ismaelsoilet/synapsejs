import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SynapseServer } from '../src/runtime/server';

describe('Webhooks Gateway & Raw Body Preservation (Fase D)', () => {
  test('dispatches webhook requests with rawBody Uint8Array and parsed JSON', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-webhook-'));
    const sliceDir = path.join(appDir, 'src', 'slices', 'payments');
    fs.mkdirSync(sliceDir, { recursive: true });

    // Create a slice with a Webhook export
    const slicePath = path.join(sliceDir, 'stripe.slice.tsx');
    fs.writeFileSync(
      slicePath,
      `
      export const stripeWebhook = async (event, ctx) => {
        globalThis.__TEST_WEBHOOK_EVENT__ = event;
        return { received: true, id: event.json?.id };
      };
      `
    );

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    const webhookUrl = `http://localhost:${server.port}/_synapse/webhooks/payments/stripe`;

    const rawPayload = JSON.stringify({ id: 'evt_12345', type: 'payment_intent.succeeded' });
    const signature = 't=123,v1=abcdef';

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature
      },
      body: rawPayload
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true, id: 'evt_12345' });

    // Verify global test capture
    const captured = (globalThis as Record<string, unknown>).__TEST_WEBHOOK_EVENT__ as {
      rawBody: Uint8Array;
      bodyText: string;
      json: unknown;
      headers: Headers;
    };
    expect(captured).toBeDefined();
    expect(captured.rawBody).toBeInstanceOf(Uint8Array);
    expect(captured.bodyText).toBe(rawPayload);
    expect(captured.json).toEqual({ id: 'evt_12345', type: 'payment_intent.succeeded' });
    expect(captured.headers.get('stripe-signature')).toBe(signature);

    await server.stop();
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  test('returns 404 when target slice exports no webhook', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-webhook-none-'));
    const sliceDir = path.join(appDir, 'src', 'slices', 'demo');
    fs.mkdirSync(sliceDir, { recursive: true });

    fs.writeFileSync(path.join(sliceDir, 'empty.slice.tsx'), 'export const emptyAction = async () => ({ ok: true });');

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    const res = await fetch(`http://localhost:${server.port}/_synapse/webhooks/demo/empty`, {
      method: 'POST',
      body: 'test'
    });

    expect(res.status).toBe(404);

    await server.stop();
    fs.rmSync(appDir, { recursive: true, force: true });
  });
});
