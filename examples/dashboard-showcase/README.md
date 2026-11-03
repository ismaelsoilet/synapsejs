# Synapse Showcase

Aplicação de demonstração do **SynapseJS** — o framework Bun onde uma feature inteira
(contrato TypeBox, DDL, server action, loader, UI React e oráculo) vive em um único
arquivo `*.slice.tsx`.

Este app roda em `http://localhost:3000` e expõe, de ponta a ponta, as capacidades do
runtime: CRUD, upload/download, SSE, WebSocket, jobs/worker/cron, cache SSR/ISR, auth
assinada/RBAC, webhooks HMAC, streaming HTTP, rotas dinâmicas, catálogo de features e
as 23 ferramentas MCP.

## Rodar

```bash
bun install
bun run migrate      # cria as tabelas das slices no SQLite
bun run build        # CSS Tailwind + bundles de cliente
bun run start        # servidor em :3000 (secret de demonstração incluído no script)

# em outro terminal, para processar jobs:
bun run worker
```

Para desenvolvimento com rebuild automático:

```bash
bun run dev
bun run worker
```

O script `start` define `SYNAPSE_SESSION_SECRET=showcase-demo-secret` **apenas para a
demo**. Em produção, defina um segredo próprio e não reutilize o valor deste repositório.

## Contas demo

| Conta | Senha | Papéis |
|---|---|---|
| `admin@synapse.dev` | `demo1234` | admin, writer, support |
| `editor@synapse.dev` | `demo1234` | writer |
| `viewer@synapse.dev` | `demo1234` | viewer |

O login usa `Bun.password.verify` + `signSessionToken`; o token vira cookie
`synapse_token` e o runtime o valida como `Authorization: Bearer` nas ações e no upload.
`admin` pode excluir itens do inventário; `writer` pode atualizar; `viewer` só lê.

## Rotas

| Rota | O que demonstra |
|---|---|
| `/showcase/home` | hub, métricas ao vivo, animações e checklist |
| `/inventory/list-items` | CRUD, busca com highlight, quick filters, filtros avançados, badges, paginação e export CSV |
| `/inventory/create-item` | DataForm + TypeBox |
| `/showcase/files` | upload com progresso/abort, preview, download autenticado, delete |
| `/showcase/realtime` | SSE declarado (`defineTopic`) + WebSocket (`defineSocket`) |
| `/showcase/jobs` | fila SQLite, worker, retry, cron e status ao vivo |
| `/showcase/cache` | TTL, stale-while-revalidate e invalidação por tag |
| `/showcase/stream` | `ctx.stream()` em chunks reais consumidos pelo browser |
| `/showcase/webhooks` | entrega assinada HMAC-SHA256 + eventos persistidos |
| `/showcase/profile/:id` | rota dinâmica, loader SSR e `useParams` |
| `/showcase/platform` | inventário completo de features + 23 MCP tools |
| `/auth/login` | login assinado, contas demo e RBAC |

O shell tem sidebar responsiva, command palette com atalho detectado pelo SO
(**⌘ K** no macOS, **Ctrl K** no Windows/Linux), drawer mobile, sessão/login/logout
e uma camada de microinterações.

Cada demo tem um guia expansível **“O que é / Quando usar / Como funciona / Observe”**
para explicar a ferramenta no contexto em que ela aparece — por exemplo, WebSocket
para chats e presença, SSE para feeds e notificações, jobs para e-mail/relatórios,
webhooks para pagamentos e o ListView para catálogos administrativos.

## ListView

`/inventory/list-items` é a demonstração de listagem completa:

- busca textual no servidor com **highlight** do termo;
- **quick filters** com contagem por status e estoque baixo;
- **filtros avançados** de categoria, status, faixa de preço, estoque e ordenação;
- **chips de filtros ativos** que removem um filtro sem perder os demais;
- **badges** de categoria/status, barra de estoque e data;
- paginação server-side e export CSV da página;
- estado inteiro preservado na URL para links compartilháveis.

## Aparência e movimento

O botão de aparência na topbar abre o painel de tema:

- **Sistema**, **Claro** ou **Escuro**;
- cinco paletas de destaque: ciano, violeta, esmeralda, âmbar e rosa;
- animações ligadas/desligadas, com respeito a `prefers-reduced-motion`.

As preferências ficam em `localStorage` (`showcase.theme`, `showcase.accent`,
`showcase.motion`) e o boot em `public/theme-boot.js` aplica o tema antes do primeiro
paint. A camada visual inclui ripple no clique, barra de progresso de navegação,
entrada de páginas, animação de modais, contagem animada dos KPIs e transições de tema.

## O que é real nesta demo

- **Uploads/downloads:** `POST /_synapse/files/showcase/files` grava no storage local
  (`.synapse/uploads/showcase`), exige sessão e valida a extensão contra os bytes reais.
  O download passa por `GET /_showcase/download?key=…`, que valida o cookie assinado e
  impede path traversal.
- **SSE/WebSocket:** `defineTopic` declara o tópico; `ctx.broadcast` publica no hub;
  `defineSocket` mantém o canal duplex. O adaptador do runtime serializa objetos para
  JSON, então `ws.send({ type: 'CHAT' })` chega ao browser como JSON válido.
- **Jobs:** o action enfileira via `ctx.enqueue`; `bun run worker` processa o
  `.synapse/queue.sqlite`. O job de falha proposital exercita retry. A **DLQ é do engine
  PostgreSQL**; no SQLite, o job esgotado permanece `failed`.
- **Cache:** `defineCache` é aplicado pelo SSR; `ctx.invalidateCache(['tag'])` invalida
  imediatamente. O cache é por processo — reiniciar o servidor o limpa.
- **Webhooks:** o handler usa o `rawBody` e compara HMAC com `timingSafeEqual`; assinatura
  inválida retorna 400 antes do parse.
- **Streaming:** o plugin de aplicação em `synapse.config.ts` intercepta
  `GET /_showcase/stream` e devolve `ctx.stream()`; o componente lê com `ReadableStream`.
- **Auth/RBAC:** tokens assinados, `storeSession`/`clearSession`, roles reais nas ações.

## O que exige configuração externa

O catálogo em `/showcase/platform` lista todas as capacidades e suas evidências. OAuth
social, S3/R2, PostgreSQL, e-mail e pagamentos não estão conectados a provedores nesta
demo; quando o serviço não está configurado, a página não finge que está. O contrato e os
comandos estão no catálogo.

## Verificação

```bash
bun run check     # diagnósticos do compilador em todas as slices
bun run test      # oráculos das slices
bun run split     # shared/server/client + gates de compilação e zero-leak
bun run build     # build:css + bundles de cliente
```

Na raiz do monorepo, o gate de CSS determinístico (`bun --cwd examples/dashboard-showcase
build:css` + `git diff --exit-code`) impede divergência entre `src/styles/main.css` e
`public/synapse.css`.

## Limites conhecidos

- O segredo de sessão e o segredo de webhook têm valores de demonstração no repositório;
  troque-os antes de qualquer deploy real.
- Storage local, cache, rate limiter e hub de eventos são por processo.
- WebSocket exige uma origem allowlist; `localhost` é o carve-out de desenvolvimento.
- O worker precisa rodar em um processo separado (`bun run worker`).
- Não há integração de e-mail/pagamento/OAuth real nesta demo.
