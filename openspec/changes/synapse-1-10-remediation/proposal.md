# Proposal

## Why

As oito ondas de evolução estão implementadas no working tree, mas o release **não é reprodutível**:
`bun test packages/synapse/test` falha a suíte padrão (9 a 13 falhas, dependendo da execução),
`bun run docs:check` falha por drift de contagens, e o CI foi reduzido a `workflow_dispatch`. O
relatório que declarou "APPROVED sem ressalvas" usou `NODE_ENV=development` sem declarar isso e
não executou o gate de documentação.
Publicar 1.10.0 nesse estado transforma uma melhoria real em uma promessa não verificável.

Além do release gate, a auditoria encontrou defeitos funcionais nas ondas novas: cron com
semântica AND onde o padrão é OR; `HAVING` incompatível com PostgreSQL; `runAt` morto; pipeline
de CSS que nunca é acionado; RBAC granular que não chega ao token assinado; `new-domain` que
devolve Ok parcial; guia oficial com `db.tx` (a API é `db.transaction`). Corrigir agora é mais
barato do que depois de adotantes reais. A execução fica bloqueada até as decisões D1, D3, D4,
D5, D6, D7 e D10 serem confirmadas em `audit-and-decisions.md`; o plano usa defaults provisórios,
mas silêncio não é aprovação.

## What Changes

**Release gate e evidência**

- Tornar `bun test packages/synapse/test` e `bun run test:all` verdes **sem variáveis de ambiente**,
  corrigindo o harness de `act`/React 19, o estado global entre testes e os testes sensíveis a
  duração; duas execuções consecutivas sob carga precisam passar.
- Fazer `bun run docs:check` comparar ferramentas, testes, arquivos, versão e warnings com a fonte
  única, e falhar em qualquer divergência; `docs-check`/`coverage-check` não podem reinjetar
  `NODE_ENV=development` no processo filho.
- Restaurar CI em push/PR (gate rápido) e manter a suíte completa em main/release, com a
  configuração de required checks registrada como evidência ou decisão de hospedagem.
- Exigir um `release-evidence` reproduzível por release e um `verify-release-evidence.ts` que
  reexecuta os comandos e confere o commit; nenhum "APPROVED" sem essa verificação.

**Correção funcional**

- `HAVING` portável: aceitar expressão agregada (`SUM(amount) > $1`) ou rejeitar alias de forma
  explícita em engines que não o suportam; teste real em PostgreSQL.
- Cron com semântica POSIX (OR entre dia-do-mês e dia-da-semana quando ambos são restritos),
  validação de faixas e `runAt` honrado ou removido do contrato.
- Cron e DLQ com escopo de engine explícito: suportado em SQLite e PostgreSQL, ou
  `CRON_UNSUPPORTED_ENGINE` documentado, nunca ignorado em silêncio.
- Permissões no token assinado, com validação de claims e compatibilidade com tokens antigos.
- OAuth com timeout/abort, `state` verificável e teste de troca de código contra stub local.

**Integração de UI e assets**

- Ligar o bundle de CSS ao build/boot (sem deadlock link↔rota); não injetar tema dark hardcoded.
- Integrar `SliceErrorBoundary` ao caminho de renderização do cliente e testá-lo.
- Preservar foco/checked/scroll na navegação SPA, com escape de chaves e fallback de navegação.
- `new-domain` atômico (Err + rollback dos arquivos criados), documentado no help/README e testado
  via MCP; `WARN_LARGE_SLICE` com fixture e limiar alinhado ao guia.

**Documentação e estratégia**

- Corrigir contagens e claims; atualizar o guia de arquitetura para `db.transaction`; documentar
  `new-domain`; registrar a matriz de evidências com comandos exatos e env vars.
- Adicionar guardrail de TypeScript 7: range declarado, erro claro quando a API do compilador não
  existe, job de CI com TS 5.9 e smoke com TS 7, e uma decisão registrada entre vendorizar 5.9,
  migrar para a API nova ou usar a CLI. A migração completa fica para 1.11.

**BREAKING (documentar no CHANGELOG e no guia de migração):**

- Cron passa a aplicar OR entre dia-do-mês e dia-da-semana quando ambos são restritos; schedules
  existentes com os dois campos restritos mudam de comportamento.
- `HAVING` deixa de aceitar alias de saída como condição em engines que não o suportam; chamadas
  existentes precisam usar expressão agregada ou coluna real.
- `new-domain` deixa de devolver Ok em falha parcial; passa a `Err` com os caminhos criados.
- Se o error boundary for padrão, uma falha de renderização passa a mostrar fallback em vez de
  propagar; a flag de opt-out restaura o comportamento anterior.

## Capabilities

### New Capabilities

- `release-gate-integrity`: testes, documentação e CI reproduzíveis sem env vars ocultas, com
  evidência de release versionada.
- `database-query-portability`: agregações, `HAVING`, `count`, `exists` e `aggregate` com o mesmo
  contrato em SQLite e PostgreSQL, SQL seguro e testes reais nos dois engines.
- `scheduled-job-semantics`: cron POSIX, `runAt`, payload, DLQ e escopo de engine explícitos.
- `asset-and-ui-integration`: CSS sem deadlock, error boundary integrado e navegação SPA que
  preserva o estado prometido.
- `domain-scaffolding-safety`: `new-domain`/`new-shared`/MCP seguros, atômicos e documentados,
  além do diagnóstico `WARN_LARGE_SLICE`.
- `session-and-oauth-integrity`: permissões no token assinado, bypass de admin explícito e OAuth
  com `state`, timeout e testes de troca de código.
- `documentation-and-claims`: documentação, guia e claims alinhados ao comportamento real e
  verificáveis pelos scripts citados.
- `compiler-api-compatibility`: dependência da API JS do TypeScript 5.x declarada, testada e com
  decisão de migração para TS 7 registrada.

### Modified Capabilities

Nenhuma. `openspec/specs/` está vazio; este change introduz o baseline de specs do projeto.

## Impact

**Código:** `packages/synapse/src/core/{query-builder,database-client,sqlite-client,postgres-client,postgres-queue,cron-parser,jobs,session-context,session-token,oauth-client}.ts`,
`packages/synapse/src/runtime/{queue-engine,server}.ts`,
`packages/synapse/src/compiler/{client-bundler,scaffolder,slice-splitter,slice-templates}.ts`,
`packages/synapse/src/client/{error-boundary,sub-slice}.tsx`, `packages/synapse/src/mcp/{tools,server}.ts`,
`packages/synapse/bin/synapse.ts`.

**Testes:** `query-builder`, `cron-queue`, `session-security`, `scaffolder`, `mcp-server`,
`hydration`, `browser-hooks`, `runtime-server`, `production-hardening`, `docs-claims`, além de um
novo teste real de PostgreSQL para agregações e um teste de bootstrap do CSS.

**Docs/config:** `AGENTS.md`, `README.md`, `README.pt-BR.md`, `packages/synapse/README.md`,
`RELEASE-CHECKLIST.md`, `CHANGELOG.md`, `docs/arquitetura-sistemas-grandes.pt-BR.md`,
`.github/workflows/ci.yml`, `packages/synapse/package.json`, `templates/starter/package.json`.

**Fora de escopo:** implementar paridade de cron no PostgreSQL em 1.10 (recomendação: 1.11),
migração completa para TypeScript 7, novo produto/posicionamento de mercado, reescrita do
benchmark de agentes. Esses itens aparecem em `recommendations.md` como trilhas separadas.
