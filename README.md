# SynapseJS ⚡

> Framework fullstack para **Bun**, construído em torno de um invariante: **uma feature é um único
> arquivo contíguo.** Contrato de entrada, DDL, server action, UI React e oráculo de teste moram
> juntos em `*.slice.tsx`, e o tooling em volta existe para manter esse invariante utilizável por
> uma máquina.

~3k LOC de framework, um app de referência, um template. Não é uma plataforma — e não é um
"Agentic OS": essa alegação (e a fórmula matemática que a acompanhava) foi removida na 0.4.0,
junto com todas as features prometidas que não funcionavam.

---

## Status — toda claim tem um teste

Cada feature abaixo vem com o comando que falha quando ela quebra. Nada entra como **stable** sem um.

### Stable

| Feature | Evidência |
|---|---|
| Fatias verticais (N = 1) com Locality of Behavior | `bun test packages/synapse/test/locality.test.ts` |
| Controle de fluxo `Result<T, E>` sem helper público que lança | `bun test packages/synapse/test/machine-types.test.ts` |
| Contratos de entrada JIT com TypeBox | `bun test packages/synapse/test/slice-contract.test.ts` |
| Migrações declarativas de `sliceSchema` (AST, idempotente **por statement**) | `bun test packages/synapse/test/migration-runner.test.ts` |
| Erro de domínio vira status HTTP coerente (401/403/404/409/422/500) | `bun test packages/synapse/test/runtime-server.test.ts` |
| Hidratação React com bundle de cliente gerado pelo splitter | `bun test packages/synapse/test/runtime-server.test.ts` |
| Sessão assinada (com segredo, papel de header deixa de valer) | `bun test packages/synapse/test/runtime-server.test.ts` |
| CORS fechado por padrão, CSRF fechado por `Content-Type`, `public/` servido | `bun test packages/synapse/test/runtime-server.test.ts` |
| SQLite embutido (WAL, cache de statement, leitura segura de CTE) | `bun test packages/synapse/test/sqlite-client.test.ts` |
| RBAC explícito via `requireAuth(session, roles)` | `bun test packages/synapse/test/slice-contract.test.ts` + `bun run test:e2e` |
| Roteamento zero-wiring, shell SSR e dispatcher RPC | `bun run test:e2e` |
| Descoberta de fatias que nunca retorna PASS com zero fatias | `bun test packages/synapse/test/slice-discovery.test.ts` |
| Splitter isomórfico (shared/server/client) com dois gates | `bun test packages/synapse/test/slice-splitter.test.ts` |
| Skeletonizer para `.codebase/repo-map.d.ts` (tipado, sem `any`) | `bun test packages/synapse/test/repo-map.test.ts` |
| Catálogo Central de Schema DAG (`.codebase/db-schema.d.ts`) | `bun test packages/synapse/test/db-schema-generator.test.ts` |
| Query Builder Isomórfico (`findMany`, `findOne`, `insert`, `update`, `delete`) | `bun test packages/synapse/test/query-builder.test.ts` |
| Primitivas de UI e Hooks (`DataTable`, `DataForm`, `useAction`, `useLoaderData`) | `bun test packages/synapse/test/client-primitives.test.ts` |
| Object Storage Unificado (Local + S3/R2/MinIO com URLs pré-assinadas SigV4) | `bun test packages/synapse/test/storage.test.ts` |
| Fila Distribuída PostgreSQL (`FOR UPDATE SKIP LOCKED`) | `bun test packages/synapse/test/postgres-queue.test.ts` |
| Scaffolder com gramática `--fields` e oráculos PBT automáticos | `bun test packages/synapse/test/fields-parser.test.ts` + `bun test packages/synapse/test/scaffolder.test.ts` |
| Suíte MCP nativa (10 ferramentas JSON-RPC 2.0) | `bun test packages/synapse/test/mcp-server.test.ts` |
| Empacotamento Standalone (`synapse build --standalone`) | `bun test packages/synapse/test/standalone-builder.test.ts` |
| Invariantes das fatias sob `bun:test`, com relatório por invariante | `bun test packages/synapse/test/oracle-runner.test.ts` + `bun run test:helpdesk` |
| Paridade PostgreSQL (migrações, DDL, round-trip de action) | `bun run test:postgres` (CI roda um serviço `postgres:16-alpine`) |
| Lint e format com Biome | `bun run lint` — 0 erros |
| Ensaio de publicação (o artefato que um estranho instalaria) | `bun run rehearse:publish` — acha bugs de empacotamento que nenhum outro gate vê |
| CI no GitHub Actions (3 jobs: suíte, paridade PostgreSQL, ensaio) | [run 36220544931](https://github.com/ismaelsoilet/synapsejs/actions/runs/36220544931) — verde na primeira execução real |
| Benchmark de superfície de contexto | `bun run bench` |
| Benchmark de concorrência e estresse real | `bun run bench:concurrency` |
| Tagged SQL nativo (`db.sql` e `db.sqlOne`) com interpolação segura | `bun test packages/synapse/test/sql-tagged.test.ts` |
| Background Jobs & Fila SQLite com retry exponencial e dead-letter | `bun test packages/synapse/test/jobs-queue.test.ts` |
| Gateway de Webhooks com preservação de rawBody (Uint8Array) para HMAC | `bun test packages/synapse/test/webhooks.test.ts` |
| Multi-tenancy B2B & Prevenção IDOR via `requireTenant` | `bun test packages/synapse/test/multi-tenancy.test.ts` |
| DAG de Migrações DDL e Ordenação Topológica de Foreign Keys | `bun test packages/synapse/test/schema-dag.test.ts` |
| UI Layouts (`_layout.tsx`) e Router SPA Turbo Morphing | `bun test packages/synapse/test/layouts-morphing.test.ts` |
| Realtime Declarativo via SSE (`EventHub` + `useSubscription`) | `bun test packages/synapse/test/event-hub.test.ts` + `bun test packages/synapse/test/sse-gateway.test.ts` |
| Relational Joins & Sub-Object Nesting (`nestJoinedRow`) | `bun test packages/synapse/test/query-builder-joins.test.ts` |
| Detecção de Schema Drift (`synapse db-drift`) | `bun test packages/synapse/test/schema-drift.test.ts` |
| Análise de Impacto AST & Blast Radius (`synapse impact`) | `bun test packages/synapse/test/impact-analyzer.test.ts` |
| Template OAuth2 Social Auth (`oauth-github`) | `bun test packages/synapse/test/scaffolder.test.ts` |

### Experimental

| Feature | O que falta |
|---|---|
| Repasse de credencial por cookie no shell SSR | É uma conveniência de demonstração, não uma fronteira de segurança (o RBAC é aplicado no servidor) |

### Roadmap

| Feature | Nota |
|---|---|
| Live Subscriptions / WebSockets | SSE/WebSocket nativo para sincronização em tempo real de fatias |
| Query Builder com Joins Profundos | Suporte a relações declarativas aninhadas (graph relations / joins tipados) |
| Rollback de Migrações DDL | Suporte a migrações reversas (down-migrations automáticas) |
| Integração com Provedores OAuth2 / OIDC | Gerador de slices para autenticação social (Google, GitHub, Auth0) |

---

## Topologia

```text
packages/synapse/
  src/core/          Result/Option, DatabaseClient, SQLite, Postgres, QueryBuilder, Storage, PostgresQueue, sessão, RPC
  src/client/        Primitivas de UI declarativas (DataTable, DataForm, Button, Card, Badge, Pagination, useAction, useLoaderData)
  src/compiler/      slice-discovery, migration-runner, db-schema-generator, fields-parser, oracle-runner, scaffolder, splitter, repo-map, standalone-builder
  src/runtime/       roteador Bun.serve + shell SSR + dispatcher RPC + SynapseProvider
  src/mcp/           servidor MCP stdio (8 ferramentas completas)
  bin/synapse.ts     a CLI
  templates/starter/ o template que `synapse new` copia (com Dockerfile e standalone build)
  test/              suíte bun:test + fixtures dos gates do splitter, dos oráculos e do bench
Dockerfile           imagem de produção multi-stage (Bun on Alpine, ~90MB)
examples/enterprise-crm/       app de referência: 3 fatias + suíte e2e ao vivo (12 checagens)
examples/helpdesk-slices/      as mesmas 2 features de outro domínio, em 2 fatias
examples/helpdesk-conventional/ as mesmas 2 features em camadas, sem o framework (adoção + comparador)
.synapse/                      gerado (gitignored): banco sqlite, artefatos do split, wrappers de oráculo
.codebase/                     repo map e schema catalog gerados (commitados por app)
AGENTS.md                      contrato completo para agentes autônomos
```

## Começando

```bash
bunx synapsejs new my-app
cd my-app
bun install
bun run dev            # http://localhost:3000
bun run new-slice users register-user --fields="name:string,email:string,role:enum(ADMIN|USER)"
bun run test
bun run mcp            # servidor MCP via stdio
bun run build --standalone # compila para .synapse/standalone/
```

## Limitações Conhecidas & Fronteiras de Engenharia (Radical Candor)

Para manter transparência técnica absoluta e evitar falsas expectativas:

1. **Bun Exclusivo:** O SynapseJS é construído sobre primitivas nativas do Bun (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). Não roda sobre Node.js puro, Deno ou Cloudflare Workers sem compatibilidade Bun.
2. **Query Builder Single-Table:** O query builder cobre com segurança e tipagem operações transacionais em tabelas individuais (`findMany`, `findOne`, `insert`, `update`, `delete` com filtros relacionais e paginação). Para joins complexos multi-tabelas ou queries OLAP, utilize `db.sql` / `db.query` parametrizado ou adapters Kysely no `ctx.kysely`.
3. **Migrações Forward-Only:** O engine de migração é idempotente por statement, gravando cada comando executado em `_synapse_migration_statements`. Não há migração reversa ("down") automática; reversões devem ser declaradas como novas migrações corretivas.
4. **Isolamento de Tenants a Nível de Aplicação:** O multi-tenancy é garantido de ponta a ponta na camada de aplicação via `requireTenant` e claims de sessão validados. Não há injeção mágica de RLS (Row Level Security) transparente no banco sem passagem explícita do tenant.
5. **Tempo Real (WebSockets):** O framework oferece navegação SPA fluida via SSR + Turbo Morphing; WebSockets / SSE bidirecionais de live subscription ainda não possuem abstração unificada no kernel.

## Anatomia de uma fatia

Tudo de uma feature, num arquivo:

```tsx
import { Type, Static, Value, Ok, Err, type Result, type DatabaseClient } from 'synapsejs';

export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 })
});
export type TicketInput = Static<typeof TicketInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL
  );
`;

export type TicketOutput = Result<{ ticketId: string }, 'INVALID_SCHEMA' | 'NO_DATABASE'>;

// `db` é opcional para que o mesmo ponto de chamada valha no servidor (que injeta
// a conexão) e no cliente (onde a chamada vira stub RPC).
export async function createTicketAction(
  payload: unknown,
  db?: DatabaseClient
): Promise<TicketOutput> {
  if (!db) return Err('NO_DATABASE');
  if (!Value.Check(TicketInputSchema, payload)) return Err('INVALID_SCHEMA');

  const input = payload as TicketInput;
  await db.query(`INSERT INTO tickets (id, subject, priority) VALUES ($1, $2, $3)`, [
    crypto.randomUUID(),
    input.subject,
    input.priority
  ]);
  return Ok({ ticketId: 'ticket-1' });
}

export function CreateTicketTrigger() {
  return <form>{/* a UI mora aqui também */}</form>;
}

export const sliceTests = {
  description: 'Invariantes de bilhetes',
  run: async () => {
    /* asserções em JS puro — executadas por `synapse test` */
  }
};
```

## Recursos de Produção & SaaS

SynapseJS combina o invariante $N = 1$ com capacidades de nível corporativo para aplicações SaaS de grande porte:

### 1. Tagged SQL Nativo & Kysely Híbrido
O `ActionContext` e o `DatabaseClient` suportam template literals com parametrização automática contra injeção SQL e tipagem completa via `db.sql` e `db.sqlOne`:
```ts
const customers = await db.sql<Customer>`
  SELECT * FROM customers 
  WHERE status = ${status} AND tenant_id = ${session.tenantId}
`;
```
Para projetos que necessitam de um query builder relacional completo, o Kysely pode ser plugado sem inflar o núcleo do framework: registre sua instância no `synapse.config.ts` através de `services: { kysely: new Kysely(...) }` ou utilize o dialect adaptado com `ctx.db`.

### 2. Background Jobs e Worker de Fila SQLite
Jobs assíncronos e tarefas em segundo plano (e-mails, webhooks de saída, sincronização) são declarados com `defineJob`:
```ts
export const sendWelcomeEmailJob = defineJob<EmailPayload>({
  name: 'send-welcome-email',
  retryLimit: 3,
  backoffSeconds: 5,
  perform: async (payload, ctx) => {
    await ctx.services.mailer.send(payload.email, 'Bem-vindo!');
  }
});
```
Disparo com garantia transacional na Action:
```ts
await ctx.enqueue(sendWelcomeEmailJob, { email: input.email });
```
Processamento contínuo em processo dedicado com atomicidade SQLite WAL + RETURNING:
```bash
synapse worker
```

### 3. Gateway de Webhooks com Raw Body Preservado
Fatias podem exportar handlers `<Name>Webhook` em `POST /_synapse/webhooks/:domain/:name`. O evento preserva `rawBody: Uint8Array` intacto para validação criptográfica (HMAC) de assinaturas externas como Stripe (`Stripe-Signature`) e GitHub:
```ts
export async function stripeWebhook(event: WebhookEvent, ctx: ActionContext) {
  const sig = event.headers.get('stripe-signature');
  const stripeEvent = stripe.webhooks.constructEvent(event.bodyText, sig, webhookSecret);
  return { received: true };
}
```

### 4. Multi-tenancy B2B & Prevenção IDOR
O contexto de sessão propaga `tenantId` (resolvido por cabeçalho `x-tenant-id`, subdomínio ou token assinado). O helper `requireTenant` valida acesso sem exceções:
```ts
const auth = requireTenant(session, expectedTenantId);
if (!auth.ok) return Err(auth.error); // Retorna Err('FORBIDDEN') determinístico
```

### 5. DAG de Migrações DDL e Ordenação Topológica
As migrações de `sliceSchema` analisam referências de Foreign Key e ordenam as fatias em um grafo acíclico direcionado (DAG de Kahn), garantindo que tabelas-mãe sejam criadas antes das tabelas dependentes.

### 6. UI Layouts Hierárquicos e Router SPA Turbo Morphing
Layouts de raiz em `src/slices/_layout.tsx` envolvem páginas SSR sem necessidade de boilerplate. A navegação cliente é acelerada pelo Router Turbo Morphing (`/_synapse/turbo-router.js`), atualizando o DOM `#synapse-root` de forma reativa sem recarregamento completo da página.

## Isolamento Client / Server

`synapse split` particiona cada fatia por **alcançabilidade resolvida pelo type checker** em
`shared.tsx`, `server.ts` e `client.tsx`, e então roda dois gates:

1. **Compilação** — os três módulos são typechecked com o tsconfig do seu projeto.
2. **Sem vazamento** — o módulo cliente não pode conter SQL, `db.query`, `sliceSchema`,
   `process.env` nem `Bun.`.

Gate vermelho é build vermelho, com coordenadas — não é aviso. Descoberta de fatias, migrações e
splitter se recusam a reportar sucesso quando nada foi verificado.

## Medido

| Medição | Valor |
|---|---|
| `bun run check` (monorepo inteiro, 4 apps) | ~3s nesta máquina (varia) |
| `bun run check --fast` | removido — 2.5s (mais lento que o check completo) |
| Repo map do app de exemplo | ~1101 tokens (orçamento 3000) |
| Suíte do framework | 301 testes, 40 arquivos (`bun test packages/synapse/test`) |
| Suíte e2e | 12 checagens (SSR, RPC, RBAC, idempotência) |
| Paridade PostgreSQL | verificada contra `postgres:16-alpine` (migração, DDL, round-trip de action) |

## Superfície de contexto (o que o agente precisa ler)

As mesmas duas features implementadas em duas stacks — `bun run bench`:

| app | feature | arquivos (app) | tokens (app, ≈) | arquivos (total) | tokens (total, ≈) |
|---|---|---|---|---|---|
| helpdesk-slices | abrir chamado | 1 | 1.6k (1627) | 43 | 85.3k |
| helpdesk-slices | atribuir chamado | 1 | 1.4k (1393) | 43 | 85.1k |
| helpdesk-conventional | abrir chamado | 5 | 1.8k (1832) | 5 | 1.8k (1832) |
| helpdesk-conventional | atribuir chamado | 5 | 1.8k (1832) | 5 | 1.8k (1832) |

O fecho é a entrada declarada em `bench.config.json` mais tudo que ela importa. A UI do app
convencional é declarada explicitamente porque quem a liga é o bundler, não um `import` — no app de
fatias ela está no mesmo arquivo por construção. Contagens de arquivo são exatas e estáveis; tokens
são arredondados porque derivam a cada mudança de código (`bun run bench` imprime os do commit atual).

**O que isso mostra:** a convenção de fatia reduz de **5 arquivos para 1** o que precisa ser
coordenado para mudar uma feature. É a claim de Locality of Behavior, medida em vez de afirmada.

**O que isso não mostra:** a vantagem em **tokens** é pequena e depende do critério (≈1.6k vs ≈1.8k,
dentro de ±15% — e o arquivo único carrega contrato, DDL, action, UI e oráculo juntos, então sua
vantagem aqui vem de não repetir imports e boilerplate entre camadas, não de ser menor por natureza).
A coluna `total` da stack de fatias é o **barrel do framework** alcançado pelo mapeamento `paths`
(≈28k tokens) — um superconjunto do que a feature precisa, pago **uma vez** e compartilhado por todas
as features; a coluna `total` do app convencional são seus próprios arquivos, porque suas dependências
moram em `node_modules`. As duas colunas não são custo-por-feature comparável, e é por isso que ambos
os números aparecem. `node_modules` e `.d.ts` ficam de fora dos dois lados; tokens são bytes/4.

**O que continua não medido:** se menos arquivos melhora o resultado de um agente. Isso é
comportamental e exige um protocolo com agente real — o harness mede superfície de contexto, não
taxa de sucesso.

## Licença

MIT © Ismael Soilet
