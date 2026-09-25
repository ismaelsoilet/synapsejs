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
| Fatias verticais (N = 1) com Locality of Behavior | `examples/enterprise-crm`, `packages/synapse/templates/starter` |
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

### Experimental

| Feature | O que falta |
|---|---|
| Oráculos PBT por fatia | Executados como processos isolados julgados por exit code; não é um runner completo |
| Cliente PostgreSQL | Sem cobertura de CI contra uma instância PostgreSQL real |

### Roadmap

| Feature | Nota |
|---|---|
| Daemon de diagnósticos incrementais | `check --fast` foi **removido** na 0.4.0: medido mais lento que o check completo (2.5s vs 1.9s), porque o cache `.tsbuildinfo` nunca era lido de volta entre processos |
| Bundling de produção | `split` emite módulos; alimentar `Bun.build` com dois targets não está implementado |
| Fluxo de login no exemplo | O RBAC é aplicado, mas as credenciais vêm de headers ou cookies |

---

## Topologia

```text
packages/synapse/
  src/core/          Result/Option, DatabaseClient, SQLite, Postgres, sessão, cliente RPC
  src/compiler/      slice-discovery, migration-runner, scaffolder, splitter, repo-map, diagnostics
  src/runtime/       roteador Bun.serve + shell SSR + dispatcher RPC
  src/mcp/           servidor MCP stdio (5 ferramentas)
  bin/synapse.ts     a CLI
  templates/starter/ o template que `synapse new` copia
  test/              suíte bun:test + fixtures dos gates do splitter
examples/enterprise-crm/   app de referência: 3 fatias + suíte e2e ao vivo (12 checagens)
.synapse/                  gerado (gitignored): banco sqlite, artefatos do split
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
| `bun run check` (monorepo inteiro, 3 workspaces) | ~1.8s |
| `bun run check --fast` | removido — 2.5s (mais lento) |
| Repo map do app de exemplo | ~930 tokens (orçamento 3000) |
| Suíte do framework | 79 testes, 10 arquivos |
| Suíte e2e | 12 checagens (SSR, RPC, RBAC, idempotência) |

## Licença

MIT © Ismael Soilet
