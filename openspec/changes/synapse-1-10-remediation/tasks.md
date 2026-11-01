# Tasks

## Execution status (2026-10-31)

Groups 1–10 were implemented against the working tree; **`bash scripts/run-gates.sh` passed
21/21**, and the local gates are green:
`bun test packages/synapse/test` (600 pass / 10 skip / 0 fail, 610 tests / 75 files),
`bun run test:all`, `bun run check`, `bun run check:template`, `bun run docs:check`,
`bun run lint` (0 errors, 67 warnings), `bun run coverage:check` (62.55% functions / 75.16% lines),
`bun run split`, the slice oracles, the live e2e, both benchmarks, the repo-map drift gate,
the publish rehearsal and the negative cases.

Progress: **62 of 72 tasks checked**. Still operator/CI-dependent and therefore not claimed as
locally verified: `3.6` (GitHub branch protection/required checks), `4.5`/`5.4` (PostgreSQL engine
tests are skipped without `TEST_DATABASE_URL`; CI runs them), `8.6` (air-gapped browser layout is
documented, not visually inspected), `10.2`/`10.3`/`10.6` (the TS 7 smoke is a CI job), `11.3`
(live PostgreSQL parity), `11.4` (browser/air-gapped manual check) and `11.5` (tag/publish requires a
clean commit). `11.6` was replayed successfully by `scripts/verify-release-evidence.ts`.

**Tier SureForge:** Standard. **Execução autorizada pelo mantenedor em 2026-10-31**; o framework
permanece como está (D-STRAT-01: sem extração de MCP/split). **Decisões:** a lista autoritativa é
**Blocking decisions** em `audit-and-decisions.md` (D1, D3, D4, D5, D6, D7, D10), aprovadas pela
instrução de execução.

**Gate global de cada grupo:** os comandos citados passam **sem variáveis de ambiente**; nenhum
arquivo fora do escopo do grupo é modificado; `git status` é revisado antes de avançar. O runner
canônico é `bash scripts/run-gates.sh` (24 gates com `--with-docker`), não uma lista à mão.

## 1. Baseline, inventário e decisões

- [x] 1.0 Criar um inventário `wave → arquivos → requisito` para as oito ondas (incluindo 5, 6 e 8,
      que hoje só aparecem como títulos de teste); verificar que cada onda tem pelo menos um
      requisito e uma tarefa associados
- [x] 1.1 Registrar o baseline em `release-evidence/1.10.0-baseline.md` com commit, `git status`
      (28 rastreados + 7 não rastreados), totais reais, nomes das falhas, `error`, skips e
      wall-clock de `bun test`, `docs:check` e `test:all`; verificar que o arquivo contém saídas
      reais e que os arquivos não rastreados foram inventariados/stageados
- [x] 1.2 Confirmar ou alterar as decisões bloqueantes em `audit-and-decisions.md`; verificar que
      cada uma tem `approved`, `rejected` ou `unanswered` explícito e que o escopo das tarefas
      afetadas foi ajustado
- [x] 1.3 Reconciliar `coverage-ledger.csv` e `requirement-map.csv` com as specs finais, incluindo
      linhas PostgreSQL para DQP/SJS, browser/air-gapped para DSS e oracle para SOI; verificar que
      todo requisito tem linha e que o CSV é parseável

## 2. Gate de teste reproduzível

- [x] 2.1 Estabelecer `NODE_ENV=test` no preload antes de qualquer import de React e adicionar um
      teste-guarda que exige `typeof act === 'function'`; verificar `bun test` sem env vars
- [x] 2.2 Corrigir o estado global entre testes e estabilizar os testes sensíveis a duração (o SSR
      micro-cache leva 4,7–6,3 s contra o timeout default de 5 s), ajustando o caminho ou o
      `testTimeout`; verificar duas execuções consecutivas verdes sob carga
- [x] 2.3 Separar `pass`, `skip`, `fail` e `error` nos relatórios e nunca contar skip como pass;
      verificar o relatório com contagens reais e um arquivo de teste que não carrega
- [x] 2.4 Fazer `bun run test:all` passar sem env vars e imprimir as contagens de cada suíte;
      verificar a execução completa e o exit code 0

## 3. Gate de documentação e CI

- [x] 3.1 Atualizar a fonte única e os documentos para os valores que a suíte/linter realmente
      reportam no commit certificado (tools, pass/skip, arquivos, warnings, versão 1.10.0);
      verificar `bun run docs:check`
- [x] 3.2 Estender `docs:check` para cobrir `CHANGELOG.md`, `RELEASE-CHECKLIST.md`, `AGENTS.md` e
      os dois READMEs, com exclusão de seções históricas datadas; verificar que uma contagem
      alterada de propósito falha e que restaurá-la passa
- [x] 3.3 Restaurar CI em push/PR com gate rápido (lint, check, docs, suíte principal) e suíte
      completa em main/release; verificar o YAML e um dry-run local dos comandos
- [x] 3.4 Remover as ocorrências residuais de “18 tools”, “568 testes”, “70 arquivos” e “69
      warnings”, sem reescrever seções históricas do changelog; verificar com `grep`
- [x] 3.5 Remover a injeção de `NODE_ENV=development` em `scripts/docs-check.ts` e
      `scripts/coverage-check.ts` e adicionar um teste que inspeciona o env do processo filho;
      verificar que os gate scripts não mascaram um harness quebrado
- [ ] 3.6 Registrar a configuração de branch protection/required checks como evidência ou decisão
      explícita de hospedagem; verificar que o arquivo de evidência ou a decisão existe
- [x] 3.7 Atualizar `RELEASE-CHECKLIST.md` com os comandos exatos e as env vars (ou a ausência
      delas); verificar que cada linha é executável como escrita
- [x] 3.8 Fazer os badges “N Passing (100%)”/“100% Green Gates” refletirem o resultado real;
      verificar que não afirmam 100% enquanto o comando padrão está vermelho

## 4. Portabilidade do query engine

- [x] 4.1 Adicionar condição agregada estruturada ao `having` e compilá-la como expressão
      (`SUM(amount) > $1`); verificar teste unitário e teste real em SQLite
- [x] 4.2 Rejeitar alias de saída em `having` com erro explícito ou compilá-lo para a expressão
      equivalente; verificar que uma consulta com alias não gera SQL que falha só no PostgreSQL
- [x] 4.3 Implementar `exists` com consulta limitada, sem `COUNT(*)` da tabela inteira; verificar
      o comportamento e a consulta emitida
- [x] 4.4 Fazer `MockDatabaseClient.aggregate` agregar de verdade ou lançar
      `UNSUPPORTED_OPERATION`; verificar que ele nunca devolve linhas cruas como agregadas
- [ ] 4.5 Adicionar teste de agregação/HAVING contra PostgreSQL real na CI; verificar que ele roda
      com `TEST_DATABASE_URL` e falha numa regressão deliberada
- [x] 4.6 Cobrir injeção em função, `groupBy`, `orderBy` e `having`; verificar que entradas
      inválidas falham antes de executar SQL e que valores continuam parametrizados
- [x] 4.7 Documentar o novo formato de `having` e o escopo de `exists`; verificar `docs:check` e um
      exemplo executável
- [x] 4.8 Verificar que o `aggregate` real (SQLite/PostgreSQL) continua funcionando via `findMany`
      e que a correção é apenas no mock e no `exists`; verificar o teste de agrupamento existente

## 5. Jobs agendados

- [x] 5.1 Implementar OR entre dia-do-mês e dia-da-semana quando ambos são restritos; verificar
      `0 0 13 * 5` em datas conhecidas (sexta ou dia 13, o que vier antes)
- [x] 5.2 Validar faixas, passos e listas, aceitar domingo `0`/`7` e rejeitar nomes/`L`/`W`/`#`
      com mensagem clara; verificar cada caso com teste
- [x] 5.3 Honrar `runAt` nos dois caminhos de `enqueue` ou removê-lo do contrato público;
      verificar agendamento absoluto e conflito com `delaySeconds`
- [ ] 5.4 Fazer o `PostgresQueueEngine` falhar com `CRON_UNSUPPORTED_ENGINE` ao registrar cron e
      documentar o escopo; verificar o erro e a documentação
- [x] 5.5 Definir payload inicial por factory ou `{}` explícito e validar contra o schema no
      registro; verificar que um schema que rejeita `{}` falha cedo
- [x] 5.6 Unificar inspeção/retry de DLQ nos engines suportados e resetar `attempts` exatamente
      uma vez; verificar retry de job failed e não-failed
- [x] 5.7 Remover unhandled rejection no registro de cron; verificar com um insert que falha e um
      listener de `unhandledRejection`
- [x] 5.8 Documentar cron, `runAt`, payload e escopo de engine; verificar `docs:check` e exemplos

## 6. Sessão e OAuth

- [x] 6.1 Adicionar `permissions` a `SessionClaims`, `signSessionToken` e `verifySessionToken`, e
      incluir na sessão derivada pelo servidor; verificar token novo, token legado e ação protegida
- [x] 6.2 Validar o claim de permissões (array de strings, limite de quantidade/comprimento) e
      rejeitar token malformado/adulterado com `INVALID_TOKEN` antes de autorizar; verificar cada caso
- [x] 6.3 Tornar o bypass de admin/superadmin configurável, com default `true` documentado;
      verificar default e bypass desligado
- [x] 6.4 Fazer o template de login assinar permissões e o oracle provar o fluxo completo;
      verificar que o servidor aceita o token e que uma permissão ausente retorna `FORBIDDEN`
- [x] 6.5 Adicionar timeout/abort ao `exchangeOAuthCode` e testá-lo contra um stub HTTP local;
      verificar timeout, não-2xx e sucesso
- [x] 6.6 Adicionar helper de `state` e validação no callback, e cobrir PKCE (43–128 chars,
      S256, SHA-256); verificar state divergente e valores corretos
- [x] 6.7 Documentar permissões no token, expiração/revogação, bypass e fluxo OAuth; verificar
      `docs:check` e um exemplo executável

## 7. CSS, error boundary e navegação SPA

- [x] 7.1 Produzir o CSS em `synapse build`, `dev` e `start` quando houver fonte, e emitir o link
      só depois que o arquivo existe; verificar primeiro boot e `Content-Type`
- [x] 7.2 Remover o tema dark hardcoded e não emitir link quando não há fonte; verificar modo
      air-gapped sem CDN e sem injeção de tema
- [x] 7.3 Documentar “cópia/bundle” vs “compilação” conforme o comportamento real; verificar que o
      guia não promete um compilador inexistente
- [x] 7.4 Integrar `SliceErrorBoundary` no entrypoint de hidratação **por padrão**, com fallback,
      log e opt-out; verificar componente que lança, fallback visível e SSR ainda 500
- [x] 7.5 Preservar foco, `checked`, `selected`, valor e scroll dos elementos marcados; escapar
      chaves; verificar navegação com input focado e checkbox marcado
- [x] 7.6 Cair para navegação completa quando transição, props ou import falharem; verificar que
      não há página em branco
- [x] 7.7 Documentar CSS, error boundary e preservação de estado; verificar `docs:check` e exemplos

## 8. Scaffolding de domínio e governança

- [x] 8.1 Tornar `new-domain` transacional: rastrear arquivos criados, remover em falha e
      retornar `PARTIAL_WRITE` com caminhos se a remoção não for segura; verificar falha no meio
- [x] 8.2 Cobrir contenção de caminho em `new-domain`, `new-shared` e MCP; verificar traversal,
      absoluto, vazio e excesso de comprimento sem escrita
- [x] 8.3 Adicionar `new-domain` ao help do CLI, README e contrato; verificar que a sintaxe e o
      `--fields` aparecem e que o exemplo executa
- [x] 8.4 Adicionar teste de invocação real da tool MCP `synapse_scaffold_domain`; verificar os
      três arquivos no disco
- [x] 8.5 Adicionar fixture de 501 linhas e testes de 500/501 para `WARN_LARGE_SLICE`, com limiar
      **500** no código; verificar PASS com warning em 501, sem warning em 500, e que o guia cita 500
- [ ] 8.6 Verificar o layout gerado em modo air-gapped e documentar a dependência de estilos;
      verificar que ele não depende de CDN
- [x] 8.7 Atualizar README/guia com `new-domain`, WARN e escopo de estilos; verificar `docs:check`

## 9. Documentação, claims e evidência

- [x] 9.1 Trocar `db.tx` por `db.transaction` no guia e validar o exemplo de transação; verificar
      que o código compila/executa
- [x] 9.2 Auditar a tabela de features: cada `stable` cita teste que falha quando a feature
      quebra; reclassificar as demais; verificar o gate de status
- [x] 9.3 Corrigir claims contraditórios (incluindo os badges de 100%), remover os que não têm
      código e verificar com `grep` e com o teste de ausência
- [x] 9.4 Criar `release-evidence/1.10.0.md` com commit, comandos sem env vars, saídas e data;
      verificar que cada comando citado reproduz
- [x] 9.5 Adicionar notas de migração para cron OR, HAVING, `new-domain` e error boundary;
      verificar o changelog e o teste que exige as notas
- [x] 9.6 Atualizar `AGENTS.md`/READMEs com o estado real (adoption, features experimentais,
      escopo SQLite do cron) e verificar `docs:check`
- [x] 9.7 Adicionar `scripts/verify-release-evidence.ts` que relê o arquivo, reexecuta os comandos
      e confere o commit; verificar que ele falha com comando divergente ou commit errado

## 10. Guardrail de TypeScript 7

- [x] 10.1 Pinar `typescript` em `~5.9.3` e adicionar `COMPILER_API_UNAVAILABLE` com a versão
      detectada; verificar que a ausência de `ts.sys` produz o erro nomeado
- [ ] 10.2 Garantir resolução determinística do TS local sobre um TS global; verificar o cenário
      “TS 7 global + TS 5.9 local”
- [ ] 10.3 Adicionar job de CI com TS 5.9 e smoke com TS 7; verificar que o smoke registra o erro
      esperado, não um crash
- [x] 10.4 Registrar a decisão de migração para 1.11 (vendor vs API `unstable` vs CLI);
      verificar o documento e o prazo
- [x] 10.5 Remover qualquer claim de compatibilidade com TS 7 antes da migração; verificar
      `docs:check`
- [ ] 10.6 Adicionar um check de lockfile/TS-resolution drift que produza
      `COMPILER_API_UNAVAILABLE` antes do publish; verificar com uma resolução incompatível induzida

## 11. Integração e certificação de release

- [x] 11.1 Rodar `bash scripts/run-gates.sh --with-docker` (inventário canônico) mais
      `synapse db-drift` e `synapse impact customers` com alvos válidos; verificar cada exit code e
      anexar a saída ao release-evidence
- [x] 11.2 Rodar os casos negativos do `run-gates.sh` (sem slices, fixture leaky, flag/command
      desconhecidos, config malformada) e o traversal de scaffolding; verificar FAIL/erro nomeado
- [ ] 11.3 Rodar a paridade PostgreSQL com `TEST_DATABASE_URL`, incluindo agregações/HAVING e
      cron/erro explícito; verificar a suíte real
- [ ] 11.4 Verificar em teste de browser o CSS no primeiro boot, error boundary, foco/estado na
      SPA e o modo air-gapped; anexar evidência
- [ ] 11.5 Só então preparar 1.10.0: changelog, notas de migração, tag e publish rehearsal;
      verificar que o release-evidence está completo e que nenhum gate está vermelho
- [x] 11.6 Rodar `verify-release-evidence.ts` sobre o arquivo final e verificar que ele reexecuta
      os comandos e confere o commit

## Workflow follow-up

- Revisar o change com um revisor de contexto fresco (rodada 2, focada nas reparações M-01..M-09 e
  N-01..N-12) antes de executar.
- Arquivar o change depois que a certificação de 1.10.0 estiver registrada.
- Se uma decisão bloqueante mudar, atualizar `audit-and-decisions.md` e as tarefas afetadas antes
  de executar.
