import { type Static, Type } from '@sinclair/typebox';
import type { ActionContext, DatabaseClient, WebhookEvent } from 'synapsejs';
import { Err, Ok, type Result, signWebhookPayload, verifyWebhookSignature, WebhookReplayGuard } from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA
// ============================================================================
export const PaymentWebhookInputSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  amountCents: Type.Integer({ minimum: 1 })
});
export type PaymentWebhookInput = Static<typeof PaymentWebhookInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS payment_deliveries (
    delivery_id TEXT PRIMARY KEY,
    amount_cents INTEGER NOT NULL,
    signature TEXT NOT NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. VERIFICAÇÃO: constante no tempo + janela de replay limitada
// ============================================================================
/** The secret a real deployment reads from the environment; the slice's oracle injects one. */
export function paymentWebhookSecret(): string | undefined {
  return process.env.SYNAPSE_PAYMENT_WEBHOOK_SECRET;
}

/** One guard per process: a signature accepted here is a replay anywhere else. */
export const paymentReplayGuard = new WebhookReplayGuard({ ttlSeconds: 300, maxEntries: 1000 });

export type PaymentWebhookResult = Result<
  { deliveryId: string; status: 'ACCEPTED' | 'DUPLICATE' },
  'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_WINDOW' | 'REPLAYED_DELIVERY' | 'NO_SECRET' | 'INVALID_PAYLOAD'
>;

/**
 * The webhook handler the runtime mounts at `POST /_synapse/webhooks/webhooks/stripe-payment`.
 * It verifies the signature over `event.rawBody` (never over a re-serialized body),
 * refuses a delivery outside the time window, refuses a replay, and records the
 * delivery idempotently.
 */
export async function stripePaymentWebhook(
  event: WebhookEvent<PaymentWebhookInput>,
  ctx: ActionContext
): Promise<{ ok: boolean; error?: string; deliveryId?: string }> {
  const secret = paymentWebhookSecret();

  if (!secret) {
    return { ok: false, error: 'NO_SECRET' };
  }

  const signature = event.headers.get('x-signature') ?? '';
  const timestamp = Number(event.headers.get('x-timestamp') ?? 'NaN');

  const verified = verifyWebhookSignature({
    payload: event.rawBody,
    signature,
    secret,
    timestamp
  });

  if (!verified.ok) {
    return { ok: false, error: verified.error };
  }

  if (!paymentReplayGuard.accept(signature)) {
    return { ok: false, error: 'REPLAYED_DELIVERY' };
  }

  const body = event.json as PaymentWebhookInput | null;

  if (!body?.id) {
    return { ok: false, error: 'INVALID_PAYLOAD' };
  }

  try {
    await ctx.insert('payment_deliveries', {
      delivery_id: body.id,
      amount_cents: body.amountCents,
      signature
    });
  } catch {
    // The primary key makes a repeated delivery id a no-op rather than a second row.
    return { ok: true, deliveryId: body.id };
  }

  return { ok: true, deliveryId: body.id };
}

// ============================================================================
// 2.5. AÇÃO E UI: as entregas aceitas ficam auditáveis pelo mesmo slice
// ============================================================================
export type PaymentAuditOutput = Result<{ deliveries: number }, 'NO_DATABASE'>;

export async function paymentAuditAction(_payload: unknown, db?: DatabaseClient): Promise<PaymentAuditOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  const rows = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM payment_deliveries');

  return Ok({ deliveries: Number(rows[0]?.total ?? 0) });
}

export interface PaymentAuditViewProps {
  deliveries?: number;
}

export function PaymentAuditView({ deliveries = 0 }: PaymentAuditViewProps) {
  return <p data-deliveries={deliveries}>Entregas assinadas recebidas: {deliveries}</p>;
}

// ============================================================================
// 3. ORÁCULO: assinatura válida, inválida, expirada e repetida têm desfechos distintos
// ============================================================================
function signedEvent(secret: string, body: string, timestamp: number, signatureOverride?: string) {
  const rawBody = new TextEncoder().encode(body);

  return {
    rawBody,
    bodyText: body,
    json: JSON.parse(body) as PaymentWebhookInput,
    headers: new Headers({
      'x-signature': signatureOverride ?? signWebhookPayload(secret, timestamp, rawBody),
      'x-timestamp': String(timestamp)
    })
  };
}

function recordingContext() {
  const rows: Array<Record<string, unknown>> = [];
  const ctx = {
    insert: async (_table: string, data: Record<string, unknown>) => {
      rows.push(data);
      return data;
    }
  } as unknown as ActionContext;

  return { ctx, rows };
}

export const sliceTests = {
  description: 'Invariantes do webhook assinado',
  cases: [
    {
      name: 'assinatura válida dentro da janela é aceita e gravada',
      run: async () => {
        const secret = 'segredo-de-teste';
        const now = Math.floor(Date.now() / 1000);
        process.env.SYNAPSE_PAYMENT_WEBHOOK_SECRET = secret;
        paymentReplayGuard.clear();

        const { ctx, rows } = recordingContext();
        const result = await stripePaymentWebhook(
          signedEvent(
            secret,
            JSON.stringify({ id: 'evt-1', amountCents: 2599 }),
            now
          ) as WebhookEvent<PaymentWebhookInput>,
          ctx
        );

        if (!result.ok || rows.length !== 1 || rows[0].amount_cents !== 2599) {
          throw new Error(`esperava aceite e gravação, obtive ${JSON.stringify({ result, rows })}`);
        }
      }
    },
    {
      name: 'corpo alterado depois da assinatura é recusado',
      run: async () => {
        const secret = 'segredo-de-teste';
        const now = Math.floor(Date.now() / 1000);
        process.env.SYNAPSE_PAYMENT_WEBHOOK_SECRET = secret;
        paymentReplayGuard.clear();

        const original = signedEvent(secret, JSON.stringify({ id: 'evt-2', amountCents: 100 }), now);
        const tampered = {
          ...original,
          rawBody: new TextEncoder().encode(JSON.stringify({ id: 'evt-2', amountCents: 999999 }))
        };

        const { ctx, rows } = recordingContext();
        const result = await stripePaymentWebhook(tampered as WebhookEvent<PaymentWebhookInput>, ctx);

        if (result.ok || result.error !== 'INVALID_SIGNATURE' || rows.length !== 0) {
          throw new Error(`esperava INVALID_SIGNATURE sem gravação, obtive ${JSON.stringify({ result, rows })}`);
        }
      }
    },
    {
      name: 'assinatura válida repetida é recusada como replay',
      run: async () => {
        const secret = 'segredo-de-teste';
        const now = Math.floor(Date.now() / 1000);
        process.env.SYNAPSE_PAYMENT_WEBHOOK_SECRET = secret;
        paymentReplayGuard.clear();

        const event = signedEvent(secret, JSON.stringify({ id: 'evt-3', amountCents: 500 }), now);
        const first = await stripePaymentWebhook(event as WebhookEvent<PaymentWebhookInput>, recordingContext().ctx);
        const replay = await stripePaymentWebhook(event as WebhookEvent<PaymentWebhookInput>, recordingContext().ctx);

        if (!first.ok || replay.ok || replay.error !== 'REPLAYED_DELIVERY') {
          throw new Error(`esperava REPLAYED_DELIVERY, obtive ${JSON.stringify({ first, replay })}`);
        }
      }
    },
    {
      name: 'entrega fora da janela temporal é recusada mesmo com assinatura correta',
      run: async () => {
        const secret = 'segredo-de-teste';
        process.env.SYNAPSE_PAYMENT_WEBHOOK_SECRET = secret;
        paymentReplayGuard.clear();

        const stale = Math.floor(Date.now() / 1000) - 3600;
        const result = await stripePaymentWebhook(
          signedEvent(
            secret,
            JSON.stringify({ id: 'evt-4', amountCents: 700 }),
            stale
          ) as WebhookEvent<PaymentWebhookInput>,
          recordingContext().ctx
        );

        if (result.ok || result.error !== 'TIMESTAMP_OUT_OF_WINDOW') {
          throw new Error(`esperava TIMESTAMP_OUT_OF_WINDOW, obtive ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'sem segredo configurado o endpoint recusa em vez de aceitar',
      run: async () => {
        delete process.env.SYNAPSE_PAYMENT_WEBHOOK_SECRET;
        paymentReplayGuard.clear();
        const now = Math.floor(Date.now() / 1000);

        const result = await stripePaymentWebhook(
          signedEvent(
            'qualquer',
            JSON.stringify({ id: 'evt-5', amountCents: 100 }),
            now
          ) as WebhookEvent<PaymentWebhookInput>,
          recordingContext().ctx
        );

        if (result.ok || result.error !== 'NO_SECRET') {
          throw new Error(`esperava NO_SECRET, obtive ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
