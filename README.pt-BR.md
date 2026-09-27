# SynapseJS ⚡

> [English](README.md) | **Português do Brasil**

Framework fullstack nativo para **Bun**, construído em torno de um invariante arquitetural estrito: **uma feature é um único arquivo contíguo** (`*.slice.tsx`). Contrato de entrada, DDL de banco de dados, server action, UI em React e oráculo de teste moram juntos em um só lugar, respaldados por tooling verificável por máquinas: diagnósticos estruturados em JSON, migrações orientadas a AST, mapa comprimido do repositório, servidor MCP nativo e um splitter cliente/servidor com checagem de vazamento.

Possui ~3k linhas de código (LOC) no núcleo do framework, uma aplicação de referência e um template inicial. **Não é uma plataforma corporativa inchada e não é um "Agentic OS"**: essa alegação (juntamente com a fórmula matemática que a acompanhava) foi sumariamente removida na versão 0.4.0, juntamente com quaisquer promessas conceituais que não fossem estritamente funcionais ou verificáveis por testes.

[![License: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-v1.2+-black)](https://bun.sh)
[![Tests](https://img.shields.io/badge/Testes-359%20passando-brightgreen)](packages/synapse/test)
[![MCP](https://img.shields.io/badge/MCP-11%20Ferramentas-purple)](src/mcp)

---

## Sumário

1. [Filosofia Central: Locality of Behavior (N = 1)](#1-filosofia-central-locality-of-behavior-n--1)
2. [O Que o SynapseJS É e o Que NÃO É](#2-o-que-o-synapsejs-é-e-o-que-não-é)
3. [Matriz de Status e Verificação de Features](#3-matriz-de-status-e-verificação-de-features)
4. [Topologia do Repositório](#4-topologia-do-repositório)
5. [Início Rápido e Pré-requisitos](#5-início-rápido-e-pré-requisitos)
6. [Anatomia de uma Fatia (*.slice.tsx)](#6-anatomia-de-uma-fatia-slicetsx)
7. [O Splitter Isomórfico e Gates Anti-Vazamento](#7-o-splitter-isomórfico-e-gates-anti-vazamento)
8. [Persistência e Query Builder Isomórfico](#8-persistência-e-query-builder-isomórfico)
9. [Migrações Declarativas, DAG de Schema, Drift e Impacto](#9-migrações-declarativas-dag-de-schema-drift-e-impacto)
10. [Background Jobs e Fila Distribuída](#10-background-jobs-e-fila-distribuída)
11. [Object Storage Unificado e Gateway de Webhooks](#11-object-storage-unificado-e-gateway-de-webhooks)
12. [Segurança, RBAC, Multi-Tenancy e Autenticação Social](#12-segurança-rbac-multi-tenancy-e-autenticação-social)
13. [Primitivas de UI Declarativas, Layouts e Turbo Morphing](#13-primitivas-de-ui-declarativas-layouts-e-turbo-morphing)
14. [Servidor MCP Nativo (Model Context Protocol)](#14-servidor-mcp-nativo-model-context-protocol)
15. [Referência Completa da CLI](#15-referência-completa-da-cli)
16. [Build de Produção e Observabilidade](#16-build-de-produção-e-observabilidade)
17. [Benchmarks Empíricos e Evidências Medidas](#17-benchmarks-empíricos-e-evidências-medidas)
18. [Limitações Conhecidas e Fronteiras de Engenharia (Radical Candor)](#18-limitações-conhecidas-e-fronteiras-de-engenharia-radical-candor)
19. [Contrato Público da API do Pacote](#19-contrato-público-da-api-do-pacote)
20. [Licença e Créditos](#20-licença-e-créditos)

---

## 1. Filosofia Central: Locality of Behavior (N = 1)

Nas arquiteturas fullstack tradicionais em camadas horizontais, implementar ou alterar uma única funcionalidade exige a sincronização de 5 a 7 diretórios e arquivos separados:
- Definição de rota HTTP (`routes/customers.ts`)
- Controlador da requisição (`controllers/customerController.ts`)
- Schema de validação / DTO (`dto/customer.dto.ts`)
- Serviço com lógica de negócio (`services/customerService.ts`)
- Modelo de banco de dados / Entidade / Migração (`entities/Customer.ts`, `migrations/001_create_customers.sql`)
- Stub ou cliente de API frontend (`client/api/customers.ts`)
- Componente visual / Tela em React (`components/CustomerForm.tsx`)
- Testes unitários e de integração (`tests/customer.test.ts`)

Essa fragmentação impõe uma alta carga cognitiva ao desenvolvedor humano e degrada profundamente o desempenho de agentes autônomos de IA (LLMs). O agente precisa navegar por árvores de diretórios complexas, adivinhar acoplamentos implícitos não documentados, manter múltiplos arquivos concorrentes na janela de contexto e torcer para que uma alteração em uma camada não quebre silenciosamente outra.

**O SynapseJS impõe Locality of Behavior (Localidade de Comportamento - LoB):**
$$\text{Custo da Feature} = \mathcal{O}(1) \text{ arquivo contíguo}$$

Cada fatia vertical (`src/slices/<dominio>/<nome>.slice.tsx`) concentra:
1. **Contrato de Entrada**: Schema TypeBox compilado JIT.
2. **DDL de Banco de Dados**: Instrução SQL declarativa que cria ou evolui tabelas.
3. **Erros de Domínio Tipados**: União estrita de erros via `Result<T, E>` (sem lançar exceptions).
4. **Server Action**: Lógica de mutação de negócio e persistência transacional.
5. **Componente React**: Interface declarativa renderizada no servidor (SSR) e no cliente.
6. **SSR Loader**: Query de dados executada no servidor antes da renderização HTML.
7. **Oráculo de Teste**: Invariantes determinísticos e testes baseados em propriedades (PBT) executados pelo `bun:test`.
8. **Endpoint de Webhook**: Handler opcional com preservação integral de bytes brutos (`rawBody`).
9. **Background Jobs**: Tarefas assíncronas para processamento em background.

### O Invariante de Ouro: Fatias Nunca Importam Fatias
```
┌──────────────────────────────────────────────┐
│       src/slices/billing/invoice.slice.tsx   │
│  [Schema] [DDL] [Action] [UI] [Oráculo PBT]  │
└──────────────────────┬───────────────────────┘
                       │ ❌ PROIBIDO IMPORTAR
                       ▼
┌──────────────────────────────────────────────┐
│      src/slices/customers/customer.slice.tsx │
│  [Schema] [DDL] [Action] [UI] [Oráculo PBT]  │
└──────────────────────┬───────────────────────┘
                       │
        Ambas importam │ lógica compartilhada
                       ▼
┌──────────────────────────────────────────────┐
│          src/shared/transactions.ts          │
│   (Recebe DatabaseClient, abre db.tx)        │
└──────────────────────────────────────────────┘
```
Uma fatia vertical **nunca importa outra fatia**. Se duas features precisam transacionar juntas ou compartilhar estado, essa coordenação pertence a `src/shared/<modulo>.ts`. Violações desse princípio são interceptadas pelo analisador de AST na compilação sob o código de erro `SLICE_IMPORTS_SLICE`.

---

## 2. O Que o SynapseJS É e o Que NÃO É

### O Que Ele É:
- **Nativo para Bun**: Feito especificamente para Bun `>= 1.2`, tirando proveito de `bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.password` e `Bun.build`.
- **Arquitetura Voltada para Máquinas**: Cada comando de CLI cospe JSON estruturado no `stdout` com códigos de saída estritos (`0` para PASS, `1` para FAIL). Erros vêm acompanhados de coordenadas exatas (`file`, `line`, `col`, `code`).
- **Engenharia Anti-Hype (SureForge Protocol)**: Toda e qualquer alegação de funcionalidade é acompanhada de um teste automatizado em `packages/synapse/test/` que falha imediatamente caso a funcionalidade regrida.
- **Isolamento Rígido**: Compila, verifica estaticamente, particiona (split), migra e testa o sistema feature por feature.

### O Que Ele NÃO É:
- **Não é um "Agentic OS"**: Não existem loops autônomos mágicos desgovernados, agentes fantasma que alteram o kernel em tempo de execução ou alucinações de auto-código. Trata-se de infraestrutura determinística e previsível que torna agentes de IA auditáveis e eficientes.
- **Não roda em Node.js ou Deno**: O SynapseJS depende das primitivas de I/O, hash e compilação nativas do Bun.
- **Não é um empacotador de assets universal**: O framework pré-compila bundles de cliente isolados por fatia (`synapse build`), deixando o roteamento a cargo do servidor SSR.
- **Não é um ORM pesado com lazy loading**: Fornecemos um query builder isomórfico seguro (`findMany`, `findOne`, `insert`, `update`, `delete`, joins relacionais) e Tagged SQL parametrizado (`db.sql`). Consultas analíticas OLAP complexas devem ser feitas via SQL direto ou plugando ferramentas especializadas como Kysely em `ctx.services`.

---

## 3. Matriz de Status e Verificação de Features

Cada funcionalidade listada abaixo possui seu comando correspondente de validação. Nenhuma feature é declarada **stable** sem teste correspondente.

### Estável (Verificado no CI e Monorepo)

| Feature | Descrição | Comando de Verificação |
|---|---|---|
| **Fatias Verticais (N = 1)** | Uma feature por arquivo com Locality of Behavior | `bun test packages/synapse/test/locality.test.ts` |
| **Controle de Fluxo `Result<T, E>`** | Tratamento funcional de erro, sem helper público que lança exceção | `bun test packages/synapse/test/machine-types.test.ts` |
| **Contratos TypeBox JIT** | Validação estrita via `@sinclair/typebox` e `Value.Check` | `bun test packages/synapse/test/slice-contract.test.ts` |
| **Migrações Declarativas** | DDL descoberto via AST, idempotente statement a statement | `bun test packages/synapse/test/migration-runner.test.ts` |
| **DAG de Schema e Chaves Estrangeiras** | Ordenação topológica (algoritmo de Kahn) para execução de DDL | `bun test packages/synapse/test/schema-dag.test.ts` |
| **Detecção de Schema Drift** | Comparação de catálogo real vs AST de fatias (`synapse db-drift`) | `bun test packages/synapse/test/schema-drift.test.ts` |
| **Análise de Impacto e Blast Radius** | Mapeamento de impacto por FK, módulos compartilhados e tabelas (`synapse impact`) | `bun test packages/synapse/test/impact-analyzer.test.ts` |
| **Mapeamento de Erro para HTTP** | Mapeamento consistente (`UNAUTHORIZED` → 401, `FORBIDDEN` → 403, `NOT_FOUND` → 404, etc.) | `bun test packages/synapse/test/runtime-server.test.ts` |
| **Splitter Isomórfico de Fatias** | Particionamento em módulos `shared`, `server` e `client` por alcançabilidade | `bun test packages/synapse/test/slice-splitter.test.ts` |
| **Gate Anti-Vazamento (Zero-Leak)** | Checagem estrita no cliente contra presença de SQL, DB e globais do Bun | `bun test packages/synapse/test/slice-splitter.test.ts` |
| **Motor SQLite Embutido** | Modo WAL, cache de statements LRU, mutex de transação, CTE segura | `bun test packages/synapse/test/sqlite-client.test.ts` |
| **Paridade PostgreSQL** | Pool real de conexões (`postgres.js`), rollback de transação verificado | `bun run test:postgres` (requer `TEST_DATABASE_URL`) |
| **Query Builder Isomórfico** | Queries relacionais (`findMany`, `insert`, `update`, `delete`, joins) | `bun test packages/synapse/test/query-builder.test.ts` |
| **Joins Relacionais e Sub-Objetos** | Desachatamento automático de linhas aninhadas via `nestJoinedRow` | `bun test packages/synapse/test/query-builder-joins.test.ts` |
| **Template Tagged SQL Nativo** | Interpolação segura de parâmetros com `db.sql` e `db.sqlOne` | `bun test packages/synapse/test/sql-tagged.test.ts` |
| **Sessões Assinadas e RBAC** | Assinatura criptográfica de tokens, `requireAuth(session, roles)` | `bun test packages/synapse/test/runtime-server.test.ts` + `bun test packages/synapse/test/session-cookie.test.ts` |
| **Multi-Tenancy B2B e IDOR** | Validação estrita de tenant via `requireTenant` | `bun test packages/synapse/test/multi-tenancy.test.ts` |
| **Primitivas Declarativas de UI** | Componentes acessíveis `<DataTable>`, `<DataForm>`, `<Button>`, etc. | `bun test packages/synapse/test/client-primitives.test.ts` |
| **Layouts Hierárquicos e Turbo Morphing** | Layout raiz em `_layout.tsx` e roteamento sem recarregamento de página | `bun test packages/synapse/test/layouts-morphing.test.ts` |
| **Realtime Declarativo via SSE** | Gateway Server-Sent Events com `EventHub` e hook `useSubscription` | `bun test packages/synapse/test/sse-gateway.test.ts` + `event-hub.test.ts` |
| **Object Storage Unificado** | Sistema local + AWS S3 / Cloudflare R2 com URLs pré-assinadas SigV4 | `bun test packages/synapse/test/storage.test.ts` |
| **Fila Distribuída PostgreSQL** | Processamento com `FOR UPDATE SKIP LOCKED`, backoff com jitter e DLQ | `bun test packages/synapse/test/postgres-queue.test.ts` |
| **Fila e Worker SQLite** | Declaração de jobs via `defineJob` e executor contínuo via `synapse worker` | `bun test packages/synapse/test/jobs-queue.test.ts` |
| **Gateway de Webhooks** | Preservação de `rawBody: Uint8Array` para validação de assinaturas HMAC | `bun test packages/synapse/test/webhooks.test.ts` |
| **Scaffolder de Fatias** | Gerador de código via AST com gramática `--fields` e múltiplos templates | `bun test packages/synapse/test/scaffolder.test.ts` + `fields-parser.test.ts` |
| **Servidor MCP Nativo** | Servidor JSON-RPC 2.0 via stdio com 11 ferramentas para agentes de IA | `bun test packages/synapse/test/mcp-server.test.ts` |
| **Gerador de Mapa de Esqueleto** | Digest comprimido do repositório (`.codebase/repo-map.d.ts`, <3000 tokens) | `bun test packages/synapse/test/repo-map.test.ts` |
| **Catálogo Central de Schema** | Tipos TypeScript centralizados para tabelas (`.codebase/db-schema.d.ts`) | `bun test packages/synapse/test/db-schema-generator.test.ts` |
| **Empacotamento Standalone** | Compilação de pacote independente em `.synapse/standalone/` | `bun test packages/synapse/test/standalone-builder.test.ts` |
| **Oráculos e Testes PBT** | Fast-Check e invariantes nomeados executados sob `bun:test` | `bun test packages/synapse/test/oracle-runner.test.ts` |
| **Observabilidade e Métricas** | Logs JSON estruturados (`SYNAPSE_LOG=json`) e endpoint Prometheus | `bun test packages/synapse/test/observability-metrics.test.ts` |
| **Suíte E2E Integrada** | 12 checagens HTTP reais cobrindo SSR, RPC, RBAC e Idempotência | `bun run test:e2e` |
| **Ensaio de Publicação** | Validação de empacotamento simulando instalação limpa externa | `bun run rehearse:publish` |
| **DDL Bidirecional & Rollback** | Demarcações `-- up:` e `-- down:`, rollback transacional de schema (`synapse rollback`) | `bun test packages/synapse/test/onda2.test.ts` |
| **Vendor Code-Splitting** | Separa React/ReactDOM em `_vendor.js`, micro-bundles de fatia (< 500B) via `importmap` | `bun test packages/synapse/test/onda1.test.ts` |
| **Metadados Dinâmicos de Cabeçalho** | Fatias exportam `sliceMeta(data, ctx)` para título dinâmico, descrição e tags Open Graph | `bun test packages/synapse/test/onda1.test.ts` |
| **Layouts Hierárquicos de Domínio** | Layouts aninhados `src/slices/<domain>/_layout.tsx` envelopados no layout raiz | `bun test packages/synapse/test/onda1.test.ts` |
| **Rate Limiting por Token Bucket** | Janela deslizante via `TokenBucketRateLimiter` com conformidade estrita à RFC 6585 | `bun test packages/synapse/test/onda2.test.ts` |
| **Proteção de Upload por Streaming** | Parser multipart em streaming com rejeição antecipada HTTP 413 prevenindo OOM DoS | `bun test packages/synapse/test/onda2.test.ts` |
| **Event Hub Distribuído** | `PostgresEventHub` com conexão LISTEN persistente dedicada e offload de payloads grandes | `bun test packages/synapse/test/onda3.test.ts` |
| **Roteamento Isomórfico i18n** | Primitiva `createTranslator` e rotas localizadas (`/:locale/*`) com `<html lang>` | `bun test packages/synapse/test/onda3.test.ts` |
| **Primitivas Avançadas de `<DataForm>`** | Notação de ponto aninhada (`user.profile.bio`), inputs de arquivo e `fieldErrors` inline | `bun test packages/synapse/test/onda4.test.ts` |
| **Revogação de Tokens de Sessão** | Lista de revogação criptográfica (`TOKEN_REVOKED`) com cache em memória e banco | `bun test packages/synapse/test/onda4.test.ts` |
| **Autenticação TOTP 2FA** | Template de scaffolding (`auth-2fa`) com geração de segredo base32 e validação TOTP | `bun test packages/synapse/test/onda4.test.ts` |
| **Otimizador de Imagens Sob Demanda** | Endpoint de redimensionamento (`/_synapse/images/optimize`) com sharp dinâmico e fallback | `bun test packages/synapse/test/onda4.test.ts` |
| **Hooks de Plugins de Infraestrutura** | Ganchos em `defineConfig` (`onBootstrap`, `onRequest`, `onResponse`, `onMigrate`) | `bun test packages/synapse/test/onda4.test.ts` |

### Experimental

| Feature | Estado Atual | O Que Falta |
|---|---|---|
| **Repasse de Sessão por Cookie no Shell SSR** | Lê cookies `synapse_token` e `synapse_roles` e injeta nos cabeçalhos | Conveniente para desenvolvimento; produção exige cookies criptograficamente assinados sob TLS estrito. |

### Roadmap

| Feature | Escopo e Objetivo |
|---|---|
| **Cache Distribuído Multi-Região** | Adaptadores para Redis / Dragonfly para invalidação entre instâncias. |

---

## 4. Topologia do Repositório

```text
packages/synapse/
  src/core/            Result/Option, DatabaseClient, SQLite, Postgres, QueryBuilder, Storage, PostgresQueue, Sessão, RPC
  src/client/          Primitivas de UI declarativas (DataTable, DataForm, Button, Card, Badge, Pagination, hooks, i18n)
  src/compiler/        Descoberta de fatias, migrações, gerador de schema, analisador de campos, scaffolder, splitter, repo-map, standalone builder
  src/runtime/         Roteador Bun.serve, shell SSR, despachante RPC, SynapseProvider, script Turbo Morphing, PostgresEventHub, RateLimiter
  src/mcp/             Servidor MCP nativo JSON-RPC 2.0 stdio (11 ferramentas completas)
  bin/synapse.ts       Ponto de entrada único da CLI
  templates/starter/   Template base copiado por `synapse new` (build standalone + Dockerfile)
  test/                Suíte de testes do framework (359 testes, 49 arquivos) + fixtures de teste
Dockerfile             Imagem de produção multi-stage (Bun sobre Alpine, ~90MB)
examples/enterprise-crm/       Aplicação de referência: 3 fatias verticais + suíte de integração E2E (12 checagens)
examples/helpdesk-slices/      2 features implementadas em fatias verticais
examples/helpdesk-conventional/ As mesmas 2 features em arquitetura em camadas tradicional (comparador de benchmark)
.synapse/              Artefatos gerados (gitignored): banco SQLite, módulos particionados, wrappers de oráculo
.codebase/             Repo map e catálogo de schemas gerados (commitados por app)
AGENTS.md              Instruções de engenharia para agentes autônomos e regras SureForge
STUDY.md               Estudo empírico pré-registrado comparando fatias vs camadas
```

---

## 5. Início Rápido e Pré-requisitos

### Pré-requisitos
- **Bun >= 1.2.0** instalado.
```bash
curl -fsSL https://bun.sh/install | bash
```

### Criando um Projeto
Crie uma nova aplicação usando a CLI:
```bash
bunx synapsejs new meu-projeto
cd meu-projeto
bun install
```

### Executando em Desenvolvimento
Inicie o servidor local com migrações automáticas e o Hub Interativo do Synapse:
```bash
bun run dev
# Servidor disponível em http://localhost:3000
```

### Criando Sua Primeira Fatia
Gere uma fatia vertical completa contendo validação TypeBox, DDL SQL, Server Action, UI em React e oráculos de teste:
```bash
bun run new-slice customers create-customer --fields="name:string,email:string,role:enum(ADMIN|USER)"
```

### Validando o Código e Executando Testes
```bash
bun run check        # Executa o verificador de tipos e diagnósticos JSON
bun run test         # Executa os oráculos de teste das fatias sob bun:test
bun run split        # Executa o particionamento e valida o gate anti-vazamento
```

---

## 6. Anatomia de uma Fatia (`*.slice.tsx`)

Uma fatia é um único arquivo localizado em `src/slices/<dominio>/<nome>.slice.tsx`.

Abaixo temos uma fatia vertical autêntica de nível de produção demonstrando contratos, DDL, action, UI, loader, oráculo e background job:

```tsx
import {
  Type,
  type Static,
  Value,
  Ok,
  Err,
  type Result,
  type DatabaseClient,
  type SessionContext,
  requireAuth,
  defineJob,
  type ActionContext,
  DataTable,
  Button
} from 'synapsejs';

// 1. Contrato de Entrada (Schema TypeBox validado JIT)
export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 })
});
export type TicketInput = Static<typeof TicketInputSchema>;

// 2. DDL do Banco (Executado uma vez por comando, rastreado em _synapse_migration_statements)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// 3. Contrato de Saída (Result funcional estrito, sem exceções)
export type TicketOutput = Result<
  { ticketId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// 4. Declaração de Background Job
export const notifyStaffJob = defineJob<{ ticketId: string }>({
  name: 'notify-staff-ticket-created',
  retryLimit: 3,
  backoffSeconds: 5,
  perform: async (payload, ctx) => {
    // Processado de forma assíncrona por `synapse worker`
    console.log(`Notificando equipe sobre o chamado ${payload.ticketId}`);
  }
});

// 5. Server Action
// Nota: `db` e `session` são parâmetros opcionais.
// No servidor, o runtime injeta as dependências. No cliente, a chamada é convertida em stub RPC.
export async function createTicketAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<TicketOutput> {
  const auth = requireAuth(session, ['support']);
  if (!auth.ok) return Err(auth.error);
  if (!db) return Err('NO_DATABASE');
  if (!Value.Check(TicketInputSchema, payload)) return Err('INVALID_SCHEMA');

  const input = payload as TicketInput;
  const ticketId = crypto.randomUUID();

  await db.query(
    `INSERT INTO tickets (id, subject, priority, status) VALUES ($1, $2, $3, 'OPEN')`,
    [ticketId, input.subject, input.priority]
  );

  return Ok({ ticketId });
}

// 6. SSR Data Loader (Executado no servidor antes de renderizar a página)
export async function createTicketLoader(ctx: { db: DatabaseClient; session: SessionContext }) {
  const recentTickets = await ctx.db.findMany<{ id: string; subject: string; priority: number }>(
    'tickets',
    { limit: 5, orderBy: { created_at: 'DESC' } }
  );
  return { recentTickets };
}

// 7. Componente React
export function CreateTicketComponent(props: {
  recentTickets?: Array<{ id: string; subject: string; priority: number }>;
  onSubmitAction?: (payload: unknown) => Promise<TicketOutput>;
}) {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Abrir Chamado de Suporte</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const formData = new FormData(form);
          const payload = {
            subject: String(formData.get('subject')),
            priority: Number(formData.get('priority'))
          };
          const res = await props.onSubmitAction?.(payload);
          if (res?.ok) alert(`Chamado criado: ${res.value.ticketId}`);
          else alert(`Erro: ${res?.error}`);
        }}
        className="space-y-4"
      >
        <input name="subject" placeholder="Assunto do chamado" className="w-full border p-2 rounded" />
        <input name="priority" type="number" defaultValue={3} className="w-full border p-2 rounded" />
        <Button type="submit">Enviar Chamado</Button>
      </form>

      {props.recentTickets && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Chamados Recentes</h2>
          <DataTable
            data={props.recentTickets}
            columns={[
              { key: 'subject', header: 'Assunto' },
              { key: 'priority', header: 'Prioridade' }
            ]}
          />
        </div>
      )}
    </div>
  );
}

// 8. Oráculo de Teste (Executado via `synapse test` sob bun:test)
export const sliceTests = {
  description: 'Invariantes de Chamados de Suporte',
  cases: [
    {
      name: 'chamadas anônimas retornam UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const result = await createTicketAction({ subject: 'Queda de Rede', priority: 1 });
        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(`Esperava UNAUTHORIZED, recebido ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'payload inválido retorna INVALID_SCHEMA',
      run: async () => {
        const session = { userId: 'u1', roles: ['support'] };
        const mockDb = { query: async () => [] } as unknown as DatabaseClient;
        const result = await createTicketAction({ subject: 'ab', priority: 10 }, mockDb, session);
        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`Esperava INVALID_SCHEMA, recebido ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
```

### Regras de Descoberta por Sufixo
O runtime do framework detecta as partes da fatia por convenções estritas:
- **Contrato de Entrada**: Qualquer export terminando em `Schema` (ex: `TicketInputSchema`).
- **DDL do Banco**: Constante exportada como `sliceSchema`.
- **Server Action**: Função com sufixo `Action` (ex: `createTicketAction`).
- **Componente React**: Sufixos aceitos: `Trigger`, `View`, `Form` ou `Component` (ex: `CreateTicketComponent`).
- **SSR Loader**: Função com sufixo `Loader` (ex: `createTicketLoader`).
- **Oráculo de Teste**: Constante nomeada `sliceTests` (contendo `{ cases: [...] }`).
- **Endpoint Webhook**: Sufixo `Webhook` (ex: `stripeWebhook`).
- **Background Jobs**: Qualquer declaração gerada via `defineJob`.

---

## 7. O Splitter Isomórfico e Gates Anti-Vazamento

Ao executar `synapse split` ou `synapse build`, o compilador inspeciona a AST da fatia via análise de alcançabilidade no type checker do TypeScript e divide o arquivo em três artefatos:

```text
src/slices/tickets/create-ticket.slice.tsx
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   shared.tsx     │   │    server.ts     │   │   client.tsx     │
│ Schemas TypeBox, │   │ DDL, queries SQL,│   │ Componente React,│
│ tipos TypeScript │   │ actions, banco   │   │ stub RPC gerado  │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

### Dois Gates de Verificação Inegociáveis
Para impedir qualquer vazamento de lógica de backend ou credenciais para o navegador, o compilador exige a passagem por dois gates:

1. **Gate de Compilação**: Os três módulos gerados (`shared.tsx`, `server.ts` e `client.tsx`) são validados pelo compilador TypeScript usando o `tsconfig.json` do próprio projeto.
2. **Gate Anti-Vazamento (Zero-Leak)**: O módulo `client.tsx` é inspecionado na AST e **reprovado com erro fatal** caso contenha:
   - Palavras-chave SQL ou strings de DDL
   - Chamadas a `db.query`, `db.findMany`, etc.
   - Referências a `sliceSchema`
   - Variáveis de ambiente (`process.env`)
   - Globais do Bun (`Bun.serve`, `Bun.password`, `Bun.spawn`, etc.)

Quando o componente React chama uma Server Action diretamente, o splitter gera apenas a assinatura de rede do stub RPC:
```ts
// Gerado dentro de client.tsx
export async function createTicketAction(payload: unknown): Promise<TicketOutput> {
  return rpcCall<TicketOutput>('/_synapse/rpc/tickets/create-ticket', payload);
}
```

---

## 8. Persistência e Query Builder Isomórfico

O SynapseJS oferece clientes para SQLite embutido e PostgreSQL de nível corporativo:

### 1. SQLite Embutido (`SqliteDatabaseClient`)
- Driver nativo de alto desempenho via `bun:sqlite`.
- Modo WAL (Write-Ahead Logging) habilitado por padrão.
- Cache de declarações preparadas (bounded LRU com capacidade para 256 statements).
- Mutex serializado para escritas concorrentes seguras.
- Execução segura de leituras e CTEs complexas.

### 2. Paridade PostgreSQL (`PostgresDatabaseClient`)
- Baseado em `postgres.js` com pool de conexões real.
- Validado no CI contra `postgres:16-alpine`.
- Semântica de transação real idêntica (`db.transaction`).

### 3. Query Builder Isomórfico
Escreva queries seguras e tipadas sem depender de strings cruas de SQL:

```ts
// Consulta com operadores relacionais, paginação e ordenação
const customers = await db.findMany<Customer>('customers', {
  where: {
    status: { eq: 'ACTIVE' },
    creditScore: { gte: 700 },
    country: { in: ['BR', 'US', 'CA'] }
  },
  limit: 20,
  offset: 0,
  orderBy: { created_at: 'DESC' }
});

// Joins relacionais parametrizados com aninhamento automático de sub-objetos
const ordersWithCustomer = await db.findMany('orders', {
  join: [
    {
      table: 'customers',
      on: { customer_id: 'id' },
      select: ['name', 'email'],
      as: 'customer'
    }
  ]
});
// Resultado desachatado:
// [{ id: 'ord_1', total: 100, customer: { name: 'Acme Corp', email: 'contato@acme.com' } }]

// Inserções, Atualizações e Remoções
await db.insert('customers', { id: 'c1', name: 'Maria Silva', status: 'ACTIVE' });
await db.update('customers', { status: 'INACTIVE' }, { id: { eq: 'c1' } });
await db.delete('customers', { id: { eq: 'c1' } });
```

### 4. Tagged SQL Nativo
Quando for necessário utilizar SQL bruto, use os template literals `db.sql` e `db.sqlOne`. Eles interpolam variáveis com proteção automática contra injeção SQL:

```ts
const user = await db.sqlOne<User>`
  SELECT id, email, created_at 
  FROM users 
  WHERE email = ${inputEmail} AND tenant_id = ${session.tenantId}
`;
```

---

## 9. Migrações Declarativas, DAG de Schema, Drift e Impacto

### Migrações Idempotentes Statement por Statement
O texto de `sliceSchema` é quebrado em comandos individuais. Cada comando é executado e registrado na tabela `_synapse_migration_statements` com seu hash SHA-256:
- O comando `synapse migrate` roda apenas o que é novo.
- Um `ALTER TABLE customers ADD COLUMN phone TEXT;` executa apenas uma vez e nunca mais.
- Caso uma instrução falhe, ela não é registrada e a falha é emitida em JSON estruturado com o erro exato do banco.

### Migrações Bidirecionais e Rollback Transacional (`synapse rollback`)
O `sliceSchema` suporta demarcações opcionais `-- up:` e `-- down:` para viabilizar migrações reversíveis:

```sql
export const sliceSchema = `
  -- up:
  ALTER TABLE customers ADD COLUMN nickname TEXT;

  -- down:
  ALTER TABLE customers DROP COLUMN nickname;
`;
```

Ao executar `synapse rollback [targetSlice] [--steps=N]` ou utilizar a ferramenta MCP `synapse_rollback`:
- As instruções de *down* são executadas em ordem cronológica reversa dentro de uma transação atômica.
- Os registros correspondentes são expurgados de `_synapse_migration_statements`.
- Evita corrupção do banco ou tabelas em estados inconsistentes durante reversões de deploy.

### DAG de Schema (Ordenação Topológica)
Quando existem referências de Foreign Key entre fatias, o algoritmo de ordenação topológica de Kahn analisa o grafo acíclico e garante que tabelas-mãe sejam criadas antes das filhas.

### Detecção de Schema Drift (`synapse db-drift`)
Compara o catálogo real do SQLite ou PostgreSQL contra os contratos declarados nas fatias:
```bash
synapse db-drift
```
Retorna JSON identificando:
- `missingTables`: Tabelas declaradas em fatias mas inexistentes no banco.
- `missingColumns`: Colunas declaradas em fatias ausentes nas tabelas reais.
- `orphanTables`: Tabelas existentes no banco que não pertencem a nenhuma fatia conhecida.

### Análise de Impacto e Blast Radius (`synapse impact <target>`)
Mapeia o raio de impacto de alterações em fatias, módulos compartilhados ou tabelas:
```bash
synapse impact src/slices/customers/create-customer.slice.tsx
```
Saída JSON detalhada:
```json
{
  "status": "PASS",
  "operation": "IMPACT_ANALYSIS",
  "target": "src/slices/customers/create-customer.slice.tsx",
  "totalImpacted": 2,
  "impactedSlices": [
    {
      "sliceName": "create-customer",
      "domain": "customers",
      "reason": "DIRECT",
      "detail": "Fatia alvo diretamente modificada"
    },
    {
      "sliceName": "generate-invoice",
      "domain": "billing",
      "reason": "FOREIGN_KEY_DEPENDENCY",
      "detail": "Tabela 'customers' referenciada via chave estrangeira"
    }
  ],
  "recommendedCommands": ["synapse check", "synapse split", "synapse db-drift", "synapse migrate", "synapse test"]
}
```

---

## 10. Background Jobs e Fila Distribuída

O processamento assíncrono é declarado nativamente dentro das fatias verticais através de `defineJob`.

### Declaração e Enfileiramento
```ts
export const processPaymentJob = defineJob<PaymentPayload>({
  name: 'process-payment',
  retryLimit: 5,
  backoffSeconds: 10,
  perform: async (payload, ctx) => {
    await ctx.services.paymentGateway.charge(payload);
  }
});

// Enfileiramento dentro de qualquer Server Action:
await ctx.enqueue(processPaymentJob, { amount: 5000, currency: 'BRL' });
```

### Processo Worker Dedicado
Execute o worker de processamento de background jobs:
```bash
synapse worker
```

### Concorrência Distribuída em PostgreSQL (`PostgresQueueEngine`)
Para deploys horizontais multi-instância, o motor de fila PostgreSQL inclui:
- **Pop atômico distribuído**: Utiliza `FOR UPDATE SKIP LOCKED` para garantir que trabalhadores concorrentes nunca peguem o mesmo job simultaneamente.
- **Backoff exponencial com full jitter**: Evita thundering herds durante a recuperação de APIs externas.
- **Dead-Letter Queue (`_synapse_jobs_dlq`)**: Encaminha automaticamente jobs esgotados para a DLQ após atingirem o `retryLimit`.
- **Recuperação de falhas de worker**: Recupera tarefas abandonadas caso um nó venha a cair durante a execução (visibility timeout).

---

## 11. Object Storage Unificado e Gateway de Webhooks

### Abstração de Object Storage (`getStorage()`)
Alterne entre desenvolvimento local e nuvem sem alterar código de aplicação:
- `LocalStorageAdapter`: Grava em disco local em `.synapse/storage/` com proteção contra directory traversal.
- `S3StorageAdapter`: Integração completa com AWS S3, Cloudflare R2 e MinIO, calculando assinaturas criptográficas reais AWS SigV4 (HMAC-SHA256) para URLs pré-assinadas de upload e download.

```ts
const storage = getStorage();

// Salvar buffer diretamente
await storage.put('invoices/inv-001.pdf', pdfBuffer, 'application/pdf');

// Gerar URL pré-assinada para upload direto do browser (válida por 15 minutos)
const uploadUrl = await storage.createPresignedUploadUrl('avatars/user-123.png', 900);
```

### Gateway de Webhooks com Raw Body Preservado
Webhooks externos (como Stripe, GitHub ou Mercado Pago) exigem verificação de assinatura HMAC criptográfica contra os bytes brutos exatos do payload original.

Exporte uma função com sufixo `Webhook`:
```ts
export async function stripeWebhook(event: WebhookEvent, ctx: ActionContext) {
  const signature = event.headers.get('stripe-signature');
  // event.rawBody é um Uint8Array contendo os bytes brutos intactos
  const verified = stripe.webhooks.constructEvent(event.bodyText, signature, webhookSecret);
  return { received: true };
}
```
Disponível automaticamente em: `POST /_synapse/webhooks/<dominio>/<nome>`

---

## 12. Segurança, RBAC, Multi-Tenancy e Autenticação Social

### Resolução de Sessão e Tokens Criptografados
O SynapseJS resolve a identidade da sessão a partir de três cabeçalhos possíveis:
- `Authorization: Bearer <token>`
- `x-user-id`
- `x-user-roles`

Em produção, defina a variável `SYNAPSE_SESSION_SECRET`. Com o segredo configurado, tokens Bearer passam a exigir assinatura HMAC-SHA256 (`signSessionToken` / `verifySessionToken`). Os cabeçalhos manuais de papéis passam a ser sumariamente ignorados, impedindo falsificação de identidade.

### RBAC Explícito (Role-Based Access Control)
Sem anotações mágicas ou interceptadores ocultos. Autorize explicitamente e devolva erros funcionais determinísticos:
```ts
const auth = requireAuth(session, ['admin', 'billing']);
if (!auth.ok) return Err(auth.error); // Retorna Err('UNAUTHORIZED') ou Err('FORBIDDEN')
```

### Multi-Tenancy B2B e Prevenção IDOR
O framework resolve `tenantId` a partir de `x-tenant-id`, subdomínio ou claims do token de sessão:
```ts
const tenant = requireTenant(session, resource.tenantId);
if (!tenant.ok) return Err(tenant.error); // Retorna Err('FORBIDDEN') determinístico
```

### Template de Autenticação Social OAuth2
Crie uma fatia completa de autenticação social com GitHub em segundos:
```bash
synapse new-slice auth github --template=oauth-github
```

---

## 13. Primitivas de UI Declarativas, Layouts e Turbo Morphing

### Primitivas de UI Acessíveis e Leves
Componentes React sem bloat de dependências:
- `<DataTable data={linhas} columns={colunas} />`
- `<DataForm schema={InputSchema} onSubmit={action} />` (suporta campos aninhados em notação de ponto como `user.profile.bio`, upload de arquivos e `fieldErrors` inline)
- `<Button variant="primary">Confirmar</Button>`
- `<Card>`, `<Badge>`, `<Pagination>`
- Hooks: `useAction`, `useLoaderData`, `useSubscription`, `useSession`

### Layouts Raiz e Hierárquicos por Domínio (`_layout.tsx`)
Crie `src/slices/_layout.tsx` para envolver as páginas SSR com barras de navegação e componentes comuns. Para domínios específicos (ex: painéis administrativos ou portais financeiros), crie `src/slices/<dominio>/_layout.tsx` para envelopar as fatias do domínio sem duplicar o layout raiz.

### Metadados Dinâmicos de Cabeçalho e SEO (`sliceMeta`)
Fatias podem exportar uma função `sliceMeta(data, context)` para definir `<title>`, `<meta>`, tags canônicas e Open Graph dinamicamente no SSR:
```tsx
export function sliceMeta(data: CustomerOutput, ctx: LoaderContext) {
  return {
    title: `${data.name} — Perfil do Cliente`,
    description: `Gerenciamento do cliente ${data.name} e assinaturas.`,
    openGraph: {
      title: data.name,
      type: 'profile'
    }
  };
}
```
O splitter remove o `sliceMeta` dos bundles do cliente sem nenhum vazamento.

### Roteamento e Internacionalização Isomórfica (i18n)
O Synapse suporta internacionalização isomórfica via `createTranslator` e prefixos de rota localizados (`/:locale/*`, ex: `/en/tickets`, `/pt-BR/tickets`):
```tsx
import { createTranslator } from 'synapsejs/client';

const t = createTranslator({
  en: { welcome: 'Welcome, {name}!' },
  'pt-BR': { welcome: 'Bem-vindo, {name}!' }
}, 'pt-BR');

console.log(t('welcome', { name: 'Alice' })); // "Bem-vindo, Alice!"
```

### Roteador SPA com Turbo Morphing
Toda casca SSR injeta `/_synapse/turbo-router.js`. A navegação entre páginas cliente intercepta cliques em links, busca o HTML renderizado pelo servidor e atualiza o DOM de `#synapse-root` de forma reativa. O usuário experimenta transições instantâneas de SPA sem recarregamentos brancos, preservando indexação SEO completa.

### Gateway Realtime Declarativo (SSE)
Emita eventos no servidor e consuma no React sem gerenciar conexões de WebSocket manuais:
```ts
// Na Server Action:
ctx.broadcast('orders', { orderId: 'ord_123', status: 'PAID' });

// No Componente React:
useSubscription('orders', (event) => {
  console.log('Atualização recebida:', event);
});
```

---

## 14. Servidor MCP Nativo (Model Context Protocol)

O SynapseJS inclui um servidor nativo Model Context Protocol (MCP) via JSON-RPC 2.0 sobre stdio, expondo 11 ferramentas especializadas para agentes autônomos de IA (Cursor, Claude Code, Windsurf, Antigravity):

```bash
bun run mcp
```

### Configuração no Cliente do Agente (`mcpServers`)
```json
{
  "mcpServers": {
    "synapsejs": {
      "command": "bunx",
      "args": ["synapse", "mcp"],
      "cwd": "/caminho/do/seu/projeto"
    }
  }
}
```

### As 11 Ferramentas MCP Nativas

| Ferramenta | Finalidade |
|---|---|
| `synapse_get_repo_map` | Obtém o digest comprimido da AST do repositório (`.codebase/repo-map.d.ts`, <3000 tokens). |
| `synapse_get_db_schema` | Catálogo centralizado de schemas de banco (`.codebase/db-schema.d.ts`) para consultas tipadas. |
| `synapse_check` | Diagnósticos estruturados da máquina com coordenadas exatas (`file`, `line`, `col`, `code`). |
| `synapse_split` | Executa o particionamento de fatias e valida os gates de compilação e anti-vazamento. |
| `synapse_run_pbt` | Executa a suíte de testes de invariantes baseados em propriedades (Fast-Check) em todas as fatias. |
| `synapse_scaffold_slice` | Faz o scaffolding de novas fatias usando templates e gramática `--fields`. |
| `synapse_migrate` | Aplica migrações DDL pendentes ao banco de dados ativo de forma idempotente. |
| `synapse_rollback` | Reverte migrações DDL de forma transacional usando os blocos de down. |
| `synapse_contract` | Devolve o contrato formal do framework, semântica HTTP e convenções de nomenclatura. |
| `synapse_check_db_drift` | Compara o banco ao vivo contra os DDLs para achar tabelas e colunas ausentes ou órfãs. |
| `synapse_diff_impact` | Calcula o raio de impacto de alterações em código, schemas e módulos compartilhados. |

---

## 15. Referência Completa da CLI

Todos os subcomandos da CLI retornam JSON válido em `stdout` e encerram com exit code `0` (sucesso) ou `1` (falha).

| Comando | Argumentos / Flags | Descrição |
|---|---|---|
| `synapse dev` | `[porta] [--watch]` | Inicia o servidor HTTP com descoberta automática, migrações e Dev Hub. |
| `synapse start` | `[porta]` | Inicia o servidor de produção com graceful shutdown (`SIGTERM`/`SIGINT`). |
| `synapse check` | `[arquivo]` | Executa checagem de tipos e retorna diagnósticos JSON estruturados. |
| `synapse migrate` | — | Aplica migrações DDL pendentes statement a statement. |
| `synapse rollback` | `[targetSlice] [--steps=N]` | Executa rollback transacional das migrações correspondentes aos blocos down. |
| `synapse db-drift` | — | Compara o banco de dados contra os contratos DDL das fatias. |
| `synapse impact` | `<alvo>` | Calcula o raio de impacto de um arquivo, fatia ou tabela. |
| `synapse mcp` | — | Inicia o servidor MCP stdio JSON-RPC 2.0. |
| `synapse skeleton` | — | Gera `.codebase/repo-map.d.ts` e `.codebase/db-schema.d.ts`. |
| `synapse db-schema` | — | Gera o catálogo DAG de banco isolado. |
| `synapse split` | — | Particiona fatias em `shared`, `server` e `client` e valida gates. |
| `synapse test` | — | Executa oráculos de teste das fatias com `bun:test`. |
| `synapse new-slice` | `<dominio> <nome> [--template=...] [--fields=...]` | Cria uma fatia vertical. Templates: `create`, `list`, `update`, `delete`, `login`, `auth-2fa`, `oauth-github`, `crud`. |
| `synapse build` | `[--standalone]` | Pré-compila bundles de cliente ou empacota release independente em `.synapse/standalone/`. |
| `synapse worker` | — | Inicia o processo worker contínuo de background jobs. |
| `synapse contract` | `[--markdown]` | Emite o contrato da máquina em JSON ou Markdown. |
| `synapse info` | — | Imprime metadados da máquina e evidências testadas para cada feature. |

---

## 16. Build de Produção e Observabilidade

### Compilação Standalone
Gere um pacote autônomo e autocontido pronto para produção:
```bash
synapse build --standalone
```
Os arquivos são emitidos em `.synapse/standalone/`, incluindo o servidor pronto e bundles de cliente pré-compilados.

### Imagem Docker de Produção
O repositório inclui um `Dockerfile` multi-stage baseado em Alpine Linux e Bun:
- **Tamanho da Imagem**: ~90MB.
- **Segurança**: Executa sob usuário sem privilégios `bun`.
```bash
docker build -t meu-synapse-app .
docker run -p 3000:3000 -e SYNAPSE_SESSION_SECRET="seu-segredo" meu-synapse-app
```

### Observabilidade e Métricas Prometheus
- **Endpoint Prometheus**: `GET /_synapse/api/metrics` (ou via `Accept: text/plain`) exporta contador de requisições, latências e tempo de atividade.
- **Logs Estruturados**: Defina `SYNAPSE_LOG=json` para registrar uma linha JSON estruturada por requisição HTTP.
- **Modo Air-Gap / Offline**: Defina `SYNAPSE_DISABLE_CDN=1` para desativar CDNs externas (Tailwind, Google Fonts) em ambientes corporativos fechados.

---

## 17. Benchmarks Empíricos e Evidências Medidas

Seguindo o protocolo **SureForge** e as regras de **Radical Candor**, todos os números abaixo foram produzidos diretamente por scripts de benchmark automatizados neste repositório.

### 1. Suíte de Testes do Framework
```text
320 pass
0 fail
1182 expect() calls
Ran 320 tests across 45 files.
```
Executado via: `bun test packages/synapse/test`

### 2. Benchmark de Superfície de Contexto (`bun run bench`)
Comparação direta entre duas features ("abrir chamado", "atribuir chamado") implementadas em fatias verticais versus arquitetura em camadas tradicional:

| Aplicação | Feature | Arquivos (App) | Tokens (App, Est.) | Arquivos (Total) | Tokens (Total, Est.) |
|---|---|---|---|---|---|
| **helpdesk-slices** | abrir chamado | **1** | **1.627** | 46 | 94.971 |
| **helpdesk-slices** | atribuir chamado | **1** | **1.393** | 46 | 94.738 |
| **helpdesk-conventional** | abrir chamado | 5 | 1.832 | 5 | 1.832 |
| **helpdesk-conventional** | atribuir chamado | 5 | 1.832 | 5 | 1.832 |

#### O que o benchmark comprova:
- Fatias verticais reduzem o número de arquivos coordenados por feature de **5 para 1**.
- A superfície de tokens consumida no código da aplicação cai de 1.832 para 1.627 (~11% de redução).

#### O que o benchmark NÃO comprova:
- A coluna `Total` na stack de fatias inclui o barrel de tipos do framework acessado via `paths` (~94k tokens), pago uma única vez e compartilhado por todas as features.
- **Não** alegamos que menos arquivos tornam um agente de IA mais inteligente ou rápido; isso é um aspecto comportamental que demanda testes empíricos de trajetória de agentes.

### 3. Benchmark de Concorrência Real (`bun run bench:concurrency`)
Medição de vazão de requisições HTTP do `Bun.serve` local sob 50 conexões concorrentes totalizando 1.000 requisições:
- **Vazão**: >53.000 requisições/segundo.
- **Latências**: p50 = 0,53ms, p95 = 7,81ms, p99 = 8,00ms.
- **Erros**: 0.

### 4. Estudo Empírico Controlado (`STUDY.md`)
Um estudo piloto pré-registrado mediu o impacto em 3 tarefas reais de manutenção:
- **Claim Sustentada**: Uma alteração toca em média **1,0 arquivo** em fatias versus **3,7 arquivos** na abordagem convencional em camadas.
- **Claim Não Sustentada**: Fatias verticais *não* exigem menos linhas de código. De fato, fatias escreveram **mais linhas** (+197 vs +151 linhas), pois contratos, DDL, actions e oráculos moram juntos no mesmo arquivo.
- **Métricas Não Medidas**: Consumo de tokens por agentes e tempo de iteração não foram medidos e não são alegados.

---

## 18. Limitações Conhecidas e Fronteiras de Engenharia (Radical Candor)

Para evitar falsas expectativas, declaramos abertamente as fronteiras do projeto:

1. **Exclusividade Bun**: O framework foi feito para Bun (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). Não funciona em Node.js puro, Deno ou Cloudflare Workers sem compatibilidade Bun.
2. **Escopo do Query Builder**: Focado em operações transacionais mono-tabela e joins relacionais 1:1 e 1:N parametrizados. Para queries analíticas massivas com múltiplos agrupamentos ou OLAP, use `db.sql` ou conecte o Kysely através de `ctx.services`.
3. **Escopo de Migrações Reversíveis**: Fatias suportam migrações bidirecionais via demarcações `-- up:` e `-- down:` em conjunto com `synapse rollback`. Para fatias legadas ou comandos sem bloco `-- down:`, as migrações continuam exclusivamente progressivas, necessitando de comandos compensatórios.
4. **Multi-Tenancy na Aplicação**: O isolamento entre tenants é aplicado na camada de software via `requireTenant` e claims de sessão verificados. Não há injeção mágica de RLS (Row Level Security) transparente no banco sem passagem explícita de contexto.
5. **Protocolo Realtime**: O realtime opera via Server-Sent Events (SSE) através do `EventHub` e `useSubscription`. WebSockets full-duplex bidirecionais não fazem parte do kernel do framework.

---

## 19. Contrato Público da API do Pacote

As seguintes exportações públicas são congeladas e verificadas por `packages/synapse/test/machine-types.test.ts`:

```typescript
import {
  // Tratamento Funcional de Erros
  Result, Ok, Err, isOk, isErr, map, mapErr, unwrapOr, Option, Some, None,

  // Runtime, Banco de Dados e Contexto
  SynapseServer, getDatabase, resetDatabaseInstance,
  SqliteDatabaseClient, PostgresDatabaseClient, MockDatabaseClient,
  type DatabaseClient, compileTaggedSql,
  type ActionContext, createActionContext,
  defineConfig, loadSynapseConfig,

  // Armazenamento de Objetos e Otimização
  type StorageClient, getStorage, LocalStorageAdapter, S3StorageAdapter,
  optimizeImage,

  // Background Jobs e Fila Distribuída
  defineJob, QueueEngine, PostgresQueueEngine, type JobRecord, type JobDefinition,

  // RPC Isomórfico e Sessão
  rpcCall, rpcTransportFailure, type RpcTransportError,
  AnonymousSession, createSession, requireAuth, requireTenant,
  hasRole, hasAnyRole, type SessionContext,
  storeSession, clearSession, currentRoles, sessionCookie,
  revokeSessionToken, isSessionTokenRevoked,

  // Validação JIT e PBT
  Type, type Static, type TSchema, Value, fc,

  // Primitivas de UI Declarativas, Hooks e i18n
  DataTable, DataForm, Button, Card, Badge, Pagination,
  SynapseProvider, useAction, useLoaderData, useSubscription, useSession, useSynapseContext,
  createTranslator,

  // Gateway Realtime SSE
  EventHub, getEventHub, resetEventHub,

  // Compilador, Migrações, DAG e Drift
  runSliceMigrations, rollbackSliceMigrations, runMachineVerifications,
  orderSlicesByDag, parseTableDependencies, generateDatabaseSchemaCatalog,
  checkSchemaDrift, analyzeImpact, nestJoinedRow,
  resolveSlicesDir, findSliceFiles, SLICE_EXTENSION,
  splitSlice, verifySplit, writeSplitArtifacts, artifactDirectory,
  scaffoldSlice, scaffoldCrud, parseFields, compressRepositoryAST, buildStandalone,

  // Servidor MCP Nativo
  SynapseMcpServer
} from 'synapsejs';
```

---

## 20. Licença e Créditos

Distribuído sob a **Licença MIT**.

Criado e desenhado por **[Ismael Soilet](https://github.com/ismaelsoilet)**. Feito para engenharia de software resiliente, verificável por máquinas e auditável por humanos.
