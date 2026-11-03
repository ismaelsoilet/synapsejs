import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useState } from 'react';
import {
  type ActionContext,
  type DatabaseClient,
  Err,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext,
  type WebhookEvent
} from 'synapsejs';
import { showcaseBaseUrl, signWebhookPayload, verifyWebhookSignature } from '../../shared/showcase';
import { FeatureGuide, PageHeader } from '../../shared/ui';

export const WebhooksInputSchema = Type.Object(
  {
    event: Type.String({ minLength: 1, maxLength: 80 }),
    message: Type.String({ minLength: 1, maxLength: 500 })
  },
  { additionalProperties: true }
);
export type WebhooksInput = Static<typeof WebhooksInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS showcase_webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export interface WebhookEventRow {
  id: string;
  event_type: string;
  payload: string;
  status: string;
  created_at: string;
}

export type WebhooksOutput = Result<
  { status: number; accepted: boolean; body: unknown },
  'INVALID_SCHEMA' | 'DELIVERY_FAILED'
>;

export async function webhooksAction(
  payload: unknown,
  _db?: DatabaseClient,
  _session?: SessionContext
): Promise<WebhooksOutput> {
  if (!Value.Check(WebhooksInputSchema, payload)) return Err('INVALID_SCHEMA');
  const input = payload as WebhooksInput;
  const rawBody = JSON.stringify({
    event: input.event,
    message: input.message,
    sentAt: new Date().toISOString()
  });
  const signature = signWebhookPayload(rawBody);

  try {
    const response = await fetch(`${showcaseBaseUrl()}/_synapse/webhooks/showcase/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-showcase-signature': signature
      },
      body: rawBody
    });
    const body = await response.json().catch(() => null);
    return Ok({ status: response.status, accepted: response.ok, body });
  } catch {
    return Err('DELIVERY_FAILED');
  }
}

export async function ShowcaseWebhook(event: WebhookEvent, ctx: ActionContext): Promise<Record<string, unknown>> {
  const rawBody = new TextDecoder().decode(event.rawBody);
  const signature = event.headers.get('x-showcase-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return { ok: false, error: 'INVALID_SIGNATURE' };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }

  const id = crypto.randomUUID();
  await ctx.insert('showcase_webhook_events', {
    id,
    event_type: String(parsed.event ?? 'unknown'),
    payload: rawBody,
    status: 'accepted'
  });

  return { ok: true, eventId: id, received: parsed.event ?? 'unknown' };
}

export interface WebhooksLoaderData {
  events: WebhookEventRow[];
  endpoint: string;
}

export async function WebhooksLoader(context: SliceLoaderContext): Promise<WebhooksLoaderData> {
  try {
    return {
      events: await context.db.query<WebhookEventRow>(
        'SELECT * FROM showcase_webhook_events ORDER BY created_at DESC LIMIT 20'
      ),
      endpoint: '/_synapse/webhooks/showcase/webhooks'
    };
  } catch {
    return { events: [], endpoint: '/_synapse/webhooks/showcase/webhooks' };
  }
}

export interface WebhooksTriggerProps extends WebhooksLoaderData {
  onSubmitAction?: (payload: unknown) => Promise<WebhooksOutput>;
}

export function WebhooksTrigger({ events, endpoint, onSubmitAction }: WebhooksTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!onSubmitAction || busy) return;
    setBusy(true);
    const result = await onSubmitAction({
      event: 'showcase.ping',
      message: `Evento assinado em ${new Date().toLocaleTimeString('pt-BR')}`
    });
    setBusy(false);

    if (!result.ok) {
      setFeedback(`Falha na entrega: ${result.error}`);
      return;
    }

    setFeedback(`HTTP ${result.value.status} · aceito=${String(result.value.accepted)}`);
    (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Webhooks"
        title="Entrega assinada com HMAC-SHA256"
        description="O handler preserva o rawBody, valida a assinatura antes de interpretar o JSON e persiste o evento. O botão dispara uma entrega real contra o endpoint deste mesmo app."
        actions={
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Entregando…' : 'Enviar webhook assinado'}
          </button>
        }
      />

      {feedback ? (
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-2.5 font-mono text-xs text-cyan-200">
          {feedback}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-bold text-white">Contrato do endpoint</h2>
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 font-mono text-[10px] leading-relaxed text-slate-400">
            POST {endpoint}
            <br />
            x-showcase-signature: hmac-sha256(rawBody)
            <br />
            content-type: application/json
          </div>
          <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-400">
            <p>
              A assinatura é calculada com <code className="text-cyan-300">crypto.createHmac</code> e comparada com{' '}
              <code className="text-cyan-300">timingSafeEqual</code>.
            </p>
            <p>
              Assinatura inválida → <code className="text-rose-300">400 INVALID_SIGNATURE</code>; evento válido → grava
              em <code>showcase_webhook_events</code>.
            </p>
            <p>
              O segredo padrão da demo é <code>SHOWCASE_WEBHOOK_SECRET</code>; em produção, defina o seu antes de expor
              o endpoint.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Eventos recebidos</h2>
            <span className="font-mono text-[10px] text-slate-500">{events.length} registros</span>
          </div>
          <div className="mt-3 space-y-2">
            {events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-xs text-slate-500">
                Nenhum webhook recebido. Use o botão acima.
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="animate-slide-in rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-cyan-300">{event.event_type}</span>
                    <span className="rounded border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[8px] text-emerald-300">
                      {event.status}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[9px] text-slate-500">{event.payload}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <FeatureGuide
        title="Webhooks assinados"
        icon="webhooks"
        what="Um provedor externo envia um POST; o handler preserva o rawBody, valida a assinatura HMAC e só então interpreta o JSON e persiste o evento."
        useCases={[
          'Eventos de pagamento (Stripe, Mercado Pago)',
          'Push, pull request e checks (GitHub)',
          'Mensagens de filas e provedores externos',
          'Integrações entre SaaS com replay protection'
        ]}
        steps={[
          'O handler <Name>Webhook recebe { rawBody, json, headers }.',
          'verifyWebhookSignature compara o HMAC com timingSafeEqual.',
          'O evento validado é gravado em showcase_webhook_events.',
          'Assinatura inválida retorna 400 antes do parse.'
        ]}
        observe="Clique em “Enviar webhook assinado”; o app entrega para si mesmo e o evento aparece abaixo. Altere o segredo/assinatura e a entrega é recusada."
      />
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Webhooks | Synapse Showcase',
    description: 'Webhooks assinados com HMAC-SHA256 e rawBody preservado.'
  };
}

export const sliceTests = {
  description: 'Invariantes de webhooks',
  cases: [
    {
      name: 'assinatura inválida é recusada antes do parse',
      run: async () => {
        const result = await ShowcaseWebhook(
          {
            rawBody: new TextEncoder().encode('{"event":"x"}'),
            bodyText: '{"event":"x"}',
            json: { event: 'x' },
            headers: new Headers({ 'x-showcase-signature': 'wrong' })
          },
          { insert: async () => ({}) } as unknown as ActionContext
        );
        if (result.ok !== false || result.error !== 'INVALID_SIGNATURE') {
          throw new Error('esperava INVALID_SIGNATURE');
        }
      }
    },
    {
      name: 'assinatura válida persiste o evento',
      run: async () => {
        const raw = JSON.stringify({ event: 'oracle.test' });
        const inserted: Array<Record<string, unknown>> = [];
        const result = await ShowcaseWebhook(
          {
            rawBody: new TextEncoder().encode(raw),
            bodyText: raw,
            json: JSON.parse(raw),
            headers: new Headers({ 'x-showcase-signature': signWebhookPayload(raw) })
          },
          {
            insert: async (_table: string, data: Record<string, unknown>) => {
              inserted.push(data);
              return data;
            }
          } as unknown as ActionContext
        );
        if (result.ok !== true || inserted.length !== 1) throw new Error('esperava um evento persistido');
      }
    }
  ]
};
