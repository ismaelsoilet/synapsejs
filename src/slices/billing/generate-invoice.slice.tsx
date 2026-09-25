import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import type { DatabaseClient } from '@/core/database-client';
import { Result, Ok, Err, MockDatabaseClient, type SessionContext } from '@/core/index';

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Erradicação do 'Throw Error')
// ============================================================================
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA E IMUTÁVEL (Server Action / RPC Interno)
// ============================================================================
export async function createInvoiceAction(
  payload: unknown,
  db: DatabaseClient,
  session?: SessionContext
): Promise<InvoiceOutput> {
  // Parsing JIT ultrarrápido via TypeBox Value.Check
  if (!Value.Check(InvoiceInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as InvoiceInput;
  const total = input.amountCents + Math.round(input.amountCents * input.taxRate);

  // Verificação de Idempotência
  const existCheck = await db.query<{ id: string }>(
    `SELECT id FROM invoices WHERE idempotency_key = $1`,
    [input.idempotencyToken]
  );
  if (existCheck.length > 0) {
    return Err('DUPLICATE_IDEMPOTENCY');
  }

  // Verificação de Existência do Cliente
  const customerCheck = await db.query<{ id: string }>(
    `SELECT id FROM customers WHERE id = $1`,
    [input.customerId]
  );
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
  customerId: string;
  onSubmitAction?: (payload: unknown) => Promise<InvoiceOutput>;
}

export function InvoiceTrigger({ customerId, onSubmitAction }: InvoiceTriggerProps) {
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
          <input
            type="number"
            name="amountCents"
            required
            min="1"
            defaultValue="5000"
            className="border p-1 rounded"
          />
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

      {feedback && (
        <div className="mt-3 p-2 bg-gray-100 rounded text-sm font-mono">
          {feedback}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT (Property-Based Testing Integrado)
// ============================================================================
export const sliceTests = {
  description: 'Verificação PBT de invariantes lógicos para geração de faturação',
  run: async () => {
    // 1. Invariante: Valores inválidos ou negativos SEMPRE retornam INVALID_SCHEMA
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
            mockDb
          );

          return result.ok === false && result.error === 'INVALID_SCHEMA';
        }
      )
    );

    // 2. Invariante: Com dados válidos e cliente existente, SEMPRE gera fatura com cálculo de imposto exato
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 1000000 }),
        fc.double({ min: 0.0, max: 0.3 }),
        async (amountCents, taxRate) => {
          const mockDb = new MockDatabaseClient();
          mockDb
            .onQuery(/SELECT id FROM invoices/, () => []) // Idempotência limpa
            .onQuery(/SELECT id FROM customers/, () => [{ id: 'cust-uuid-1234567890' }]) // Cliente existe
            .onQuery(/INSERT INTO invoices/, () => [{ id: 'inv-test-id-123' }]);

          const result = await createInvoiceAction(
            {
              customerId: 'cust-uuid-1234567890',
              amountCents,
              taxRate,
              idempotencyToken: 'idemp-valid-key-123'
            },
            mockDb
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

    // 3. Invariante: Cliente inexistente SEMPRE retorna CUSTOMER_NOT_FOUND
    const mockDbMissing = new MockDatabaseClient();
    mockDbMissing
      .onQuery(/SELECT id FROM invoices/, () => [])
      .onQuery(/SELECT id FROM customers/, () => []); // Não encontrado

    const missingResult = await createInvoiceAction(
      {
        customerId: 'cust-uuid-1234567890',
        amountCents: 5000,
        taxRate: 0.15,
        idempotencyToken: 'idemp-valid-key-999'
      },
      mockDbMissing
    );

    if (missingResult.ok || missingResult.error !== 'CUSTOMER_NOT_FOUND') {
      throw new Error(`Invariante violada: esperava CUSTOMER_NOT_FOUND, obteve ${JSON.stringify(missingResult)}`);
    }

    return true;
  }
};

// Execução standalone direta via CLI/Bun
if (import.meta.main) {
  console.log('⚡ Executando Oráculo PBT do Slice generate-invoice...');
  sliceTests.run()
    .then(() => {
      console.log('✅ [PBT ORACLE PASS] Todos os invariantes matemáticos e limites foram aprovados com sucesso!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ [PBT ORACLE FAIL] Falha na verificação de invariantes:', err);
      process.exit(1);
    });
}
