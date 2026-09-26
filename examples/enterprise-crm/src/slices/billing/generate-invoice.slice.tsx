import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import type React from 'react';
import { useState } from 'react';
import {
  createSession,
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  requireAuth,
  type SessionContext
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA (Mapeamento Runtime -> Tipos Estáticos JIT)
// ============================================================================
export const InvoiceInputSchema = Type.Object({
  customerId: Type.String({ minLength: 10 }),
  amountCents: Type.Integer({ minimum: 1 }),
  taxRate: Type.Number({ minimum: 0, maximum: 0.3 }),
  idempotencyToken: Type.String({ minLength: 12 })
});
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

// DDL Schema Declarativo da Fatia (Auto-Migrado pelo Synapse)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    base_cents INTEGER NOT NULL,
    tax_rate REAL NOT NULL,
    total_cents INTEGER NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA E IMUTÁVEL (Server Action / RPC Interno)
// ============================================================================
export async function createInvoiceAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<InvoiceOutput> {
  // Autorização explícita: só quem tem o papel 'billing' emite fatura
  const auth = requireAuth(session, ['billing']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  // Parsing JIT ultrarrápido via TypeBox Value.Check
  if (!Value.Check(InvoiceInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as InvoiceInput;
  const total = input.amountCents + Math.round(input.amountCents * input.taxRate);

  // Verificação de Idempotência
  const existCheck = await db.query<{ id: string }>(`SELECT id FROM invoices WHERE idempotency_key = $1`, [
    input.idempotencyToken
  ]);
  if (existCheck.length > 0) {
    return Err('DUPLICATE_IDEMPOTENCY');
  }

  // Verificação de Existência do Cliente
  const customerCheck = await db.query<{ id: string }>(`SELECT id FROM customers WHERE id = $1`, [input.customerId]);
  if (customerCheck.length === 0) {
    return Err('CUSTOMER_NOT_FOUND');
  }

  // Persistência Atômica
  const invoiceId = crypto.randomUUID();
  const result = await db.query<{ id: string }>(
    `INSERT INTO invoices (id, customer_id, base_cents, tax_rate, total_cents, idempotency_key) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [invoiceId, input.customerId, input.amountCents, input.taxRate, total, input.idempotencyToken]
  );

  return Ok({
    invoiceId: result[0]?.id ?? invoiceId,
    totalWithTax: total,
    status: 'GENERATED'
  });
}

// ============================================================================
// 4. VISUALIZAÇÃO INTERATIVA DA UI (React Component Embutido)
// ============================================================================
export interface InvoiceTriggerProps {
  /** Vem do loader abaixo, ou da query string, ou do formulário. */
  customerId?: string;
  onSubmitAction?: (payload: unknown) => Promise<InvoiceOutput>;
}

/**
 * Dados reais no SSR: o primeiro cliente do banco alimenta o formulário.
 * Sem loader, o componente renderizaria com um id inventado — que é exatamente
 * o tipo de coisa que quebra na primeira tela de um app de verdade.
 */
export async function GenerateInvoiceLoader(context: {
  db: DatabaseClient;
  session: SessionContext;
}): Promise<{ customerId?: string }> {
  const auth = requireAuth(context.session, ['billing']);
  if (!auth.ok) {
    return {};
  }

  const customers = await context.db.query<{ id: string }>(`SELECT id FROM customers ORDER BY created_at DESC LIMIT 1`);

  return customers.length > 0 ? { customerId: customers[0].id } : {};
}

export function InvoiceTrigger({ customerId = 'cust-sem-selecao', onSubmitAction }: InvoiceTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmitAction) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const payload = {
      customerId,
      amountCents: parseInt(formData.get('amountCents') as string, 10),
      taxRate: parseFloat(formData.get('taxRate') as string),
      idempotencyToken: (formData.get('idempotencyToken') as string) || crypto.randomUUID()
    };

    const res = await onSubmitAction(payload);
    setIsSubmitting(false);

    if (res.ok) {
      setFeedback(`Fatura criada com sucesso! ID: ${res.value.invoiceId} (Total: ${res.value.totalWithTax} centavos)`);
    } else {
      setFeedback(`Erro ao gerar fatura: ${res.error}`);
    }
  };

  return (
    <div className="synapse-invoice-slice p-4 border rounded shadow-sm">
      <h3 className="text-lg font-bold mb-2">Emissão de Fatura</h3>
      <form id="invoice-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col">
          <span>Valor (em centavos):</span>
          <input type="number" name="amountCents" required min="1" defaultValue="5000" className="border p-1 rounded" />
        </label>

        <label className="flex flex-col">
          <span>Alíquota de Imposto:</span>
          <input
            type="number"
            step="0.01"
            name="taxRate"
            required
            defaultValue="0.20"
            min="0"
            max="0.3"
            className="border p-1 rounded"
          />
        </label>

        <input type="hidden" name="idempotencyToken" value="token-idempotent-slice-12345" />

        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
        >
          {isSubmitting ? 'Processando...' : 'Emitir Fatura'}
        </button>
      </form>

      {feedback && <div className="mt-3 p-2 bg-gray-100 rounded text-sm font-mono">{feedback}</div>}
    </div>
  );
}

// ============================================================================
// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT (Property-Based Testing Integrado)
// ============================================================================
export const sliceTests = {
  description: 'Verificação PBT de invariantes lógicos para geração de faturação',
  cases: [
    {
      name: 'valores inválidos ou negativos retornam INVALID_SCHEMA',
      run: async () => {
        const session = createSession({ userId: 'pbt-oracle', roles: ['billing'] });

        fc.assert(
          fc.asyncProperty(
            fc.integer({ min: -50000, max: 0 }),
            fc.double({ min: 0.31, max: 2.0 }),
            async (negativeAmount, invalidTax) => {
              const mockDb = new MockDatabaseClient();
              const result = await createInvoiceAction(
                {
                  customerId: 'cust-uuid-1234567890',
                  amountCents: negativeAmount,
                  taxRate: invalidTax,
                  idempotencyToken: 'key-123456789123'
                },
                mockDb,
                session
              );

              return result.ok === false && result.error === 'INVALID_SCHEMA';
            }
          )
        );
      }
    },
    {
      name: 'dados válidos com cliente existente geram o total com imposto exato',
      run: async () => {
        const session = createSession({ userId: 'pbt-oracle', roles: ['billing'] });

        fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 100, max: 1000000 }),
            fc.double({ min: 0.0, max: 0.3 }),
            async (amountCents, taxRate) => {
              const mockDb = new MockDatabaseClient();
              mockDb
                .onQuery(/SELECT id FROM invoices/, () => [])
                .onQuery(/SELECT id FROM customers/, () => [{ id: 'cust-uuid-1234567890' }])
                .onQuery(/INSERT INTO invoices/, () => [{ id: 'inv-test-id-123' }]);

              const result = await createInvoiceAction(
                {
                  customerId: 'cust-uuid-1234567890',
                  amountCents,
                  taxRate,
                  idempotencyToken: 'idemp-valid-key-123'
                },
                mockDb,
                session
              );

              if (!result.ok) return false;

              const expectedTotal = amountCents + Math.round(amountCents * taxRate);
              return (
                result.value.status === 'GENERATED' &&
                result.value.totalWithTax === expectedTotal &&
                result.value.invoiceId === 'inv-test-id-123'
              );
            }
          )
        );
      }
    },
    {
      name: 'cliente inexistente retorna CUSTOMER_NOT_FOUND',
      run: async () => {
        const session = createSession({ userId: 'pbt-oracle', roles: ['billing'] });
        const mockDbMissing = new MockDatabaseClient();
        mockDbMissing.onQuery(/SELECT id FROM invoices/, () => []).onQuery(/SELECT id FROM customers/, () => []);

        const missingResult = await createInvoiceAction(
          {
            customerId: 'cust-uuid-1234567890',
            amountCents: 5000,
            taxRate: 0.15,
            idempotencyToken: 'idemp-valid-key-999'
          },
          mockDbMissing,
          session
        );

        if (missingResult.ok || missingResult.error !== 'CUSTOMER_NOT_FOUND') {
          throw new Error(`Invariante violada: esperava CUSTOMER_NOT_FOUND, obteve ${JSON.stringify(missingResult)}`);
        }
      }
    },
    {
      name: 'chamada sem sessão retorna UNAUTHORIZED',
      run: async () => {
        const anonymousResult = await createInvoiceAction(
          {
            customerId: 'cust-uuid-1234567890',
            amountCents: 5000,
            taxRate: 0.15,
            idempotencyToken: 'idemp-valid-key-000'
          },
          new MockDatabaseClient()
        );

        if (anonymousResult.ok || anonymousResult.error !== 'UNAUTHORIZED') {
          throw new Error(
            `Invariante violada: esperava UNAUTHORIZED sem sessão, obteve ${JSON.stringify(anonymousResult)}`
          );
        }
      }
    },
    {
      name: 'sessão sem o papel billing retorna FORBIDDEN',
      run: async () => {
        const forbiddenResult = await createInvoiceAction(
          {
            customerId: 'cust-uuid-1234567890',
            amountCents: 5000,
            taxRate: 0.15,
            idempotencyToken: 'idemp-valid-key-001'
          },
          new MockDatabaseClient(),
          createSession({ userId: 'pbt-readonly', roles: ['viewer'] })
        );

        if (forbiddenResult.ok || forbiddenResult.error !== 'FORBIDDEN') {
          throw new Error(`Invariante violada: esperava FORBIDDEN, obteve ${JSON.stringify(forbiddenResult)}`);
        }
      }
    }
  ]
};
