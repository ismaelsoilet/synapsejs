import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as path from 'path';
import { SynapseServer } from '../src/runtime/server';

/**
 * The full path, in the suite: HTTP → SSR → RPC → real SQLite write → role rejection.
 *
 * This is the roundtrip that used to live in a loose example script with hand-rolled
 * checks: it now runs under `bun test`, asserts with the test framework, verifies the
 * write by reading the row back from the database, and binds an ephemeral port.
 */
const appDir = path.resolve(import.meta.dir, '../../../examples/enterprise-crm');

let server: SynapseServer;
let base = '';

beforeAll(async () => {
  process.env.SYNAPSE_DEV_HEADERS = 'true';

  server = new SynapseServer(appDir, 0);
  await server.discoverSlices();
  await server.start();
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.stop(1000);
});

const jsonHeaders = { 'Content-Type': 'application/json' };
const billingHeaders = { ...jsonHeaders, 'x-user-id': 'usr_admin_e2e', 'x-user-roles': 'admin,billing' };

describe('end-to-end roundtrip against a real engine', () => {
  it('serves the health verdict with the discovered slices', async () => {
    const response = await fetch(`${base}/_synapse/api/health`);
    const body = (await response.json()) as { status: string; slicesLoaded: number; database: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('OK');
    expect(body.database).toBe('connected');
    expect(body.slicesLoaded).toBeGreaterThanOrEqual(3);
  });

  it('renders a slice page whose markup comes from the database', async () => {
    const response = await fetch(`${base}/customers/create-customer`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Cadastro de Cliente');
    expect(html).toContain('create-customer');
  });

  it('persists a row through RPC and reads it back from SQLite', async () => {
    const email = `e2e-${Date.now()}@dominio.com`;
    const response = await fetch(`${base}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Cliente E2E', email, taxId: `tax-${Date.now()}` })
    });

    const body = (await response.json()) as { ok: boolean; value?: { customerId: string } };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);

    // The write is verified against the engine, not against the action's own answer.
    const rows = await server.database.query<{ id: string; email: string }>(
      'SELECT id, email FROM customers WHERE email = $1',
      [email]
    );

    expect(rows.length).toBe(1);
    expect(body.value).toBeDefined();

    const createdId = (body.value as { customerId: string }).customerId;
    expect(rows[0].id).toBe(createdId);
  });

  it('refuses a duplicate email with the domain error mapped to 409', async () => {
    const email = `dupe-${Date.now()}@dominio.com`;
    const payload = JSON.stringify({ name: 'Cliente Duplicado', email, taxId: `tax-${Date.now()}` });

    const first = await fetch(`${base}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: jsonHeaders,
      body: payload
    });
    expect(first.status).toBe(200);

    const duplicate = await fetch(`${base}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Outro Nome', email, taxId: `tax-${Date.now().toString().slice(-8)}` })
    });

    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: string }).error).toBe('DUPLICATE_EMAIL');
  });

  it('computes the invoice total from persisted data and rejects a replayed idempotency token', async () => {
    const email = `invoice-${Date.now()}@dominio.com`;
    const created = await fetch(`${base}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Cliente Fatura', email, taxId: `tax-${Date.now()}` })
    });
    const customerId = ((await created.json()) as { value: { customerId: string } }).value.customerId;

    const idempotencyToken = `idemp-${Date.now()}`;
    const invoiceBody = JSON.stringify({ customerId, amountCents: 50_000, taxRate: 0.1, idempotencyToken });

    const invoice = await fetch(`${base}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: billingHeaders,
      body: invoiceBody
    });
    const invoiceResult = (await invoice.json()) as { ok: boolean; value?: { totalWithTax: number } };

    expect(invoiceResult.ok).toBe(true);
    expect(invoiceResult.value?.totalWithTax).toBe(55_000);

    const replay = await fetch(`${base}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: billingHeaders,
      body: invoiceBody
    });

    expect(replay.status).toBe(409);
    expect(((await replay.json()) as { error: string }).error).toBe('DUPLICATE_IDEMPOTENCY');
  });

  it('rejects an anonymous caller with 401 and a session without the role with 403', async () => {
    const payload = JSON.stringify({
      customerId: 'cust-qualquer',
      amountCents: 1000,
      taxRate: 0.1,
      idempotencyToken: `x-${Date.now()}`
    });

    const anonymous = await fetch(`${base}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: jsonHeaders,
      body: payload
    });

    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { error: string }).error).toBe('UNAUTHORIZED');

    const viewer = await fetch(`${base}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-user-id': 'usr_viewer', 'x-user-roles': 'viewer' },
      body: payload
    });

    expect(viewer.status).toBe(403);
    expect(((await viewer.json()) as { error: string }).error).toBe('FORBIDDEN');
  });

  it('serves the hub dashboard', async () => {
    const response = await fetch(`${base}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Hub de Fatias Verticais');
  });
});
