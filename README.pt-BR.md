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
  <a href="packages/synapse/test"><img src="https://img.shields.io/badge/Testes-424%20Passando%20(100%25)-emerald?style=for-the-badge&logo=checkmarx" alt="424 Testes Passando"></a>
  <a href="src/mcp"><img src="https://img.shields.io/badge/Servidor%20MCP-15%20Ferramentas%20Nativas%20(11+4)-purple?style=for-the-badge&logo=anthropic" alt="Servidor MCP: 15 Ferramentas Nativas"></a>
  <a href="https://github.com/ismaelsoilet/jev-harness"><img src="https://img.shields.io/badge/Sistema%201-Jev%20Harness%20Ativo-brightgreen?style=for-the-badge&logo=shield" alt="Jev System One"></a>
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

Um **Splitter Isomórfico** baseado em AST decompõe o código de servidor (SQL, credenciais, mutações) do código de navegador (React, stubs RPC) em tempo de compilação com **isolamento AST rigoroso e gates automatizados de verificação de vazamento**.

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

## 🌟 Os 7 Pilares Arquiteturais

| Pilar | Como o SynapseJS Resolve |
|---|---|
| **⚡ Motor de Alta Vazão** | Construído diretamente sobre os módulos nativos do **Bun** (`bun:sqlite`, `Bun.serve`, `Bun.CryptoHasher`, `Bun.build`). Entrega **53.191 req/s** de roteamento HTTP base com latência p50 sub-milissegundo sob alta concorrência. |
| **🛡️ Isolamento AST e Gates de Vazamento** | Análise de alcançabilidade via AST particiona fatias em `shared.tsx`, `server.ts` e `client.tsx`. Gates automatizados do compilador detectam e bloqueiam SQL, segredos, módulos de servidor ou globais do Bun de chegarem ao browser. |
| **🤖 Servidor MCP Nativo (15 Ferramentas)** | Servidor **Model Context Protocol** nativo (`bun run mcp`) com 15 ferramentas (11 do núcleo arquitetural Sistema 2 + 4 de triagem reflexa Jev Sistema 1). Agentes de IA inspecionam esqueletos de código (<3k tokens), detectam desvios de schema (drift), calculam raio de impacto, rodam testes via JSON-RPC e acionam portões semânticos (`synapse_test_gate`, `synapse_abort_check`, `synapse_verify_completion`, `synapse_reasoning_effort`). |
| **🧠 Simbiose Sistema 1 + Sistema 2** | Integração nativa com o harness de decisão não-autoregressivo [Jev System One](https://github.com/ismaelsoilet/jev-harness). Tria falhas de teste em 70-300ms (<500µs local), aborta trajetórias condenadas em loops de refatoração e modula dinamicamente o esforço de raciocínio (Astra-Jev). |
| **🔄 Realtime WebSockets e SSE** | Gateway Server-Sent Events (`GET /_synapse/sse/:topic*`) + WebSockets full-duplex (`defineSocket`, `useWebSocket`) com keep-alive automático a cada 15s, hook cliente `useSubscription` e pub/sub multi-instância via PostgreSQL `LISTEN/NOTIFY`. |
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
  defineAction,
  defineCache,
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

// 5. Server Action (Fail-Closed por padrão, validação automática TypeBox e binding RPC)
export const createTicketAction = defineAction({
  input: TicketInputSchema,
  auth: ['support'], // Fail-Closed: exige sessão autenticada com papel 'support'. Use auth: 'public' para rotas públicas.
  handler: async ({ input, db, session }): Promise<TicketOutput> => {
    if (!db) return Err('NO_DATABASE');
    const ticketId = crypto.randomUUID();

    await db.query(
      `INSERT INTO tickets (id, subject, priority, status) VALUES ($1, $2, $3, 'OPEN')`,
      [ticketId, input.subject, input.priority]
    );

    return Ok({ ticketId });
  }
});

// 6. SSR Data Loader (Executado no servidor antes de enviar o HTML)
export async function createTicketLoader(ctx: { db: DatabaseClient; session: SessionContext }) {
  const recentTickets = await ctx.db.findMany<{ id: string; subject: string; priority: number }>(
    'tickets',
    { limit: 5, orderBy: { created_at: 'DESC' } }
  );
  return { recentTickets };
}

// 7. Política de Cache SSR e ISR (Micro-cache sub-milissegundo em memória)
export const sliceCache = defineCache({
  ttlSeconds: 60,
  staleWhileRevalidateSeconds: 300,
  tags: ['tickets']
});

// 8. Metadados Dinâmicos de SEO
export function sliceMeta(data: { recentTickets?: unknown[] }) {
  return {
    title: 'Chamados de Suporte — SynapseJS',
    description: 'Abra e acompanhe chamados de suporte em tempo real.',
    openGraph: { type: 'website' }
  };
}

// 9. Componente de Interface em React 19
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

// 10. Oráculo de Teste (Executado via bun:test)
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

## ⚡ Micro-Cache SSR de Alta Performance e ISR (Incremental Static Regeneration)

O SynapseJS elimina idas desnecessárias ao banco de dados e re-renderizações SSR em rotas de alta leitura. As fatias declaram suas políticas de cache nativamente via `defineCache`:

```tsx
export const sliceCache = defineCache({
  ttlSeconds: 60,                      // Serve HTML instantâneo da memória (HIT) por 60 segundos
  staleWhileRevalidateSeconds: 300,     // Serve HTML expirado imediatamente (STALE) enquanto atualiza em background
  tags: ['tickets', 'portal-suporte']  // Chaves de invalidação atômica
});
```

- **Hits Sub-Milissegundo em Memória**: O HTML em cache é entregue em **< 0,5 ms** diretamente da memória RAM com o cabeçalho `X-Synapse-Cache: HIT`.
- **ISR em Background Sem Bloqueio**: Quando o conteúdo entra na janela `staleWhileRevalidate`, o usuário recebe o HTML em cache instantaneamente (`X-Synapse-Cache: STALE`) enquanto o Synapse reexecuta o loader e re-renderiza o HTML em segundo plano sem travar a requisição.
- **Invalidação Atômica por Tags**: Quando uma ação executa uma mutação, invalide páginas em cache imediatamente via `ctx.invalidateCache(['tickets'])` ou programaticamente com `server.invalidateCache(['tickets'])`.
- **Transparência HTTP**: O servidor emite cabeçalhos `Cache-Control: public, max-age=60, stale-while-revalidate=300` para integração transparente com CDNs de borda (Cloudflare, Fastly).

---

## 🛡️ Endurecimento para Produção & Resiliência (v1.6.0)

O SynapseJS v1.6.0 introduz proteções de resiliência de nível corporativo projetadas para implantações de confiança zero em produção:

- **SSRF & Network Guard**: `validateExternalUrl` e `isPrivateOrReservedIp` bloqueiam ativamente ataques de SSRF (Server-Side Request Forgery) direcionados a loopback, CIDRs privados IPv4/IPv6, endpoints de metadados de nuvem (`169.254.169.254`, AWS, GCP, Azure) e ataques de DNS rebinding. Otimização de imagens estáticas impõe contenção estrita ao diretório `public/`.
- **Anti-Spoofing & Rate Limiting Limitado (LRU)**: O limitador de taxa Token Bucket adota despejo LRU (limitado a 10.000 buckets) e resolução de IP no nível do socket (`trustProxy`), prevenindo esgotamento de memória e ataques de negação de serviço por spoofing de cabeçalhos.
- **Micro-Cache SSR com LRU Delimitado**: O cache em memória impõe limites de armazenamento com LRU e normaliza URLs ordenando parâmetros de query e removendo tokens de rastreamento/anúncios (`utm_*`, `fbclid`, `gclid`).
- **Limites Estritos de Carga Útil**: Rejeição automática HTTP 413 para payloads RPC que excedem o limite (`maxRpcPayloadBytes`, 5MB) e Webhooks (`maxWebhookPayloadBytes`, 10MB), com retorno HTTP 400 em JSON malformado.
- **Recuperação Automática de Jobs Zumbis**: As filas de background em SQLite e PostgreSQL rastreiam carimbos de data/hora `locked_at` para recuperar automaticamente tarefas abandonadas quando workers sofrem falhas ou crash.
- **Isolamento de Erros SSR**: Falhas de renderização ou em loaders retornam HTTP 500 com `X-Robots-Tag: noindex, nofollow` e suprimem tags de script do bundle cliente, prevenindo descompassos de hidratação e indexação indevida por motores de busca.
- **Propagação Segura de Cookies HttpOnly**: Actions podem definir cookies via `ctx.setCookie('name', 'val', { httpOnly: true, secure: true })`, propagados pelo Synapse nos cabeçalhos de resposta RPC via `Set-Cookie`.
- **Graceful Shutdown**: `synapse start` e `server.stop(drainTimeoutMs)` drenam conexões ativas em uma janela de 5 segundos durante deploys contínuos e reinicializações de contêineres.

---

## 🧠 Arquitetura Cognitiva Dupla: SynapseJS + Jev System One

A engenharia de software com agentes de codificação de IA autônomos (Claude, Cursor, Windsurf, Antigravity) enfrenta dois gargalos sistêmicos:
1. **Fricção Estrutural de Sistema 2:** Arquiteturas em camadas dispersam código por 5 a 7 diretórios, forçando o agente a desperdiçar mais de 15.000 tokens de contexto em alucinações de importação e sincronização de arquivos. O SynapseJS resolve isso com **Locality of Behavior ($N = 1$)** e fatias verticais contíguas (`*.slice.tsx`).
2. **Desperdício Cognitivo de Sistema 1:** Quando um agente encontra uma falha transitória de ambiente, dependência ausente ou erro sintático pontual, modelos LLM autoregressivos convencionais queimam dezenas de milhares de tokens em loops circulares de "raciocínio profundo", tentando refatorar regras de negócio que já estavam corretas.

O SynapseJS opera nativamente em simbiose com o **[Jev System One](https://github.com/ismaelsoilet/jev-harness)** para fornecer a primeira arquitetura cognitiva de duas camadas da indústria:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT / CODING LLM                              │
└───────────────────▲────────────────────────────────▲───────────────────┘
                    │                                │
       [Decisões Reflexas & Gating]        [Execução & Locality N=1]
                    │                                │
┌───────────────────┴────────────────┐  ┌────────────┴───────────────────┐
│        JEV-HARNESS                 │  │          SYNAPSEJS             │
│        (Sistema 1 Cognitivo)       │  │          (Sistema 2 Estrutural)│
├────────────────────────────────────┤  ├────────────────────────────────┤
│ • Decisões semânticas em 70-300ms  │  │ • Locality of Behavior (N = 1) │
│ • Heurísticas locais (< 500µs)     │  │ • Fatias verticais (*.slice.tsx│
│ • Triagem de testes (test-gate)    │  │ • Oráculos PBT com fast-check  │
│ • Aborto de loops (abort-check)    │  │ • AST Splitter (zero data-leak)│
│ • Modulação de raciocínio Astra-Jev│  │ • MCP Server Nativo (15 tools) │
│ • Zero desperdício em erros de env │  │ • Migrações DDL por fatia & PBT│
└────────────────────────────────────┘  └────────────────────────────────┘
```

### ⚡ Portão Semântico de Testes (`synapse test --gate`)

Ao rodar os oráculos de teste das fatias, a flag `--gate` (ou a presença de `.jev.json`) ativa automaticamente a triagem não-autoregressiva:

```bash
# Executa os oráculos com triagem semântica Jev System One
bun run synapse test --gate
```

Se um teste falhar por problemas de ambiente ou dependência ausente, o Jev System One sinaliza `skipLlm = true` com alta confiança ($>0.85$), prescrevendo a correção determinística (ex: `bun install`) sem desperdiçar tokens de raciocínio da LLM:

```json
{
  "operation": "PBT_ORACLE_TEST_SUITE",
  "status": "FAIL",
  "triage": {
    "category": "env_missing",
    "confidence": 1.0,
    "skipLlm": true,
    "skipLlmProb": 0.86,
    "severityScore": 0.73,
    "actionRecommendation": "AUTO-ACTION: Install missing dependency or check environment configuration (Do NOT call LLM)."
  }
}
```

### 🛡️ Modo Offline Determinístico (Zero-Config)
Caso não haja conexão de rede ou credenciais remotas configuradas, o Jev-Harness executa instantaneamente via **heurísticas locais determinísticas (<500µs)**, assegurando que builds locais, hooks de pre-commit do Git e esteiras de CI/CD nunca fiquem bloqueados.

📖 *Para especificações detalhadas de arquitetura, modulação de raciocínio Astra-Jev e configuração de provedores, veja [docs/jev-integration.md](docs/jev-integration.md).*

---

## 🤖 Feito para Agentes de IA: Servidor Nativo MCP (Model Context Protocol)

O SynapseJS é o primeiro framework concebido desde o primeiro dia para ser operado com eficácia por **agentes de codificação de IA autônomos** (Cursor, Claude Code, Windsurf, Antigravity).

Em vez de forçar o modelo a ler dezenas de arquivos aleatoriamente, o SynapseJS expõe **15 ferramentas MCP nativas** via JSON-RPC 2.0 stdio:

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

### As 15 Ferramentas MCP Nativas

| Ferramenta MCP | Domínio | Capacidade |
|---|---|---|
| `synapse_get_repo_map` | Sistema 2 | Retorna o esqueleto comprimido do codebase em AST (`.codebase/repo-map.d.ts`, <3000 tokens). |
| `synapse_get_db_schema` | Sistema 2 | Retorna o catálogo centralizado de schemas de banco (`.codebase/db-schema.d.ts`) para consultas imediatas. |
| `synapse_check` | Sistema 2 | Executa diagnósticos estáticos retornando coordenadas exatas de erro (`file`, `line`, `col`, `code`). |
| `synapse_split` | Sistema 2 | Executa o particionamento de fatias e valida os gates anti-vazamento (Zero-Leak). |
| `synapse_run_pbt` | Sistema 2 | Roda testes baseados em propriedades Fast-Check e identifica invariantes violados. |
| `synapse_scaffold_slice` | Sistema 2 | Cria novas fatias usando templates e gramática de `--fields`. |
| `synapse_migrate` | Sistema 2 | Aplica migrações declarativas de forma idempotente em SQLite ou PostgreSQL. |
| `synapse_rollback` | Sistema 2 | Desfaz alterações de schema de forma transacional usando blocos down. |
| `synapse_contract` | Sistema 2 | Expõe a especificação completa de contratos do framework, semântica HTTP e regras de nomenclatura. |
| `synapse_check_db_drift` | Sistema 2 | Compara o banco de dados em tempo real com as fatias para detectar tabelas e colunas órfãs ou faltantes. |
| `synapse_diff_impact` | Sistema 2 | Calcula o raio de impacto de alterações em schemas, chaves estrangeiras e módulos compartilhados. |
| `synapse_test_gate` | **Sistema 1 (Jev)** | Executa oráculos PBT e tria falhas imediatamente com gating não-autoregressivo para evitar desperdício de tokens. |
| `synapse_abort_check` | **Sistema 1 (Jev)** | Avalia planos propostos e histórico de erros para detectar loops de refatoração circulares e trajetórias condenadas. |
| `synapse_verify_completion` | **Sistema 1 (Jev)** | Verifica adversarialmente a implementação da fatia e saídas de teste contra critérios de aceitação antes de comitar. |
| `synapse_reasoning_effort` | **Sistema 1 (Jev)** | Modula dinamicamente o esforço de raciocínio do modelo (Astra-Jev) para economizar tokens em etapas mecânicas. |

---

## 📊 Benchmarks Empíricos e Evidências Medidas

Para assegurar total transparência, todas as métricas abaixo foram geradas por scripts automatizados presentes no repositório:

### 1. Concorrência e Roteamento HTTP Base (`bun run bench:concurrency`)
Medição do roteamento base do servidor HTTP nativo `Bun.serve` (`/_synapse/api/health`) sob concorrência de 50 conexões simultâneas ao longo de 1.000 requisições:

```text
🚀 Resultados do Benchmark de Concorrência (Roteamento HTTP Base):
────────────────────────────────────────────
Vazão (Throughput):  53.191 requisições/segundo
Latência (p50):      0,53 ms
Latência (p95):      7,81 ms
Latência (p99):      8,00 ms
Falhas/Erros:        0 (0,00%)
Delta de Memória:    < 6 MB
────────────────────────────────────────────
```

### 2. Vazão de Mutações de Banco em Produção (`bun run bench:production`)
Teste de ponta a ponta de mutações fullstack via RPC e SQLite sob 40 clientes simultâneos executando 500 transações reais:

```text
🚀 Benchmark de Mutações SQLite em Produção:
────────────────────────────────────────────
Vazão (Throughput):  4.001,28 requisições/segundo (10.7x mais rápido vs 375 req/s não otimizado)
Latência (p50):      1,10 ms (latência 22.7x menor vs 24,99 ms não otimizado)
Latência (p95):      17,47 ms
Latência (p99):      20,45 ms
Falhas/Erros:        0 (0,00%)
Pragmas Ativos:      WAL, busy_timeout=5000, synchronous=NORMAL, cache_size=-64000
────────────────────────────────────────────
```

### 3. Benchmark de Superfície de Contexto (`bun run bench`)
Comparação entre duas funcionalidades idênticas ("abrir chamado" e "atribuir chamado") implementadas em fatias verticais contra arquitetura em camadas tradicional:

| Arquitetura | Arquivos Tocados / Feature | Superfície de Tokens da Aplicação | Custo de Coordenação |
|---|---|---|---|
| **Fatias Verticais SynapseJS** | **1 arquivo** | **~1.400 tokens** | $\mathcal{O}(1)$ contexto contíguo |
| **Arquitetura Tradicional em Camadas** | **5 arquivos** | **~1.830 tokens** | $\mathcal{O}(N)$ espalhado em várias pastas |

### 4. Taxa de Aprovação da Suíte de Testes
```text
424 pass
0 fail
1637 chamadas expect()
424 testes executados em 56 arquivos. (100% Gates Verdes)
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
synapse test [--gate]               # Executa oráculos de teste de propriedades (com gating opcional Jev System 1)

# Banco de Dados e Migrações
synapse migrate                     # Aplica instruções de DDL pendentes de forma idempotente
synapse rollback [fatia] [--steps]  # Desfaz migrações de forma transacional usando blocos down
synapse db-drift                    # Compara schema do banco ativo com as declarações das fatias
synapse impact <alvo>               # Calcula o raio de impacto entre FKs, tabelas e imports

# Geração de Código e IA
synapse new-slice <domínio> <nome>  # Cria fatia vertical (templates: create, list, crud, login, 2fa, oauth)
synapse new-shared <nome>           # Cria módulo de domínio compartilhado em src/shared/<nome>.ts com transação
synapse skeleton                    # Regenera .codebase/repo-map.d.ts e .codebase/db-schema.d.ts
synapse mcp                         # Inicia o servidor Model Context Protocol via stdio (15 ferramentas incl. Jev System 1)
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
3. **Multi-Tenancy em Nível de Aplicação**: O isolamento de tenants é garantido na borda da aplicação via `requireTenant` e tokens de sessão assinados. Para bancos PostgreSQL que exijam isolamento estrito no próprio motor de banco, recomenda-se o uso de Row Level Security (RLS).
4. **Escopo Realtime**: Suporta tanto Server-Sent Events (SSE) leves via `EventHub` / `useSubscription` para notificações push, quanto WebSockets full-duplex persistentes (`defineSocket` / `useWebSocket`) para streaming interativo de alta frequência.
5. **Segurança Fail-Closed por Padrão**: Ações declaradas com `defineAction` rejeitam chamadas anônimas por padrão (`UNAUTHORIZED`), exigindo `auth: 'public'` para liberação explícita. O runtime do servidor inclui filtragem de CORS, mitigação contra CSRF e validação de cookies/sessões assinadas com HMAC (`SYNAPSE_SESSION_SECRET`).
6. **DAG Declarativo de Migrações**: Dependências e chaves estrangeiras entre tabelas de fatias são mapeadas num grafo acíclico (`orderSlicesByDag`), garantindo que pais sejam criados antes de filhos. Alterações incrementais (`ALTER TABLE`) em produção devem ser registradas como declarações de migração versionadas.

---

## 📄 Licença e Autor

Distribuído sob a **[Licença MIT](LICENSE)**.

Criado e mantido por **[Ismael Soilet](https://github.com/ismaelsoilet)**. Construído para engenharia de software resiliente, verificável por máquinas e auditável por humanos.
