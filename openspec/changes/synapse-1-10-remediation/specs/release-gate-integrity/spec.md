# Spec Delta

## Purpose

Garante que os gates do repositório sejam reproduzíveis sem variáveis de ambiente ocultas, que a documentação não divirja do código e que a CI bloqueie regressões antes de um release.

## ADDED Requirements

### Requirement: Default test command is green

O comando `bun test packages/synapse/test`, executado sem variáveis de ambiente, SHALL terminar com exit 0, sem falhas, timeouts ou erros, incluindo os testes de DOM que dependem de `act`.

#### Scenario: Clean shell run

- **WHEN** `bun test packages/synapse/test` é executado em um shell sem `NODE_ENV` definido
- **THEN** o processo termina com exit 0 e nenhum teste falha, expira ou reporta erro

#### Scenario: Repeated runs under load

- **WHEN** a suíte é executada duas vezes consecutivas no mesmo host, com carga concorrente
- **THEN** as duas execuções terminam com exit 0 e o mesmo conjunto de testes verdes

#### Scenario: React act availability

- **WHEN** um teste de DOM importa `act` de `react`
- **THEN** `act` é uma função disponível no ambiente de teste, sem depender de uma env var externa

### Requirement: Full suite reproducibility

`bun run test:all` SHALL terminar com exit 0 sem variáveis de ambiente e SHALL reportar pass, skip e fail separadamente.

#### Scenario: Full chain in a clean shell

- **WHEN** `bun run test:all` é executado sem `NODE_ENV` ou flags adicionais
- **THEN** o comando termina com exit 0 e imprime as contagens de cada suíte

#### Scenario: Skipped engine is not a pass

- **WHEN** uma suíte de PostgreSQL não encontra `TEST_DATABASE_URL`
- **THEN** ela é reportada como `skip`, nunca como `pass`

### Requirement: Documentation drift is a red gate

`bun run docs:check` SHALL comparar contagem de ferramentas MCP, testes, arquivos, versão e warnings de lint citados em `AGENTS.md`, nos READMEs, no `RELEASE-CHECKLIST.md` e no changelog contra a fonte única, e SHALL falhar em qualquer divergência.

#### Scenario: Tool count drift

- **WHEN** um README afirma 18 ferramentas MCP enquanto 19 estão registradas
- **THEN** `bun run docs:check` falha e aponta o arquivo e a linha

#### Scenario: Restored counts

- **WHEN** todas as contagens citadas batem com a fonte única
- **THEN** `bun run docs:check` termina com exit 0

### Requirement: CI blocks regressions before release

O repositório SHALL executar um gate rápido em push e pull request, contendo lint, typecheck, `docs:check` e a suíte principal, e SHALL executar a suíte completa em main e no release.

#### Scenario: Pull request gate

- **WHEN** um pull request é aberto ou atualizado
- **THEN** o gate rápido executa e reporta falha para o commit avaliado

#### Scenario: Required checks are recorded

- **WHEN** o repositório depende de branch protection para bloquear o merge
- **THEN** a configuração de required checks é registrada como evidência ou declarada como decisão de hospedagem fora do repositório

#### Scenario: Manual-only pipeline is insufficient

- **WHEN** o workflow está configurado apenas com `workflow_dispatch`
- **THEN** a revisão do release rejeita o pipeline como gate de regressão

### Requirement: Release evidence is reproducible

Cada release SHALL incluir um arquivo de evidência versionado com commit, comandos exatos, variáveis de ambiente, saída e data; nenhum claim de aprovação SHALL existir sem esse arquivo.

#### Scenario: 1.10.0 evidence

- **WHEN** o release 1.10.0 é preparado
- **THEN** o arquivo de evidência lista os comandos sem env vars, as saídas reais e o commit avaliado

#### Scenario: Missing evidence blocks release

- **WHEN** o arquivo de evidência está ausente ou cita um comando que não reproduz
- **THEN** o release é bloqueado

### Requirement: Release evidence is executable

Um script versionado SHALL reler o arquivo de evidência, reexecutar cada comando e conferir que o commit registrado é o commit avaliado; a evidência NÃO SHALL depender apenas da palavra do autor.

#### Scenario: Verifier re-runs the evidence

- **WHEN** `verify-release-evidence.ts` executa sobre o arquivo de 1.10.0
- **THEN** ele reexecuta os comandos e falha se algum exit code ou commit não corresponder

#### Scenario: Evidence from another commit

- **WHEN** o arquivo cita um commit diferente de `HEAD`
- **THEN** o verificador falha e o release é bloqueado

### Requirement: Pass, skip, fail and error are distinct

Relatórios de teste SHALL distinguir `pass`, `skip`, `fail` e `error`; um teste `skip` NÃO SHALL ser contado como `pass`.

#### Scenario: Suite with skips

- **WHEN** a suíte termina com N pass e M skip
- **THEN** o relatório diz N pass e M skip, nunca N+M pass

#### Scenario: Failure is visible

- **WHEN** um teste falha
- **THEN** o relatório inclui o nome do teste e o motivo, e o processo termina com exit não zero

#### Scenario: Error is visible

- **WHEN** um arquivo de teste não carrega e o Bun reporta `error`
- **THEN** o relatório mostra a categoria `error` separada de `fail` e o processo termina com exit não zero

### Requirement: Gate scripts preserve the ambient environment

`bun run docs:check` e `bun run coverage:check` NÃO SHALL injetar `NODE_ENV` no processo da suíte; eles SHALL passar o ambiente do processo pai inalterado, para que um harness quebrado não seja mascarado.

#### Scenario: Ambient environment is preserved

- **WHEN** o gate roda em um shell sem `NODE_ENV`
- **THEN** a suíte filha vê o ambiente sem `NODE_ENV` e um harness quebrado faz o gate falhar

#### Scenario: No development re-injection

- **WHEN** o processo pai define `NODE_ENV=test`
- **THEN** a suíte filha vê `test`, nunca `development` injetado pelo script
