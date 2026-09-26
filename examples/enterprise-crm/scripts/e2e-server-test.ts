/**
 * SynapseJS v0.6.0 - Live E2E HTTP, SSR, RPC, Auth & Database Integration Test Suite
 */

import { SynapseServer } from 'synapsejs';

const TEST_PORT = 3456;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Credenciais fixas do e2e (fixture local, não são segredo real)
const BILLING_AUTH_HEADERS = {
  ...JSON_HEADERS,
  Authorization: 'Bearer syn_live_secret_jwt_token_42',
  'x-user-id': 'usr_admin_e2e_01',
  'x-user-roles': 'admin,billing'
};

async function runE2ETests() {
  console.log('🚀 [E2E] Inicializando SynapseServer na porta', TEST_PORT);
  const serverInstance = new SynapseServer(process.cwd(), TEST_PORT);
  await serverInstance.discoverSlices();
  const server = await serverInstance.start();

  try {
    // 1. Health check
    console.log('🧪 [1] Testando GET /_synapse/api/health...');
    const healthRes = await fetch(`${BASE_URL}/_synapse/api/health`);
    const healthData = await healthRes.json();
    console.log('   Health response:', healthData);
    if (healthData.status !== 'OK' || healthData.slicesLoaded < 3) {
      throw new Error(`Falha no health check: esperado >=3 fatias, obteve ${healthData.slicesLoaded}`);
    }

    // 2. Repo-map endpoint
    console.log('🧪 [2] Testando GET /_synapse/api/repo-map...');
    const repoMapRes = await fetch(`${BASE_URL}/_synapse/api/repo-map`);
    if (repoMapRes.status === 200) {
      const repoMapText = await repoMapRes.text();
      console.log(`   Repo-map OK (${repoMapText.length} bytes)`);
    } else {
      console.log('   Repo-map status:', repoMapRes.status, '(não gerado ainda ou ausente)');
    }

    // 3. Hub Dashboard
    console.log('🧪 [3] Testando GET / (Dashboard Hub)...');
    const hubRes = await fetch(`${BASE_URL}/`);
    const hubHtml = await hubRes.text();
    if (!hubHtml.includes('Hub de Fatias Verticais')) {
      throw new Error('Falha ao renderizar Dashboard Hub');
    }
    console.log('   Dashboard Hub OK (status 200)');

    // 4. SSR UI Routes
    console.log('🧪 [4] Testando SSR UI de Fatias...');
    const customerUiRes = await fetch(`${BASE_URL}/customers/create-customer`);
    const customerUiHtml = await customerUiRes.text();
    if (!customerUiHtml.includes('Cadastro de Cliente')) {
      throw new Error('Falha no SSR de create-customer');
    }
    console.log('   SSR create-customer OK (status 200)');

    const productUiRes = await fetch(`${BASE_URL}/products/create-product`);
    const productUiHtml = await productUiRes.text();
    if (!productUiHtml.includes('create-product')) {
      throw new Error('Falha no SSR de create-product');
    }
    console.log('   SSR create-product OK (status 200)');

    const invoiceUiRes = await fetch(`${BASE_URL}/billing/generate-invoice`);
    const invoiceUiHtml = await invoiceUiRes.text();
    if (!invoiceUiHtml.includes('generate-invoice')) {
      throw new Error('Falha no SSR de generate-invoice');
    }
    console.log('   SSR generate-invoice OK (status 200)');

    // 5. RPC Action: Create Customer
    console.log('🧪 [5] Testando POST /_synapse/rpc/create-customer...');
    const email = `e2e-cust-${Date.now()}@dominio.com`;
    const taxId = `tax-${Date.now()}`;
    const createCustomerRes = await fetch(`${BASE_URL}/_synapse/rpc/create-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cliente E2E v0.6.0',
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

    // 6. RPC Action: Duplicate Email check
    console.log('🧪 [6] Testando POST /_synapse/rpc/create-customer (Duplicidade)...');
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
    console.log('   Duplicate customer check result:', dupResult);
    if (dupResult.ok || dupResult.error !== 'DUPLICATE_EMAIL') {
      throw new Error('Falha ao rejeitar e-mail duplicado');
    }

    // 7. RPC Action: Create Product
    console.log('🧪 [7] Testando POST /_synapse/rpc/create-product...');
    const productEmail = `prod-${Date.now()}@loja.com`;
    const createProductRes = await fetch(`${BASE_URL}/_synapse/rpc/create-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Plano Enterprise AI',
        email: productEmail
      })
    });
    const productResult = await createProductRes.json();
    console.log('   Create product result:', productResult);
    if (!productResult.ok || !productResult.value.id) {
      throw new Error('Falha ao criar produto via RPC');
    }

    // 8. RPC Action: Generate Invoice with Session Context & Auth Headers
    console.log('🧪 [8] Testando POST /_synapse/rpc/generate-invoice (com Auth Headers)...');
    const idempToken = `idemp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const invoiceRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: BILLING_AUTH_HEADERS,
      body: JSON.stringify({
        customerId,
        amountCents: 50000,
        taxRate: 0.10,
        idempotencyToken: idempToken
      })
    });
    const invoiceResult = await invoiceRes.json();
    console.log('   Invoice result:', invoiceResult);
    if (!invoiceResult.ok || invoiceResult.value.totalWithTax !== 55000) {
      throw new Error(`Falha ao emitir fatura: esperado 55000, obteve ${JSON.stringify(invoiceResult)}`);
    }

    // 9. RPC Action: Duplicate Idempotency on Invoice
    console.log('🧪 [9] Testando POST /_synapse/rpc/generate-invoice (Idempotência)...');
    const dupInvoiceRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: BILLING_AUTH_HEADERS,
      body: JSON.stringify({
        customerId,
        amountCents: 50000,
        taxRate: 0.10,
        idempotencyToken: idempToken
      })
    });
    const dupInvoiceData = await dupInvoiceRes.json();
    console.log('   Duplicate idempotency result:', dupInvoiceData);
    if (dupInvoiceData.ok || dupInvoiceData.error !== 'DUPLICATE_IDEMPOTENCY') {
      throw new Error('Falha ao rejeitar token de idempotência duplicado');
    }

    // 10. RPC Action: Non-existent Customer validation
    console.log('🧪 [10] Testando POST /_synapse/rpc/generate-invoice (Cliente Inexistente)...');
    const missingCustRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: BILLING_AUTH_HEADERS,
      body: JSON.stringify({
        customerId: 'cust-inexistente-99999',
        amountCents: 10000,
        taxRate: 0.10,
        idempotencyToken: `token-${Date.now()}`
      })
    });
    const missingCustData = await missingCustRes.json();
    console.log('   Missing customer result:', missingCustData);
    if (missingCustData.ok || missingCustData.error !== 'CUSTOMER_NOT_FOUND') {
      throw new Error('Falha ao rejeitar cliente inexistente');
    }

    // 11. RBAC: sem credenciais a action recusa
    console.log('🧪 [11] Testando POST /_synapse/rpc/generate-invoice (sem credenciais)...');
    const anonymousRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        customerId,
        amountCents: 1000,
        taxRate: 0.10,
        idempotencyToken: `anon-${Date.now()}`
      })
    });
    const anonymousData = await anonymousRes.json();
    console.log('   Anonymous result:', anonymousData, 'HTTP', anonymousRes.status);
    if (anonymousData.ok || anonymousData.error !== 'UNAUTHORIZED') {
      throw new Error(`Falha no RBAC: esperava UNAUTHORIZED sem credenciais, obteve ${JSON.stringify(anonymousData)}`);
    }
    if (anonymousRes.status !== 400) {
      throw new Error(`Falha no RBAC: esperava HTTP 400, obteve ${anonymousRes.status}`);
    }

    // 12. RBAC: sessão autenticada sem o papel exigido recebe FORBIDDEN
    console.log('🧪 [12] Testando POST /_synapse/rpc/generate-invoice (papel insuficiente)...');
    const forbiddenRes = await fetch(`${BASE_URL}/_synapse/rpc/generate-invoice`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        Authorization: 'Bearer syn_live_secret_jwt_token_42',
        'x-user-id': 'usr_viewer_e2e_02',
        'x-user-roles': 'viewer'
      },
      body: JSON.stringify({
        customerId,
        amountCents: 1000,
        taxRate: 0.10,
        idempotencyToken: `viewer-${Date.now()}`
      })
    });
    const forbiddenData = await forbiddenRes.json();
    console.log('   Forbidden result:', forbiddenData);
    if (forbiddenData.ok || forbiddenData.error !== 'FORBIDDEN') {
      throw new Error(`Falha no RBAC: esperava FORBIDDEN para papel sem 'billing', obteve ${JSON.stringify(forbiddenData)}`);
    }

    console.log('\n🎉 [E2E SUCCESS] Todos os 12 testes de integração (SSR, RPC, RBAC, Idempotência e Multi-Slices) foram APROVADOS com 100% de sucesso!');
  } finally {
    server.stop();
    console.log('🛑 [E2E] Servidor Bun encerrado.');
  }
}

runE2ETests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ [E2E FAILED]:', err);
    process.exit(1);
  });

