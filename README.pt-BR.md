<p align="center">
  <img src="https://raw.githubusercontent.com/ismaelsoilet/synapsejs/main/.github/assets/synapse-banner.png" alt="Banner SynapseJS" width="100%" onerror="this.style.display='none'"/>
</p>

# SynapseJS ⚡

<p align="center">
  <strong>O Framework Fullstack Nativo para Bun Criado para Humanos e Agentes de IA Autônomos.</strong><br>
  <em>Uma funcionalidade = Um único arquivo contíguo e à prova de vazamentos (<code>*.slice.tsx</code>).</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-blue.svg?style=for-the-badge" alt="Licença: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-v1.2+-black?style=for-the-badge&logo=bun" alt="Bun v1.2+"></a>
  <a href="packages/synapse/test"><img src="https://img.shields.io/badge/Testes-359%20Passando%20(100%25)-emerald?style=for-the-badge&logo=checkmarx" alt="359 Testes Passando"></a>
  <a href="src/mcp"><img src="https://img.shields.io/badge/Servidor%20MCP-11%20Ferramentas%20Nativas-purple?style=for-the-badge&logo=anthropic" alt="Servidor MCP"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19%20SSR-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"></a>
  <a href="https://github.com/sinclairzx81/typebox"><img src="https://img.shields.io/badge/Valida%C3%A7%C3%A3o-TypeBox%20JIT-orange?style=for-the-badge" alt="TypeBox"></a>
</p>

<p align="center">
  🇺🇸 <a href="README.md"><strong>English</strong></a> | 🇧🇷 <strong>Português do Brasil</strong>
</p>

---

## ⚡ Por que SynapseJS?

O desenvolvimento fullstack moderno quebrou a produtividade dos desenvolvedores. Para mudar um simples botão, consulta ou regra de validação, você é obrigado a navegar por **5 a 7 camadas desacopladas em pastas diferentes**:

```text
❌ ARQUITETURA EM CAMADAS TRADICIONAL (FRAGMENTADA):
routes/customers.ts  ──────►  controllers/customerController.ts
                                    │
dto/customer.dto.ts  ◄──────────────┼──────────────►  services/customerService.ts
                                    │
entities/Customer.ts ◄──────────────┼──────────────►  migrations/001_create_customers.sql
                                    │
components/CustomerForm.tsx ◄───────┼──────────────►  tests/customer.test.ts
```

Para desenvolvedores humanos, isso gera uma sobrecarga cognitiva brutal. Para **agentes de codificação de IA** (Claude, Cursor, Windsurf, Antigravity), desperdiça dezenas de milhares de tokens de contexto, induz erros de acoplamento oculto e dispara alucinações de importação.

### A Revolução do SynapseJS: Locality of Behavior ($N = 1$)

O SynapseJS elimina essa dispersão arquitetural por completo: **uma funcionalidade é um único arquivo contíguo** (`*.slice.tsx`).

```text
✅ FATIA VERTICAL SYNAPSEJS (src/slices/customers/create-customer.slice.tsx):
┌────────────────────────────────────────────────────────────────────────┐
│  1. Contrato de Entrada ── Schema TypeBox JIT (validado em microssegundos) │
│  2. DDL de Banco        ── SQL declarativo rastreado (up e down)       │
│  3. Result Funcional    ── União estrita Result<T, E> (zero exceptions)│
│  4. Server Action       ── Lógica de negócio transacional e mutação    │
│  5. SSR Loader          ── Prefetching de dados no servidor            │
│  6. View React 19       ── UI declarativa com binding RPC automático   │
│  7. Oráculo de Teste    ── Testes baseados em propriedades (PBT via fast-check) │
└────────────────────────────────────────────────────────────────────────┘
```

Um **Splitter Isomórfico** baseado em AST decompõe o código de servidor (SQL, credenciais, mutações) do código de navegador (React, stubs RPC) em tempo de compilação com **gates criptográficos anti-vazamento (Zero-Leak)**.

---

## 🚀 Início Rápido em 30 Segundos

Inicie uma aplicação completa em produção em menos de 30 segundos:

```bash
# 1. Crie uma nova aplicação
bunx @ismaelsoilet/synapsejs new meu-saas-app

# 2. Acesse a pasta do projeto e instale
cd meu-saas-app
bun install

# 3. Inicie o servidor de desenvolvimento com migrações em tempo real e Dev Hub
bun run dev
```

Abra `http://localhost:3000` no seu navegador para ver sua aplicação e o Developer Hub interativo.

### Gere uma Fatia Vertical Completa com um Único Comando

```bash
bun run new-slice customers create-customer --fields="name:string,email:string,role:enum(ADMIN|USER)"
```

A CLI gera instantaneamente:
- Validador de entrada completo com TypeBox
- Tabela SQL com rastreamento automatizado de migrações
- Server action tipada retornando `Result<Customer, 'INVALID_SCHEMA' | 'DUPLICATE_EMAIL'>`
- Componente de interface interativo e acessível em React 19
- Suíte de oráculos com testes baseados em propriedades (PBT) executados via `bun:test`

---

## 🌟 Os 6 Pilares Arquiteturais

| Pilar | Como o SynapseJS Resolve |
|---|---|
| **⚡ Velocidade Brutal** | Construído diretamente sobre os módulos nativos do **Bun** (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). Entrega **>48.000 req/s** com latência p50 sub-milissegundo e cold-start imediato. |
| **🛡️ Splitter Isomórfico Zero-Leak** | Análise de alcançabilidade via AST particiona fatias em `shared.tsx`, `server.ts` e `client.tsx`. Gates de compilação bloqueiam rigorosamente SQL, segredos ou globais do Bun de chegarem ao browser. |
| **🤖 Servidor MCP Nativo (11 Ferramentas)** | Servidor **Model Context Protocol** de primeira classe (`bun run mcp`). Agentes de IA inspecionam esqueletos de código (<3k tokens), detectam desvios de schema (drift), calculam raio de impacto e rodam testes via JSON-RPC. |
| **🔄 Realtime SSE e Pub/Sub Distribuído** | Gateway nativo Server-Sent Events (`GET /_synapse/sse/:topic*`) com heartbeat automático de 15 segundos, hook cliente `useSubscription` e pub/sub multi-instância via PostgreSQL `LISTEN/NOTIFY`. |
| **🗄️ Migrações Declarativas e Rollback** | O DDL vive nas fatias e é rastreado declaração por declaração com hash SHA-256. Suporta demarcações reversíveis `-- up:` / `-- down:` e rollback transacional atômico (`synapse rollback`). |
| **🔒 Segurança Funcional e Oráculos PBT** | Zero exceptions não tratadas em tempo de execução: erros são valores de união tipados em `Result<T, E>`. Cada fatia traz oráculos matemáticos integrados com `fast-check`. |

---

## 🧩 Anatomia de uma Fatia Real (*.slice.tsx)

Veja a estrutura autêntica de uma fatia vertical completa em produção (`src/slices/tickets/create-ticket.slice.tsx`):

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
  DataTable,
  Button
} from 'synapsejs';

// 1. Contrato de Entrada (Schema TypeBox JIT)
export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 })
});
export type TicketInput = Static<typeof TicketInputSchema>;

// 2. DDL do Banco de Dados (Reversível, rastreado em _synapse_migration_statements)
export const sliceSchema = `
  -- up:
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- down:
  DROP TABLE IF EXISTS tickets;
`;

// 3. Contrato de Saída Estrito (Result Funcional)
export type TicketOutput = Result<
  { ticketId: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// 4. Background Job
export const notifyStaffJob = defineJob<{ ticketId: string }>({
  name: 'notify-staff-ticket',
  retryLimit: 3,
  backoffSeconds: 5,
  perform: async (payload) => {
    console.log(`Notificação enviada para o chamado ${payload.ticketId}`);
  }
});

// 5. Server Action (No servidor: mutação; no browser: compilada em stub RPC)
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

// 6. SSR Data Loader (Executado no servidor antes de enviar o HTML)
export async function createTicketLoader(ctx: { db: DatabaseClient; session: SessionContext }) {
  const recentTickets = await ctx.db.findMany<{ id: string; subject: string; priority: number }>(
    'tickets',
    { limit: 5, orderBy: { created_at: 'DESC' } }
  );
  return { recentTickets };
}

// 7. Metadados Dinâmicos de SEO
export function sliceMeta(data: { recentTickets?: unknown[] }) {
  return {
    title: 'Chamados de Suporte — SynapseJS',
    description: 'Abra e acompanhe chamados de suporte em tempo real.',
    openGraph: { type: 'website' }
  };
}

// 8. Componente de Interface em React 19
export function CreateTicketComponent(props: {
  recentTickets?: Array<{ id: string; subject: string; priority: number }>;
  onSubmitAction?: (payload: unknown) => Promise<TicketOutput>;
}) {
  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Abrir Chamado de Suporte</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          const res = await props.onSubmitAction?.({
            subject: String(data.get('subject')),
            priority: Number(data.get('priority'))
          });
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
        <DataTable
          data={props.recentTickets}
          columns={[
            { key: 'subject', header: 'Assunto' },
            { key: 'priority', header: 'Prioridade' }
          ]}
        />
      )}
    </div>
  );
}

// 9. Oráculo de Teste (Executado via bun:test)
export const sliceTests = {
  description: 'Invariantes de Chamados de Suporte',
  cases: [
    {
      name: 'chamadas anônimas retornam UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const res = await createTicketAction({ subject: 'Queda de Rede', priority: 1 });
        if (res.ok || res.error !== 'UNAUTHORIZED') {
          throw new Error(`Esperava UNAUTHORIZED, recebido: ${JSON.stringify(res)}`);
        }
      }
    }
  ]
};
```

### O Invariante de Ouro: Fatias Nunca Importam Fatias
```text
┌──────────────────────────────────────────────┐
│       src/slices/billing/invoice.slice.tsx   │
└──────────────────────┬───────────────────────┘
                       │ ❌ ESTRITAMENTE PROIBIDO
                       ▼
┌──────────────────────────────────────────────┐
│      src/slices/customers/customer.slice.tsx │
└──────────────────────┬───────────────────────┘
                       │
        Ambas importam │ lógica compartilhada
                       ▼
┌──────────────────────────────────────────────┐
│          src/shared/transactions.ts          │
│   (Recebe DatabaseClient, abre db.tx)        │
└──────────────────────────────────────────────┘
```
Se duas funcionalidades precisam transacionar juntas ou compartilhar estado, essa coordenação pertence a `src/shared/<modulo>.ts`. Violações são interceptadas em tempo de compilação pelo analisador de AST sob o código de erro `SLICE_IMPORTS_SLICE`.

---

## 🤖 Feito para Agentes de IA: Servidor Nativo MCP (Model Context Protocol)

O SynapseJS é o primeiro framework concebido desde o primeiro dia para ser operado com eficácia por **agentes de codificação de IA autônomos** (Cursor, Claude Code, Windsurf, Antigravity).

Em vez de forçar o modelo a ler dezenas de arquivos aleatoriamente, o SynapseJS expõe **11 ferramentas MCP nativas** via JSON-RPC 2.0 stdio:

```bash
bun run mcp
```

### Configuração no Agente (`claude_desktop_config.json` ou `cursor.json`)

```json
{
  "mcpServers": {
    "synapsejs": {
      "command": "bunx",
      "args": ["synapse", "mcp"],
      "cwd": "/caminho/para/seu/projeto-synapse"
    }
  }
}
```

### As 11 Ferramentas MCP Nativas

| Ferramenta MCP | Capacidade |
|---|---|
| `synapse_get_repo_map` | Retorna o esqueleto comprimido do codebase em AST (`.codebase/repo-map.d.ts`, <3000 tokens). |
| `synapse_get_db_schema` | Retorna o catálogo centralizado de schemas de banco (`.codebase/db-schema.d.ts`) para consultas imediatas. |
| `synapse_check` | Executa diagnósticos estáticos retornando coordenadas exatas de erro (`file`, `line`, `col`, `code`). |
| `synapse_split` | Executa o particionamento de fatias e valida os gates anti-vazamento (Zero-Leak). |
| `synapse_run_pbt` | Roda testes baseados em propriedades Fast-Check e identifica invariantes violados. |
| `synapse_scaffold_slice` | Cria novas fatias usando templates e gramática de `--fields`. |
| `synapse_migrate` | Aplica migrações declarativas de forma idempotente em SQLite ou PostgreSQL. |
| `synapse_rollback` | Desfaz alterações de schema de forma transacional usando blocos down. |
| `synapse_contract` | Expõe a especificação completa de contratos do framework, semântica HTTP e regras de nomenclatura. |
| `synapse_check_db_drift` | Compara o banco de dados em tempo real com as fatias para detectar tabelas e colunas órfãs ou faltantes. |
| `synapse_diff_impact` | Calcula o raio de impacto de alterações em schemas, chaves estrangeiras e módulos compartilhados. |

---

## 📊 Benchmarks Empíricos e Evidências Medidas

Para assegurar total transparência, todas as métricas abaixo foram geradas por scripts automatizados presentes no repositório:

### 1. Concorrência e Vazão HTTP (`bun run bench:concurrency`)
Medição do servidor HTTP nativo `Bun.serve` sob concorrência de 50 conexões simultâneas ao longo de 1.000 requisições:

```text
🚀 Resultados do Benchmark de Concorrência:
────────────────────────────────────────────
Vazão (Throughput):  53.191 requisições/segundo
Latência (p50):      0,53 ms
Latência (p95):      7,81 ms
Latência (p99):      8,00 ms
Falhas/Erros:        0 (0,00%)
Delta de Memória:    < 6 MB
────────────────────────────────────────────
```

### 2. Benchmark de Superfície de Contexto (`bun run bench`)
Comparação entre duas funcionalidades idênticas ("abrir chamado" e "atribuir chamado") implementadas em fatias verticais contra arquitetura em camadas tradicional:

| Arquitetura | Arquivos Tocados / Feature | Superfície de Tokens da Aplicação | Custo de Coordenação |
|---|---|---|---|
| **Fatias Verticais SynapseJS** | **1 arquivo** | **~1.400 tokens** | $\mathcal{O}(1)$ contexto contíguo |
| **Arquitetura Tradicional em Camadas** | **5 arquivos** | **~1.830 tokens** | $\mathcal{O}(N)$ espalhado em várias pastas |

### 3. Taxa de Aprovação da Suíte de Testes
```text
359 pass
0 fail
1351 chamadas expect()
359 testes executados em 49 arquivos. (100% Gates Verdes)
```

---

## 🛠️ Referência da CLI

Todos os comandos de CLI emitem JSON estruturado no `stdout` com códigos de saída padronizados (`0` para PASS, `1` para FAIL):

```bash
# Servidor de Desenvolvimento e Produção
synapse dev [porta] [--watch]       # Inicia servidor dev com descoberta automática e migrações
synapse start [porta]               # Inicia servidor de produção com graceful shutdown (SIGTERM)

# Diagnósticos e Segurança
synapse check [arquivo]             # Diagnósticos estáticos com coordenadas exatas de linha/coluna
synapse split                       # Particiona fatias em módulos shared, server e client
synapse test                        # Executa oráculos de teste de propriedades sob bun:test

# Banco de Dados e Migrações
synapse migrate                     # Aplica instruções de DDL pendentes de forma idempotente
synapse rollback [fatia] [--steps]  # Desfaz migrações de forma transacional usando blocos down
synapse db-drift                    # Compara schema do banco ativo com as declarações das fatias
synapse impact <alvo>               # Calcula o raio de impacto entre FKs, tabelas e imports

# Geração de Código e IA
synapse new-slice <domínio> <nome>  # Cria fatia vertical (templates: create, list, crud, login, 2fa, oauth)
synapse skeleton                    # Regenera .codebase/repo-map.d.ts e .codebase/db-schema.d.ts
synapse mcp                         # Inicia o servidor Model Context Protocol via stdio
synapse build [--standalone]        # Pré-compila micro-bundles de browser ou pacote standalone
synapse worker                      # Inicia worker contínuo para filas de background jobs
synapse contract [--markdown]       # Emite especificação técnica de contratos do framework
```

---

## 📦 Deploy de Produção e Docker

### Build de Produção Standalone
Compile sua aplicação em um pacote autocontido e pronto para execução:
```bash
synapse build --standalone
```
Os artefatos são gerados na pasta `.synapse/standalone/`, incluindo ponto de entrada do servidor e bundles do cliente.

### Imagem Docker
```bash
docker build -t meu-app-synapse .
docker run -p 3000:3000 -e SYNAPSE_SESSION_SECRET="seu-segredo" meu-app-synapse
```
- **Tamanho da Imagem**: ~90MB (Alpine Linux + Bun).
- **Segurança**: Executa sob usuário desprivilegiado `bun`.

---

## ⚖️ Integridade de Engenharia e Transparência Radical

1. **Exclusividade Bun**: O SynapseJS aproveita diretamente as APIs nativas do Bun (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.password`, `Bun.build`). Não executa em Node.js ou Deno.
2. **Escopo do Query Builder**: Otimizado para transações de tabela única e joins relacionais tipados. Consultas analíticas complexas (OLAP) pertencem ao SQL parametrizado (`db.sql`) ou a ferramentas dedicadas como Kysely via `ctx.services`.
3. **Multi-Tenancy em Nível de Aplicação**: O isolamento de tenants é garantido na borda da aplicação via `requireTenant` e tokens de sessão assinados.
4. **Escopo Realtime**: O realtime opera via Server-Sent Events (SSE) através do `EventHub` e do hook `useSubscription`. WebSockets bidirecionais contínuos não fazem parte do núcleo.

---

## 📄 Licença e Autor

Distribuído sob a **[Licença MIT](LICENSE)**.

Criado e mantido por **[Ismael Soilet](https://github.com/ismaelsoilet)**. Construído para engenharia de software resiliente, verificável por máquinas e auditável por humanos.
