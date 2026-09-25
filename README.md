# SynapseJS ⚡ (v0.3.0)

> **The Machine-Centric Fullstack Framework & Agentic OS designed from the ground up for Autonomous AI Coding Agents.**

---

## 📖 Visão Geral e Paradigma

Durante mais de meio século, os paradigmas de engenharia de software (Clean Code, MVC horizontal, DDD dogmático e DRY) foram concebidos para mitigar a limitação biológica da memória humana ($\text{Lei de Miller: } 7 \pm 2$ itens). 

Para **Modelos de Linguagem de Grande Porte (LLMs)** e agentes autônomos, esses paradigmas geram **dívida arquitetural profunda**:
* **Dispersão de Atenção:** Saltos entre 5 arquivos distintos para alterar uma única regra fragmentam o mecanismo de Self-Attention (*Lost in the Middle*).
* **Decaimento Exponencial:** A probabilidade de acerto composto da IA cai drasticamente conforme o número de arquivos tocados ($N$) aumenta:
  $$P(\text{sucesso}) = \left(\prod_{i=1}^N p_i\right) \cdot (1 - \epsilon_{\text{interf}})^{N - 1}$$
* **A Armadilha do DRY:** Refatorações "limpas" em utilitários globais geram efeitos colaterais imprevistos (*blast radius*) que quebram domínios distantes.

**SynapseJS inverte essa lógica.** É um framework otimizado matematicamente para o menor atrito cognitivo da máquina:
1. **Vertical Slices com Locality of Behavior (LoB):** Contrato de validação JIT, schema DDL declarativo, lógica de banco, componente React, injeção de segurança e testes oráculo residem no mesmo arquivo contíguo ($N = 1$).
2. **Erradicação do `throw Error`:** Fluxo de controle puramente funcional com Tipos Algébricos e Uniões Discriminadas `Result<T, E>`.
3. **SessionContext & RBAC Explícito:** Eliminação de variáveis de ambiente e reflexão oculta. Injeção determinística de sessão `(session?: SessionContext)` diretamente nas Server Actions com helpers funcionais (`requireAuth`, `hasRole`).
4. **Validação JIT via TypeBox:** Validações ultra-rápidas em tempo de execução sem inflar a memória do TypeScript Language Server.
5. **Auto-Migração Declarativa via AST:** O compilador extrai `export const sliceSchema` de cada fatia e orquestra a aplicação idempotente com rastreamento via tabela `_synapse_migrations`.
6. **Multi-Database Universal Engine:** Conector agnóstico com suporte nativo a SQLite embutido de altíssimo desempenho (modo WAL) e PostgreSQL em pool (`postgres.js`), ativado dinamicamente via `DATABASE_URL`.
7. **Fast-Check PBT (Property-Based Testing):** Oráculos matemáticos auto-contidos que testam centenas de casos limites e invariantes de negócio automaticamente.
8. **AST Daemon & Skeletonizer:** Daemon nativo baseado no TypeScript Compiler API que comprime a arquitetura inteira em assinaturas exportadas (`.codebase/repo-map.d.ts`), garantindo $< 3.000$ tokens no contexto da IA.
9. **Fast Incremental Diagnostics (<200ms):** Diagnósticos baseados em `ts.createIncrementalProgram` com cache em `.synapse/.tsbuildinfo` retornando coordenadas JSON exatas `(file, line, col, code, message)` para auto-cura sem travamento.
10. **Native Model Context Protocol (MCP) Server:** Servidor JSON-RPC 2.0 stdio expondo 5 ferramentas nativas para IDEs e agentes autônomos (`synapse_get_repo_map`, `synapse_check`, `synapse_run_pbt`, `synapse_scaffold_slice`, `synapse_migrate`).
11. **Isomorphic Slice Splitter:** Compilador AST que particiona a fatia em bundles de servidor e cliente, garantindo que queries SQL e credenciais nunca vazem para o browser.

---

## 📂 Topologia do Repositório (v0.3.0 Monorepo)

```text
/home/ismaelsoilet/synapsejs/
├── packages/
│   └── synapse/                        # Pacote oficial publicado (synapsejs)
│       ├── bin/synapse.ts              # Agent-CLI nativo v0.3.0
│       ├── src/
│       │   ├── core/                   # Kernel: Result<T,E>, SessionContext, Multi-DB
│       │   ├── compiler/               # Fast-Diagnostics, AST Splitter, Scaffolder, Migrator
│       │   ├── runtime/                # Bun.serve, Zero-Wiring Router, SSR HTML Shell
│       │   ├── mcp/                    # Servidor nativo Model Context Protocol (stdio)
│       │   └── index.ts                # Entrypoint canônico do SDK
│       ├── templates/starter/          # Template oficial embutido para 'synapse new'
│       ├── package.json
│       └── README.md
├── templates/
│   └── starter/                        # Template independente para novos projetos
│       ├── src/slices/welcome/
│       │   └── hello-world.slice.tsx   # Fatia inaugural de boas-vindas
│       └── package.json
├── examples/
│   └── enterprise-crm/                 # Suíte de referência de produção
│       ├── .codebase/
│       │   ├── repo-map.d.ts           # Skeleton map (< 3.000 tokens)
│       │   └── architecture-graph.json # Grafo de fatias
│       ├── src/slices/                 # Fatias Verticais Atômicas (N = 1)
│       │   ├── billing/generate-invoice.slice.tsx
│       │   ├── customers/create-customer.slice.tsx
│       │   └── products/create-product.slice.tsx
│       ├── scripts/
│       │   └── e2e-server-test.ts      # 10 testes de integração E2E ao vivo
│       └── package.json
├── bin/synapse.ts                      # CLI proxy na raiz
├── .github/workflows/ci.yml            # CI automatizado no GitHub Actions
├── package.json                        # Workspaces monorepo
├── tsconfig.json
├── LICENSE
└── README.md
```

---

## ⚡ Anatomia Canônica de uma Fatia (`.slice.tsx`)

Toda a funcionalidade de ponta a ponta reside num único arquivo contíguo:

```tsx
import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import { 
  type DatabaseClient, 
  Result, 
  Ok, 
  Err, 
  type SessionContext, 
  requireAuth 
} from 'synapsejs';

// 1. CONTRATO DE ENTRADA JIT
export const InvoiceInputSchema = Type.Object({
  customerId: Type.String({ minLength: 10 }),
  amountCents: Type.Integer({ minimum: 1 }),
  taxRate: Type.Number({ minimum: 0, maximum: 0.3 }),
  idempotencyToken: Type.String({ minLength: 12 })
});
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

// DDL DECLARATIVO DA FATIA (Auto-migrado via AST)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    base_cents INTEGER NOT NULL,
    tax_rate REAL NOT NULL,
    total_cents INTEGER NOT NULL,
    idempotency_key TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// 2. MODELAGEM ESTRITA DE DOMÍNIO
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND' | 'UNAUTHORIZED'
>;

// 3. EXECUÇÃO DE SERVIDOR PURA COM INJEÇÃO DE SESSÃO (SERVER ACTION)
export async function createInvoiceAction(
  payload: unknown,
  db: DatabaseClient,
  session?: SessionContext
): Promise<InvoiceOutput> {
  // Injeção de Segurança sem reflexão oculta
  // const auth = requireAuth(session, ['billing']);
  // if (!auth.ok) return Err('UNAUTHORIZED');

  if (!Value.Check(InvoiceInputSchema, payload)) return Err('INVALID_SCHEMA');
  const input = payload as InvoiceInput;
  const total = input.amountCents + Math.round(input.amountCents * input.taxRate);

  const existCheck = await db.query(`SELECT id FROM invoices WHERE idempotency_key = $1`, [input.idempotencyToken]);
  if (existCheck.length > 0) return Err('DUPLICATE_IDEMPOTENCY');

  const customerCheck = await db.query(`SELECT id FROM customers WHERE id = $1`, [input.customerId]);
  if (customerCheck.length === 0) return Err('CUSTOMER_NOT_FOUND');

  const result = await db.query<{ id: string }>(
    `INSERT INTO invoices (id, customer_id, base_cents, tax_rate, total_cents, idempotency_key) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [crypto.randomUUID(), input.customerId, input.amountCents, input.taxRate, total, input.idempotencyToken]
  );

  return Ok({ invoiceId: result[0]?.id ?? 'inv-generated', totalWithTax: total, status: 'GENERATED' });
}

// 4. COMPONENTE UI REACT
export function InvoiceTrigger({ customerId, onSubmitAction }: { customerId: string; onSubmitAction?: Function }) {
  return <form onSubmit={...}>...</form>;
}

// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT
export const sliceTests = {
  description: 'Verificação PBT de invariantes',
  run: async () => {
    fc.assert(fc.asyncProperty(...));
  }
};
```

---

## 🤖 Comandos do Agent-CLI

Desenvolvidos com saídas JSON para integração determinística com agentes de IA:

```bash
# 1. Iniciar servidor HTTP Zero-Wiring com auto-migração, SSR e Hub
bun run dev

# 2. Executar migrações declarativas (sliceSchema) no banco ativo
bun run migrate

# 3. Iniciar Servidor Nativo Model Context Protocol (MCP) para IA via stdio
bun run mcp

# 4. Checagem incremental de tipos ultra-rápida com cache (<200ms)
bun run check:fast

# 5. Checagem sintática e semântica padrão
bun run check

# 6. Esqueletização do repositório para injeção de contexto (< 3.000 tokens)
bun run skeleton

# 7. Execução dos testes oráculo PBT em tempo real
bun run test

# 8. Suíte de integração E2E ao vivo (HTTP, SSR, RPC, Auth, SQLite)
bun run test:e2e

# 9. Particionamento seguro em bundles Client e Server
bun run split

# 10. Gerar nova fatia atômica padronizada
bun run new-slice <domain> <name>
# Exemplo: bun run new-slice orders process-checkout

# 11. Metadados e inspeção do framework
bun run cli info
```

---

## 🔌 Ferramentas Nativas do Servidor MCP

O comando `bun run mcp` expõe via JSON-RPC 2.0 (`stdio`):

| Ferramenta | Descrição |
| :--- | :--- |
| `synapse_get_repo_map` | Obtém o esqueleto comprimido do repositório (`< 3.000` tokens) para contexto imediato da IA. |
| `synapse_check` | Executa diagnóstico do compilador retornando coordenadas exatas JSON `(file, line, col, message)`. |
| `synapse_run_pbt` | Dispara a suíte de Property-Based Testing (Fast-Check) em todas as fatias. |
| `synapse_scaffold_slice` | Cria nova fatia vertical com validação JIT, schema, ação, UI e testes PBT. |
| `synapse_migrate` | Descobre via AST e aplica as definições `sliceSchema` no banco configurado. |

---

## 🛡️ Isolamento Client / Server

Quando `synapse split` é executado:
* `.synapse/dist/server/:slice.server.ts`: Contém as queries de banco de dados, chaves e lógica sensível.
* `.synapse/dist/client/:slice.client.tsx`: Contém apenas o JSX visual e uma chamada transparente `fetch('/_synapse/rpc/:name')`.
* Nenhuma credencial ou query de banco atinge o navegador.

---

## 🚀 Licença

MIT License. Projetado para acelerar o desenvolvimento autônomo por agentes de IA.

