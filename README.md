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
| Migrações declarativas de `sliceSchema` (AST, hash, idempotente) | `bun test packages/synapse/test/migration-runner.test.ts` |
| SQLite embutido (WAL, cache de statement, leitura segura de CTE) | `bun test packages/synapse/test/sqlite-client.test.ts` |
| RBAC explícito via `requireAuth(session, roles)` | `bun test packages/synapse/test/slice-contract.test.ts` + `bun run test:e2e` |
| Roteamento zero-wiring, shell SSR e dispatcher RPC | `bun run test:e2e` |
| Descoberta de fatias que nunca retorna PASS com zero fatias | `bun test packages/synapse/test/slice-discovery.test.ts` |
| Splitter isomórfico (shared/server/client) com dois gates | `bun test packages/synapse/test/slice-splitter.test.ts` |
| Skeletonizer para `.codebase/repo-map.d.ts` (tipado, sem `any`) | `bun test packages/synapse/test/repo-map.test.ts` |
| Servidor MCP stdio (5 ferramentas) | `bun test packages/synapse/test/mcp-server.test.ts` |
| Invariantes das fatias sob `bun:test`, com relatório por invariante | `bun test packages/synapse/test/oracle-runner.test.ts` + `bun run test:helpdesk` |
| Paridade PostgreSQL (migrações, DDL, round-trip de action) | `bun run test:postgres` (CI roda um serviço `postgres:16-alpine`) |
| Lint e format com Biome | `bun run lint` — 0 erros; 17 warnings de `noExplicitAny`, todos fronteira dinâmica (postgres.js, MCP, SQL) |
| Ensaio de publicação (o artefato que um estranho instalaria) | `bun run rehearse:publish` — acha bugs de empacotamento que nenhum outro gate vê |
| CI no GitHub Actions (3 jobs: suíte, paridade PostgreSQL, ensaio) | [run 36220544931](https://github.com/ismaelsoilet/synapsejs/actions/runs/36220544931) — verde na primeira execução real |
| Benchmark de superfície de contexto | `bun run bench` |

### Experimental

| Feature | O que falta |
|---|---|
| Repasse de credencial por cookie no shell SSR | É uma conveniência de demonstração, não uma fronteira de segurança (o RBAC é aplicado no servidor) |

### Roadmap

| Feature | Nota |
|---|---|
| Daemon de diagnósticos incrementais | `check --fast` foi **removido** na 0.4.0: medido mais lento que o check completo (2.5s vs 1.9s), porque o cache `.tsbuildinfo` nunca era lido de volta entre processos |
| Bundling de produção | `split` emite módulos; alimentar `Bun.build` com dois targets não está implementado |
| Fluxo de login no exemplo | O RBAC é aplicado, mas as credenciais vêm de headers ou cookies |
| Estudo replicado com implementadores independentes | O piloto tem 1 executor (este agente) e 3 tarefas; ver `STUDY.md` |

---

## Topologia

```text
packages/synapse/
  src/core/          Result/Option, DatabaseClient, SQLite, Postgres, sessão, cliente RPC
  src/compiler/      slice-discovery, migration-runner, oracle-runner, scaffolder, splitter, repo-map, bench
  src/runtime/       roteador Bun.serve + shell SSR + dispatcher RPC
  src/mcp/           servidor MCP stdio (5 ferramentas)
  bin/synapse.ts     a CLI
  templates/starter/ o template que `synapse new` copia
  test/              suíte bun:test + fixtures dos gates do splitter, dos oráculos e do bench
examples/enterprise-crm/       app de referência: 3 fatias + suíte e2e ao vivo (12 checagens)
examples/helpdesk-slices/      as mesmas 2 features de outro domínio, em 2 fatias
examples/helpdesk-conventional/ as mesmas 2 features em camadas, sem o framework (adoção + comparador)
.synapse/                      gerado (gitignored): banco sqlite, artefatos do split, wrappers de oráculo
.codebase/                 repo map gerado (commitado por app)
AGENTS.md                  contrato completo para agentes autônomos
```

## Começando

```bash
bunx synapsejs new my-app
cd my-app
bun install
bun run dev            # http://localhost:3000
bun run new-slice users register-user
bun run test
bun run mcp            # servidor MCP via stdio
```

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
| Repo map do app de exemplo | ~1005 tokens (orçamento 3000) |
| Suíte do framework | 110 testes, 13 arquivos |
| Suíte e2e | 12 checagens (SSR, RPC, RBAC, idempotência) |
| Paridade PostgreSQL | verificada contra `postgres:16-alpine` (migração, DDL, round-trip de action) |

## Superfície de contexto (o que o agente precisa ler)

As mesmas duas features implementadas em duas stacks — `bun run bench`:

| app | feature | arquivos (app) | tokens (app, ≈) | arquivos (total) | tokens (total, ≈) |
|---|---|---|---|---|---|
| helpdesk-slices | abrir chamado | 1 | 1.6k | 20 | 28.6k |
| helpdesk-slices | atribuir chamado | 1 | 1.4k | 20 | 28.4k |
| helpdesk-conventional | abrir chamado | 5 | 1.8k | 5 | 1.8k |
| helpdesk-conventional | atribuir chamado | 5 | 1.8k | 5 | 1.8k |

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
