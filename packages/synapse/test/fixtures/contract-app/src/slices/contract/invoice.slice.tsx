import { type Static, Type } from '@sinclair/typebox';
import { type DatabaseClient, Err, MockDatabaseClient, Ok, type Result, requireAuth, type SessionContext } from 'synapsejs';

/**
 * Framework-owned fixture slice.
 *
 * The contract suite used to import the reference application's slices by relative
 * path, which meant editing an example could turn the framework suite red. This
 * fixture exercises the same framework behaviour — JIT contract, RBAC, persistence
 * and domain errors — while belonging to the framework itself.
 */
export const ContractInvoiceInputSchema = Type.Object({
  customerId: Type.String({ minLength: 10 }),
  amountCents: Type.Integer({ minimum: 1 }),
  taxRate: Type.Number({ minimum: 0, maximum: 0.3 }),
  idempotencyToken: Type.String({ minLength: 12 })
});
export type ContractInvoiceInput = Static<typeof ContractInvoiceInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS contract_invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL
  );
`;

export type ContractInvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

export async function contractInvoiceAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<ContractInvoiceOutput> {
  const auth = requireAuth(session, ['billing']);

  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  const { Value } = await import('@sinclair/typebox/value');

  if (!Value.Check(ContractInvoiceInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as ContractInvoiceInput;

  const existing = await db.query<{ id: string }>('SELECT id FROM contract_invoices WHERE idempotency_key = $1', [
    input.idempotencyToken
  ]);

  if (existing.length > 0) {
    return Err('DUPLICATE_IDEMPOTENCY');
  }

  const customers = await db.query<{ id: string }>('SELECT id FROM contract_customers WHERE id = $1', [input.customerId]);

  if (customers.length === 0) {
    return Err('CUSTOMER_NOT_FOUND');
  }

  const totalWithTax = Math.round(input.amountCents * (1 + input.taxRate));
  const id = crypto.randomUUID();

  await db.query('INSERT INTO contract_invoices (id, customer_id, total_cents, idempotency_key) VALUES ($1, $2, $3, $4)', [
    id,
    input.customerId,
    totalWithTax,
    input.idempotencyToken
  ]);

  return Ok({ invoiceId: id, totalWithTax, status: 'GENERATED' });
}

export const sliceTests = {
  description: 'Invariantes da fatura de contrato (fixture do framework)',
  cases: [
    {
      name: 'sem sessão a ação recusa antes de tocar o banco',
      run: async () => {
        const db = new MockDatabaseClient();
        const result = await contractInvoiceAction(
          { customerId: 'cust-uuid-1234567890', amountCents: 100, taxRate: 0.1, idempotencyToken: 'idem-1234567890' },
          db
        );

        if (result.ok || result.error !== 'UNAUTHORIZED' || db.calls.length !== 0) {
          throw new Error('esperava UNAUTHORIZED sem consultar o banco');
        }
      }
    }
  ]
};
