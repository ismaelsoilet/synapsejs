import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type ActionContext, type DatabaseClient, defineJob, Err, Ok, type Result } from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA
// ============================================================================
export const WelcomeEmailInputSchema = Type.Object({
  customerId: Type.String({ minLength: 1 }),
  email: Type.String({ format: 'email' })
});
export type WelcomeEmailInput = Static<typeof WelcomeEmailInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS welcome_emails (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export type WelcomeEmailOutput = Result<{ jobId: string }, 'INVALID_SCHEMA' | 'NO_DATABASE' | 'QUEUE_FAILED'>;

// ============================================================================
// 2. FATIA: ENFILEIRA O TRABALHO (o worker executa `performWelcomeEmail`)
// ============================================================================
export async function enqueueWelcomeEmailAction(
  payload: unknown,
  db?: DatabaseClient,
  _session?: unknown,
  ctx?: ActionContext
): Promise<WelcomeEmailOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(WelcomeEmailInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as WelcomeEmailInput;

  if (!ctx?.enqueue) {
    return Err('QUEUE_FAILED');
  }

  try {
    const jobId = await ctx.enqueue(performWelcomeEmail, { customerId: input.customerId, email: input.email });
    return Ok({ jobId });
  } catch {
    return Err('QUEUE_FAILED');
  }
}

// ============================================================================
// 3. JOB DE BACKGROUND: o registro é feito por um handler real (o oráculo o executa)
// ============================================================================
export const performWelcomeEmail = defineJob<{ customerId: string; email: string }>({
  name: 'send-welcome-email',
  retryLimit: 3,
  backoffSeconds: 1,
  handler: async (payload, ctx) => {
    await ctx.insert('welcome_emails', {
      id: crypto.randomUUID(),
      customer_id: payload.customerId,
      email: payload.email,
      status: 'SENT'
    });
  }
});

// ============================================================================
// 3.5. UI: o gatilho que enfileira pelo mesmo ponto de chamada (no cliente vira RPC)
// ============================================================================
export interface WelcomeEmailTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<WelcomeEmailOutput>;
}

export function WelcomeEmailTrigger({ onSubmitAction }: WelcomeEmailTriggerProps) {
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await onSubmitAction?.({
          customerId: String(form.get('customerId') ?? ''),
          email: String(form.get('email') ?? '')
        });
      }}
    >
      <input name="customerId" placeholder="ID do cliente" required />
      <input name="email" type="email" placeholder="e-mail" required />
      <button type="submit">Enviar boas-vindas</button>
    </form>
  );
}

// ============================================================================
// 4. ORÁCULO: exercita o caminho real do job contra um banco de teste
// ============================================================================
export const sliceTests = {
  description: 'Invariantes do job de boas-vindas',
  cases: [
    {
      name: 'o handler do job grava o registro de envio',
      run: async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const fakeCtx = {
          insert: async (_table: string, data: Record<string, unknown>) => {
            inserted.push(data);
            return data;
          }
        } as unknown as ActionContext;

        await performWelcomeEmail.handler?.({ customerId: 'cust-1', email: 'novo@exemplo.com' }, fakeCtx);

        if (inserted.length !== 1 || inserted[0].status !== 'SENT') {
          throw new Error(`esperava um registro SENT, obtive ${JSON.stringify(inserted)}`);
        }
      }
    },
    {
      name: 'payload inválido retorna INVALID_SCHEMA antes de enfileirar',
      run: async () => {
        const result = await enqueueWelcomeEmailAction({ customerId: '', email: 'nao-e-email' }, {} as DatabaseClient);

        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`esperava INVALID_SCHEMA, obtive ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
