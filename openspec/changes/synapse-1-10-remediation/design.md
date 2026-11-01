# Design

## Context

O working tree contém as oito ondas de 1.10 (**28 arquivos rastreados modificados e 7 não
rastreados**, +725/−89 nos rastreados) ainda não commitadas. A auditoria de 2026-10-31 mediu o
estado real: `check`, `check:template`, `split`, `skeleton`, `db-drift`, `impact` e o e2e passam;
a suíte padrão falha entre 9 e 13 testes **e não é estável entre execuções** (o revisor mediu
559/6/13 + 1 error onde o owner mediu 563/6/9); `docs:check` falha por drift; o CI está
manual-only. As features são reais, mas a integração e a evidência são desiguais.

Restrições que moldam o desenho:

- Bun-only, React 19, TypeScript 5.9.3 pinado no lockfile; oito módulos do compilador usam a API
  JS do TypeScript (`ts.sys`, `createProgram`), removida no TS 7.
- Um mantenedor, zero adotantes externos, sem orçamento declarado para uma reescrita.
- O repositório já tem um protocolo de honestidade (`AGENTS.md` §6) e um gate de docs; o problema
  não é falta de regra, é a regra não ser executável.
- Este change é **planejamento**: nenhuma execução é autorizada até as decisões bloqueantes
  (D1, D3, D4, D5, D6, D7, D10) serem confirmadas em `audit-and-decisions.md`.

## Goals / Non-Goals

**Goals:**

- Fazer 1.10.0 ser um release reproduzível: os comandos publicados passam sem env vars ocultas.
- Corrigir os defeitos funcionais das ondas novas (cron, HAVING, `runAt`, permissões, CSS,
  scaffolding) e provar cada correção com um teste que falha antes.
- Alinhar documentação, guia, help e evidência ao comportamento real.
- Deixar o risco de TypeScript 7 explícito e testado, com decisão de migração registrada.

**Non-Goals:**

- Implementar paridade de cron no PostgreSQL em 1.10 (recomendação: 1.11).
- Migrar os oito módulos do compilador para a API do TS 7 nesta versão.
- Adicionar features novas além das oito ondas; o escopo é correção, integração e evidência.
- Reposicionar o produto, extrair pacotes standalone ou rodar o benchmark de agentes; isso está
  em `recommendations.md` como trilha separada.

## Decisions

### D1 — 1.10.0 é um minor, não um patch

**Decisão.** Congelar 1.9.x e lançar as oito ondas como **1.10.0**, com changelog e notas de
migração. Não publicar 1.9.1 com features.

**Por quê.** As ondas adicionam capabilities e mudam comportamento (cron, HAVING, scaffolding).
Um patch esconderia a mudança; um minor permite documentar as quebras e dá espaço para a
certificação. Alternativa considerada: 1.9.1 (rejeitada: subestima o delta e mistura correção com
feature).

### D2 — O harness de teste corrige o ambiente, não o comando

**Decisão.** Fazer `packages/synapse/test/setup.ts` (ou o preload do `bunfig.toml`) estabelecer
`NODE_ENV=test` antes de qualquer import de React, e adicionar um teste-guarda que afirma que
`act` é função. Corrigir também o estado global entre testes (portas, arquivos SQLite, timers) e
os testes sensíveis a duração (o SSR micro-cache leva 4,7–6,3 s contra o timeout default de 5 s).
Remover a injeção de `NODE_ENV=development` em `scripts/docs-check.ts` e `scripts/coverage-check.ts`,
que hoje mascara o harness um nível abaixo do `run-gates.sh`, e exigir duas execuções verdes
consecutivas sob carga.

**Por quê.** O `bun test` padrão resolve React em build de produção, onde `act` não existe. Exigir
`NODE_ENV=development` no comando é uma dependência invisível: o CI, o `docs:check` e qualquer
pessoa que rode o comando publicado não a têm. Só trocar a env var não basta: os timeouts e a
injeção dos gate scripts mantêm o gate vermelho ou falso-verde. Alternativa considerada:
documentar a env var (rejeitada: mantém o gate frágil e o “572 PASS” não reproduzível).

### D3 — `HAVING` usa expressão agregada, não alias de saída

**Decisão.** Adicionar uma condição estruturada `{ fn, column, op, value }` ao `having`, compilada
como `SUM(amount) > $1`. Condições por coluna simples continuam aceitas. Alias de saída em
`HAVING` passa a ser rejeitado com erro explícito quando o engine não o suporta.

**Por quê.** PostgreSQL não aceita alias de saída em `HAVING`; SQLite aceita. O teste atual passa
no SQLite e o claim de paridade PostgreSQL é falso. A expressão agregada é portável e mantém o
valor parametrizado. Alternativa considerada: documentar “HAVING só no SQLite” (rejeitada: é uma
feature de destaque e o projeto promete paridade).

### D4 — Cron segue POSIX; `runAt` é honrado ou removido; escopo de engine é explícito

**Decisão.** Implementar OR entre dia-do-mês e dia-da-semana quando ambos são restritos; validar
faixas/passos; aceitar domingo `0` e `7`; rejeitar nomes/`L`/`W`/`#` com mensagem clara. `runAt`
passa a ser honrado por `enqueue` nos dois engines, ou sai do contrato público. Cron no
`PostgresQueueEngine` fica **fora de 1.10**: o registro falha com `CRON_UNSUPPORTED_ENGINE` e a
limitação é documentada; paridade em 1.11.

**Por quê.** O parser atual usa AND; `0 0 13 * 5` só roda na sexta 13. `runAt` é aceito e ignorado.
Cron distribuído exige locking, missed runs e timezone; implementar às pressas criaria um bug pior
que a ausência. Alternativa considerada: paridade agora (adiada por custo/risco).

### D5 — O CSS é produzido no build/boot, e “compilar” só se for verdade

**Decisão.** Chamar `buildCssBundle` em `synapse build`, `dev` e `start` quando existir uma fonte
declarada; emitir o link somente depois que o arquivo existe; servir com `text/css`. Sem fonte,
não emitir link e não injetar tema. Renomear/documentar como **cópia** de um CSS da aplicação,
não como compilador de Tailwind.

**Por quê.** Hoje o link só aparece se o arquivo existe e a rota só constrói o arquivo se for
requisitada: deadlock na primeira execução. O fallback dark hardcoded também contradiz o shell
neutro. Alternativa considerada: pipeline Tailwind completo (fora de escopo; a aplicação pode
trazer seu CSS compilado).

### D6 — Error boundary padrão-on com opt-out; SPA preserva o que promete

**Decisão.** Envolver a view da fatia no `SliceErrorBoundary` no entrypoint de hidratação, com
fallback neutro, log e opt-out configurável. Na navegação SPA, preservar foco, `checked`,
`selected`, valor e scroll dos elementos marcados; escapar chaves; se a transição ou o import
falhar, navegar por completo.

**Por quê.** O componente existe mas não é usado; “isola falhas” só é verdade se estiver no
caminho. “Preserva foco” não é verdade hoje (só valores). O fallback de navegação evita página em
branco. Alternativa considerada: manter como primitiva documentada (menos valor e mantém o claim
atual ambíguo).

### D7 — `new-domain` é transacional e o warning de fatia é testado

**Decisão.** Rastrear os arquivos criados; em falha, removê-los; se a remoção falhar, retornar
`PARTIAL_WRITE` com os caminhos. Só devolver `Ok` com os três artefatos. Adicionar teste de
invocação MCP, help/README e um fixture de 501 linhas para `WARN_LARGE_SLICE`. O código usa
**500**; o guia passa a recomendar 500 (hoje diz 450); 501 avisa, 500 não avisa.

**Por quê.** Hoje `scaffoldDomain` ignora erros de `scaffoldSlice`/`scaffoldShared` e devolve Ok
parcial. O warning não tem teste e o guia contradiz o limiar. Alternativa considerada: criar em
diretório temporário e mover no final (mais seguro, mais código; pode ser adotado na execução).

### D8 — Permissões entram no token assinado; OAuth tem `state` e timeout

**Decisão.** Adicionar `permissions?: string[]` a `SessionClaims`; `signSessionToken` aceita e
`verifySessionToken` valida (array de strings, limite de quantidade/comprimento); a sessão do
servidor inclui as permissões; tokens antigos continuam válidos com lista vazia. **A fonte é o
claim assinado**; consulta ao banco fica como fallback documentado, não como contrato. O bypass
de admin/superadmin é configurável (`SYNAPSE_RBAC_ADMIN_BYPASS`, default `true` por
compatibilidade) e documentado. `exchangeOAuthCode` recebe timeout/abort e é testado contra um
stub local; o template valida `state` e o PKCE segue RFC 7636. Claim inválido produz
`INVALID_TOKEN` antes de qualquer autorização.

**Por quê.** As permissões hoje só existem em `createSession`, não no token; no caminho de
produção o RBAC granular não funciona. Alternativa considerada: carregar permissões do banco a
cada request (mais autoritativo, mais latência); fica como fallback documentado, mas o token é o
caminho mínimo.

### D9 — Documentação deriva da fonte única; o guia usa a API real

**Decisão.** `project-status.ts` continua sendo a fonte de versão/features; o `docs:check` cobre
contagens de tools/testes/arquivos/warnings em README(s), `AGENTS.md`, `RELEASE-CHECKLIST.md` e
changelog, **excluindo seções históricas datadas** para não reescrever o passado. O guia troca
`db.tx` por `db.transaction`, e `new-domain` entra no README/help/contrato. Os badges “568
Passing (100%)”/“100% Green Gates” passam a refletir o resultado real. Cada release publica um
`release-evidence` com comandos, env vars, saída e commit, verificado por
`scripts/verify-release-evidence.ts`.

**Por quê.** O gate atual já detecta parte do drift, mas o relatório aprovou usando um teste mais
estreito. A evidência precisa ser reproduzível por quem lê, não só pelo autor. Alternativa
considerada: gerar os números automaticamente no build (desejável; entra como melhoria).

### D10 — TypeScript 7 é um guardrail em 1.10, não uma migração

**Decisão.** Pinar `typescript` em `~5.9.3` (ou vendorizar), adicionar `COMPILER_API_UNAVAILABLE`
com a versão detectada, garantir resolução determinística do TS local, rodar um smoke com TS 7 na
CI e um check de lockfile drift que falha antes do publish. Registrar a decisão de migração para
1.11 (vendor vs API `unstable` vs CLI).

**Por quê.** TS 7 é GA e removeu a API JS usada por oito módulos; neste ambiente o Bun resolveu o
TS 7 global e `check`/`bench` quebraram. Migrar agora é uma reescrita; ignorar é uma bomba-relógio.
Alternativa considerada: migrar já (rejeitada por escopo/risco).

### D11 — CI rápida em push/PR, completa em main/release

**Decisão.** Gate rápido em push/PR: lint, typecheck, `docs:check`, suíte principal. Suíte
completa, PostgreSQL, e2e e publish rehearsal em main e no release. `workflow_dispatch` continua
para execuções manuais, mas não é o único gatilho. A configuração de branch protection/required
checks é registrada como evidência (ou explicitamente fora do controle do repo).

**Por quê.** O CI manual-only economiza storage e esconde regressões; o custo de um gate rápido é
baixo comparado a publicar um release vermelho. Alternativa considerada: suíte completa em todo
push (mais caro; pode ser avaliado depois).

### D12 — Certificação de release separada de “aprovado”

**Decisão.** 1.10.0 só é certificado quando os comandos exatos, sem env vars, passam; o arquivo
de evidência é commitado; changelog e publish rehearsal estão verdes. Um script
`verify-release-evidence.ts` relê o arquivo, reexecuta os comandos e confere o commit; o selo
“APPROVED” só existe com essa verificação.

**Por quê.** O relatório anterior declarou aprovação sem que os comandos citados passassem. A
certificação precisa ser um artefato verificável, não um adjetivo. Alternativa considerada:
confiar no relatório (rejeitada pelos fatos medidos).

## Risks / Trade-offs

- **Cron OR muda schedules existentes** → changelog e nota de migração; a mudança é a semântica
  correta, mas quem dependia do AND precisa ajustar a expressão.
- **HAVING por alias deixa de funcionar** → erro explícito e guia de migração para expressão
  agregada; o comportamento antigo só era portável no SQLite.
- **Permissões no token aumentam o tamanho e ficam stale até o próximo login** → limite de
  claims, expiração curta documentada, fallback de consulta ao banco como opção.
- **Error boundary padrão-on pode esconder erros** → fallback visível, log com `onError` e opt-out.
- **Rollback de `new-domain` pode remover trabalho do usuário** → só remover arquivos criados
  pela operação, com hash/conteúdo verificado; se não for seguro, retornar `PARTIAL_WRITE`.
- **CI rápida ainda pode deixar passar regressão de PostgreSQL** → suíte completa em main e no
  release; PostgreSQL obrigatório no gate de release.
- **Pinar TS 5.9 conflita com projetos em TS 7** → documentar o range, erro nomeado e trilha de
  migração; não prometer compatibilidade.
- **O CSS “copiado” pode não satisfazer quem espera Tailwind** → documentar a responsabilidade da
  aplicação e oferecer um exemplo de build externo.
- **Testes sensíveis a duração continuam vermelhos mesmo após o harness** → estabilizar o SSR
  micro-cache ou re-orçar o timeout, e exigir duas execuções verdes consecutivas sob carga.
- **Gate scripts reinjetam `NODE_ENV=development`** → remover a injeção e testar o env do processo
  filho; sem isso o gate de docs/coverage mascara um harness quebrado.
- **Branch protection não é controlada pelo repo** → registrar a configuração como evidência ou
  declarar explicitamente que o bloqueio de merge é uma decisão de hospedagem.
- **Seções históricas do changelog contêm “18 tools”** → excluir seções datadas do gate de docs,
  em vez de reescrever história.
- **Release evidence auto-certificado** → `verify-release-evidence.ts` relê, reexecuta e confere o
  commit; sem isso a evidência é apenas prosa.

## Migration Plan

**Fase 0 — Baseline.** Inventariar e stagear os 28 arquivos rastreados e os 7 não rastreados,
congelar o working tree, registrar commit e saídas atuais (incluindo as falhas, o `error` e o
wall-clock) em `release-evidence` de baseline. Nenhuma alteração de código.

**Fase 1 — Gate reproduzível.** Corrigir o harness (`NODE_ENV`, estado global), estabilizar os
testes sensíveis a duração, remover a injeção de `NODE_ENV` nos gate scripts, alinhar contagens e
restaurar CI. Gate: `bun test`, `test:all`, `docs:check`, `lint`, `check`, `check:template` verdes
sem env vars, em duas execuções consecutivas sob carga.

**Fase 2 — Query e jobs.** Implementar HAVING portável, `exists`, mock de agregação; cron POSIX,
`runAt`, escopo de engine, payload e DLQ. Gate: testes SQLite + PostgreSQL reais; cron com datas
conhecidas.

**Fase 3 — Sessão, OAuth e UI.** Permissões no token, bypass configurável, OAuth com state/timeout;
CSS no build/boot, error boundary, SPA com foco/estado; `new-domain` transacional e MCP. Gate:
testes de sessão, browser hooks, bootstrap de CSS, fixture de 501 linhas.

**Fase 4 — Docs e TS 7.** Guia com `db.transaction`, `new-domain` no help/README, evidência de
release, pin do compilador, erro nomeado e smoke de TS 7. Gate: `docs:check` e CI matrix.

**Fase 5 — Certificação.** Rodar `bash scripts/run-gates.sh --with-docker` (o inventário canônico
de 24 gates) mais os checks específicos de `db-drift`/`impact`, publish rehearsal, changelog,
notas de migração e `release-evidence` final. Gate: `verify-release-evidence.ts` reexecuta os
comandos e confere o commit; todos verdes no commit certificado.

**Rollback.** Cada fase é um conjunto de commits comuns; as mudanças de comportamento entram uma
por commit e têm nota de migração. O cron e o `HAVING` podem ser revertidos isoladamente; o token
com permissões é aditivo e aceita tokens antigos; o error boundary tem opt-out.

## Decisions Required Before Execution

A lista autoritativa é a seção **Blocking decisions** de `audit-and-decisions.md`. Ela contém
sete itens `unanswered`: D1 (1.10.0), D3 (HAVING), D4 (cron PostgreSQL), D5 (CSS), D6 (error
boundary), D7 (`new-domain` transacional) e D10 (TS 7). O plano usa os defaults recomendados
enquanto a confirmação não chega; silêncio não é aprovação e a execução fica bloqueada.

## Open Questions

- Qual timeout default para `exchangeOAuthCode`? Pode ser decidido na implementação; o spec exige
  que seja configurável e finito. As demais decisões de desenho (precedência de CSS e caminho do
  `release-evidence`) foram fixadas em D5/D9 para não deixar contrato ambíguo.
