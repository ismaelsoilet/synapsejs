import { describe, expect, it } from 'bun:test';
import { createSession, MockDatabaseClient } from '../src/index';
import { helloWorldAction } from '../templates/starter/src/slices/welcome/hello-world.slice.tsx';
import {
  ContractInvoiceInputSchema,
  contractInvoiceAction
} from './fixtures/contract-app/src/slices/contract/invoice.slice';

const billingSession = createSession({ userId: 'usr-1', roles: ['billing'] });
const viewerSession = createSession({ userId: 'usr-2', roles: ['viewer'] });

const validInvoice = {
  customerId: 'cust-uuid-1234567890',
  amountCents: 50000,
  taxRate: 0.1,
  idempotencyToken: 'idemp-key-123456'
};

function invoiceMock() {
  return new MockDatabaseClient()
    .onQuery(/SELECT id FROM contract_invoices/, () => [])
    .onQuery(/SELECT id FROM contract_customers/, () => [{ id: 'cust-uuid-1234567890' }])
    .onQuery(/INSERT INTO contract_invoices/, () => [{ id: 'inv-1' }]);
}

describe('contract fixture slice', () => {
  it('rejects anonymous callers before touching the database', async () => {
    const db = invoiceMock();

    const result = await contractInvoiceAction(validInvoice, db);

    expect(result).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    expect(db.calls.length).toBe(0);
  });

  it('rejects authenticated callers without the billing role', async () => {
    const result = await contractInvoiceAction(validInvoice, invoiceMock(), viewerSession);

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('computes the tax-inclusive total for valid input', async () => {
    const result = await contractInvoiceAction(validInvoice, invoiceMock(), billingSession);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalWithTax).toBe(55000);
      expect(result.value.status).toBe('GENERATED');
    }
  });

  it('rejects an out-of-range tax rate only after authorization passes', async () => {
    const result = await contractInvoiceAction(
      { ...validInvoice, taxRate: 0.9, idempotencyToken: 'idemp-key-abcdef' },
      invoiceMock(),
      billingSession
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });

  it('reports duplicate idempotency tokens', async () => {
    const db = new MockDatabaseClient().onQuery(/SELECT id FROM contract_invoices/, () => [{ id: 'inv-existing' }]);

    const result = await contractInvoiceAction(validInvoice, db, billingSession);

    expect(result).toEqual({ ok: false, error: 'DUPLICATE_IDEMPOTENCY' });
  });

  it('reports unknown customers', async () => {
    const db = new MockDatabaseClient()
      .onQuery(/SELECT id FROM contract_invoices/, () => [])
      .onQuery(/SELECT id FROM contract_customers/, () => []);

    const result = await contractInvoiceAction(validInvoice, db, billingSession);

    expect(result).toEqual({ ok: false, error: 'CUSTOMER_NOT_FOUND' });
  });

  it('exposes the input contract for the client', () => {
    expect(Object.keys(ContractInvoiceInputSchema.properties).sort()).toEqual([
      'amountCents',
      'customerId',
      'idempotencyToken',
      'taxRate'
    ]);
  });
});

describe('hello-world template slice', () => {
  it('greets the submitted name', async () => {
    const result = await helloWorldAction({ name: 'Ismael' }, new MockDatabaseClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.greeting).toContain('Ismael');
    }
  });

  it('rejects names outside the contract', async () => {
    const result = await helloWorldAction({ name: 'X' }, new MockDatabaseClient());

    expect(result).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });
});
