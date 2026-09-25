/**
 * SynapseJS - Live E2E HTTP & Database Integration Test
 */

import { SynapseServer } from '../src/runtime/server';

const TEST_PORT = 3456;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runE2ETests() {
  console.log('🚀 [E2E] Inicializando SynapseServer na porta', TEST_PORT);
  const serverInstance = new SynapseServer(process.cwd(), TEST_PORT);
  await serverInstance.discoverSlices();
  const server = serverInstance.start();

  try {
    // 1. Health check
    console.log('🧪 [1] Testando GET /_synapse/api/health...');
    const healthRes = await fetch(`${BASE_URL}/_synapse/api/health`);
    const healthData = await healthRes.json();
    console.log('   Health response:', healthData);
    if (healthData.status !== 'OK' || healthData.slicesLoaded < 2) {
      throw new Error('Falha no health check');
    }

    // 2. Hub Dashboard
    console.log('🧪 [2] Testando GET / (Dashboard Hub)...');
    const hubRes = await fetch(`${BASE_URL}/`);
    const hubHtml = await hubRes.text();
    if (!hubHtml.includes('Hub de Fatias Verticais')) {
      throw new Error('Falha ao renderizar Dashboard');
    }
    console.log('   Dashboard OK (status 200)');

    // 3. UI Route for create-customer
    console.log('🧪 [3] Testando GET /customers/create-customer (SSR HTML)...');
    const customerUiRes = await fetch(`${BASE_URL}/customers/create-customer`);
    const customerUiHtml = await customerUiRes.text();
    if (!customerUiHtml.includes('Cadastro de Cliente')) {
      throw new Error('Falha no SSR de create-customer');
    }
    console.log('   SSR UI OK (status 200)');

    // 4. RPC Action: Create Customer
    console.log('🧪 [4] Testando POST /_synapse/rpc/create-customer...');
    const email = `test-${Date.now()}@dominio.com`;
    const taxId = `tax-${Date.now()}`;
    const createCustomerRes = await fetch(`${BASE_URL}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cliente E2E Automatizado',
        email,
        taxId
      })
    });
    const customerResult = await createCustomerRes.json();
    console.log('   Create customer result:', customerResult);
    if (!customerResult.ok || !customerResult.value.customerId) {
      throw new Error('Falha ao criar cliente via RPC');
    }
    const customerId = customerResult.value.customerId;

    // 5. RPC Action: Duplicate Email check
    console.log('🧪 [5] Testando POST /_synapse/rpc/create-customer (Duplicidade)...');
    const dupCustomerRes = await fetch(`${BASE_URL}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Outro Nome',
        email,
        taxId: `tax-${Date.now() % 1000000}`
      })
    });
    const dupResult = await dupCustomerRes.json();
    console.log('   Duplicate check result:', dupResult);
    if (dupResult.ok || dupResult.error !== 'DUPLICATE_EMAIL') {
      throw new Error('Falha ao rejeitar e-mail duplicado');
    }

    // 6. RPC Action: Generate Invoice for this customer
    console.log('🧪 [6] Testando POST /_synapse/rpc/generate-invoice...');
    const idempToken = `idemp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const invoiceRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId,
        amountCents: 20000,
        taxRate: 0.15,
        idempotencyToken: idempToken
      })
    });
    const invoiceResult = await invoiceRes.json();
    console.log('   Invoice result:', invoiceResult);
    if (!invoiceResult.ok || invoiceResult.value.totalWithTax !== 23000) {
      throw new Error('Falha ao emitir fatura');
    }

    // 7. RPC Action: Duplicate Idempotency on Invoice
    console.log('🧪 [7] Testando POST /_synapse/rpc/generate-invoice (Idempotência)...');
    const dupInvoiceRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId,
        amountCents: 20000,
        taxRate: 0.15,
        idempotencyToken: idempToken
      })
    });
    const dupInvoiceData = await dupInvoiceRes.json();
    console.log('   Duplicate idempotency result:', dupInvoiceData);
    if (dupInvoiceData.ok || dupInvoiceData.error !== 'DUPLICATE_IDEMPOTENCY') {
      throw new Error('Falha ao rejeitar token de idempotência duplicado');
    }

    console.log('\n🎉 [E2E SUCCESS] Todos os testes de integração HTTP, SSR, RPC e SQLite passaram com perfeição!');
  } finally {
    server.stop();
    console.log('🛑 [E2E] Servidor encerrado.');
  }
}

runE2ETests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ [E2E FAILED]:', err);
    process.exit(1);
  });
