# SynapseJS ⚡

> **The Machine-Centric Fullstack Framework designed from the ground up for Autonomous AI Coding Agents.**

---

## 📖 Visão Geral e Paradigma

Durante mais de meio século, os paradigmas de engenharia de software (Clean Code, MVC horizontal, DDD dogmático e DRY) foram concebidos para mitigar a limitação biológica da memória humana ($\text{Lei de Miller: } 7 \pm 2$ itens). 

Para **Modelos de Linguagem de Grande Porte (LLMs)** e agentes autônomos, esses paradigmas geram **dívida arquitetural profunda**:
* **Dispersão de Atenção:** Saltos entre 5 arquivos distintos para alterar uma única regra fragmentam o mecanismo de Self-Attention (*Lost in the Middle*).
* **Decaimento Exponencial:** A probabilidade de acerto composto da IA cai drasticamente conforme o número de arquivos tocados ($N$) aumenta:
  $$P(\text{sucesso}) = \left(\prod_{i=1}^N p_i\right) \cdot (1 - \epsilon_{\text{interf}})^{N - 1}$$
* **A Armadilha do DRY:** Refatorações "limpas" em utilitários globais geram efeitos colaterais imprevistos (*blast radius*) que quebram domínios distantes.

**SynapseJS inverte essa lógica.** É um framework otimizado matematicamente para o menor atrito cognitivo da máquina:
1. **Vertical Slices com Locality of Behavior (LoB):** Contrato de validação JIT, lógica de banco, componente React e testes oráculo residem no mesmo arquivo contíguo ($N = 1$).
2. **Erradicação do `throw Error`:** Fluxo de controle puramente funcional com Tipos Algébricos e Uniões Discriminadas `Result<T, E>`.
3. **Validação JIT via TypeBox:** Validações em tempo de compilação sem sobrecarregar a memória do Language Server.
4. **Fast-Check PBT (Property-Based Testing):** Oráculos matemáticos que testam milhares de casos limites automaticamente.
5. **AST Daemon & Skeletonizer:** Daemon nativo baseado no TypeScript Compiler API que comprime a arquitetura inteira em assinaturas exportadas (`.codebase/repo-map.d.ts`), estabilizando o consumo de tokens em $< 3.000$ tokens.
6. **Agent-CLI & JSON Diagnostics:** Respostas headless puramente em JSON com coordenadas de erro exatas `(file, line, col, code, message)` para auto-correção determinística em $< 500$ms.
7. **Isomorphic Slice Splitter:** Compilador AST que particiona a fatia em bundles de servidor e cliente, garantindo que queries SQL e credenciais nunca vazem para o browser.

---

## 📂 Topologia do Repositório

```text
/home/ismaelsoilet/synapsejs/
├── .codebase/
│   ├── repo-map.d.ts                   # Skeleton map comprimido (< 3.000 tokens)
│   └── architecture-graph.json         # Grafo de fatias e metadados
├── src/
│   ├── core/
│   │   ├── machine-types.ts            # Result<T, E>, Ok, Err, Option<T>
│   │   ├── database-client.ts          # Abstração de persistência tipada & Mock PBT
│   │   └── index.ts                    # Re-exportações do kernel
│   ├── slices/
│   │   └── billing/
│   │       └── generate-invoice.slice.tsx  # Fatia Atômica Fullstack (N = 1)
│   └── compiler/
│       └── slice-splitter.ts           # Separador AST Client/Server
├── scripts/
│   ├── ast-daemon-compressor.ts        # Gerador incremental do repo-map
│   └── agent-diagnostic-json.ts        # Interceptador de diagnósticos em JSON
├── bin/
│   └── synapse.ts                      # Agent-CLI nativo
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚡ Anatomia Canônica de uma Fatia (`.slice.tsx`)

Toda a funcionalidade de ponta a ponta reside num único arquivo:

```tsx
import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import type { DatabaseClient } from '@/core/database-client';
import { Result, Ok, Err } from '@/core/index';

// 1. CONTRATO DE ENTRADA JIT
export const InvoiceInputSchema = Type.Object({
  customerId: Type.String({ minLength: 10 }),
  amountCents: Type.Integer({ minimum: 1 }),
  taxRate: Type.Number({ minimum: 0, maximum: 0.3 }),
  idempotencyToken: Type.String({ minLength: 12 })
});
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

// 2. MODELAGEM ESTRITA DE DOMÍNIO
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

// 3. EXECUÇÃO DE SERVIDOR PURA (SERVER ACTION)
export async function createInvoiceAction(
  payload: unknown,
  db: DatabaseClient
): Promise<InvoiceOutput> {
  if (!Value.Check(InvoiceInputSchema, payload)) return Err('INVALID_SCHEMA');
  const input = payload as InvoiceInput;
  const total = input.amountCents + Math.round(input.amountCents * input.taxRate);

  const existCheck = await db.query(`SELECT id FROM invoices WHERE idempotency_key = $1`, [input.idempotencyToken]);
  if (existCheck.length > 0) return Err('DUPLICATE_IDEMPOTENCY');

  const customerCheck = await db.query(`SELECT id FROM customers WHERE id = $1`, [input.customerId]);
  if (customerCheck.length === 0) return Err('CUSTOMER_NOT_FOUND');

  const result = await db.query(
    `INSERT INTO invoices (customer_id, base_cents, tax_rate, total_cents, idempotency_key) 
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.customerId, input.amountCents, input.taxRate, total, input.idempotencyToken]
  );

  return Ok({ invoiceId: result[0]?.id ?? 'inv-generated', totalWithTax: total, status: 'GENERATED' });
}

// 4. COMPONENTE UI REACT
export function InvoiceTrigger({ customerId, onSubmitAction }: InvoiceTriggerProps) {
  // Renderização e chamada de ação tipada end-to-end
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

Desenvolvidos exclusivamente para chamadas programáticas de ferramentas de IA (Bash/Terminal):

```bash
# 1. Iniciar servidor HTTP Zero-Wiring com SSR e Dashboard Hub
bun run dev

# 2. Gerar uma nova fatia atômica instantaneamente (Scaffolder de IA)
bun run new-slice <domain> <name>
# Exemplo: bun run new-slice products create-product

# 3. Checagem sintática e semântica com coordenadas JSON exatas
bun run check

# 4. Esqueletização do repositório para injeção de contexto (< 3000 tokens)
bun run skeleton

# 5. Particionamento seguro em bundles Client e Server
bun run split

# 6. Execução de toda a suíte de testes oráculo PBT em tempo real
bun run test

# 7. Teste de integração E2E ao vivo (HTTP + SSR + RPC + SQLite)
bun run test:e2e

# 8. Metadados e inspeção do framework
bun run cli info
```

---

## 🛡️ Garantia de Isolamento Client / Server

Quando `synapse split` é invocado:
* O arquivo `.synapse/dist/server/generate-invoice.server.ts` recebe toda a query SQL e lógica de banco.
* O arquivo `.synapse/dist/client/generate-invoice.client.tsx` contém apenas o componente visual e um stub transparente de RPC (`fetch('/_synapse/rpc/generate-invoice')`).
* Nenhuma query SQL ou credencial vaza para o cliente.

---

## 🚀 Licença

MIT License. Projetado para acelerar o desenvolvimento autônomo por agentes de IA.
