import { describe, expect, it } from 'bun:test';
import {
  createInvoiceAction,
  InvoiceInputSchema
} from '../../../examples/enterprise-crm/src/slices/billing/generate-invoice.slice.tsx';
import { createCustomerAction } from '../../../examples/enterprise-crm/src/slices/customers/create-customer.slice.tsx';
import { createProductAction } from '../../../examples/enterprise-crm/src/slices/products/create-product.slice.tsx';
import { createSession, MockDatabaseClient } from '../src/index';
import { helloWorldAction } from '../templates/starter/src/slices/welcome/hello-world.slice.tsx';

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
    .onQuery(/SELECT id FROM invoices/, () => [])
    .onQuery(/SELECT id FROM customers/, () => [{ id: 'cust-uuid-1234567890' }])
    .onQuery(/INSERT INTO invoices/, () => [{ id: 'inv-1' }]);
}

describe('generate-invoice slice', () => {
  it('rejects anonymous callers before touching the database', async () => {
    const db = invoiceMock();

    const result = await createInvoiceAction(validInvoice, db);

    expect(result).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    expect(db.calls.length).toBe(0);
  });

  it('rejects authenticated callers without the billing role', async () => {
    const result = await createInvoiceAction(validInvoice, invoiceMock(), viewerSession);

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('computes the tax-inclusive total for valid input', async () => {
    const result = await createInvoiceAction(validInvoice, invoiceMock(), billingSession);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalWithTax).toBe(55000);
      expect(result.value.status).toBe('GENERATED');
    }
  });

  it('rejects an out-of-range tax rate only after authorization passes', async () => {
    const result = await createInvoiceAction(
      { ...validInvoice, taxRate: 0.9, idempotencyToken: 'idemp-key-abcdef' },
      invoiceMock(),
      billingSession
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });

  it('reports duplicate idempotency tokens', async () => {
    const db = new MockDatabaseClient()
      .onQuery(/SELECT id FROM invoices/, () => [{ id: 'existing' }])
      .onQuery(/SELECT id FROM customers/, () => [{ id: 'cust-uuid-1234567890' }]);

    const result = await createInvoiceAction(validInvoice, db, billingSession);

    expect(result).toEqual({ ok: false, error: 'DUPLICATE_IDEMPOTENCY' });
  });

  it('reports unknown customers', async () => {
    const db = new MockDatabaseClient()
      .onQuery(/SELECT id FROM invoices/, () => [])
      .onQuery(/SELECT id FROM customers/, () => []);

    const result = await createInvoiceAction(validInvoice, db, billingSession);

    expect(result).toEqual({ ok: false, error: 'CUSTOMER_NOT_FOUND' });
  });

  it('exposes the input contract for the client', () => {
    expect(Object.keys(InvoiceInputSchema.properties).sort()).toEqual([
      'amountCents',
      'customerId',
      'idempotencyToken',
      'taxRate'
    ]);
  });
});

describe('create-customer slice', () => {
  it('rejects names that are too short', async () => {
    const result = await createCustomerAction(
      { name: 'ab', email: 'valid@test.com', taxId: '12345678' },
      new MockDatabaseClient()
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });

  it('rejects malformed e-mail addresses', async () => {
    const result = await createCustomerAction(
      { name: 'Cliente Valido', email: 'not-an-email', taxId: '12345678' },
      new MockDatabaseClient()
    );

    expect(result).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });

  it('reports duplicate e-mails', async () => {
    const db = new MockDatabaseClient().onQuery(/SELECT id FROM customers WHERE email/, () => [{ id: 'dup' }]);

    const result = await createCustomerAction({ name: 'Cliente Valido', email: 'dup@test.com', taxId: '12345678' }, db);

    expect(result).toEqual({ ok: false, error: 'DUPLICATE_EMAIL' });
  });

  it('reports duplicate tax ids', async () => {
    const db = new MockDatabaseClient()
      .onQuery(/SELECT id FROM customers WHERE email/, () => [])
      .onQuery(/SELECT id FROM customers WHERE tax_id/, () => [{ id: 'dup' }]);

    const result = await createCustomerAction(
      { name: 'Cliente Valido', email: 'novo@test.com', taxId: '12345678' },
      db
    );

    expect(result).toEqual({ ok: false, error: 'DUPLICATE_TAX_ID' });
  });

  it('activates a valid customer', async () => {
    const db = new MockDatabaseClient().onQuery(/SELECT id FROM customers/, () => []);

    const result = await createCustomerAction(
      { name: 'Cliente Valido', email: 'novo@test.com', taxId: '12345678' },
      db
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ACTIVE');
    }
  });
});

describe('create-product slice', () => {
  it('rejects short names', async () => {
    const result = await createProductAction({ name: 'a', email: 'prod@loja.com' }, new MockDatabaseClient());

    expect(result).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });

  it('reports duplicate e-mails', async () => {
    const db = new MockDatabaseClient().onQuery(/SELECT id FROM products/, () => [{ id: 'dup' }]);

    const result = await createProductAction({ name: 'Plano Enterprise', email: 'dup@loja.com' }, db);

    expect(result).toEqual({ ok: false, error: 'DUPLICATE_EMAIL' });
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
