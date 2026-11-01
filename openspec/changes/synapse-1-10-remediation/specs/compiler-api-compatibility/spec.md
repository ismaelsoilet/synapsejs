# Spec Delta

## Purpose

Torna explícita e testável a dependência da API JavaScript do TypeScript 5.x, com guardrail de resolução e decisão registrada para o TypeScript 7.

## ADDED Requirements

### Requirement: Compiler API failures are named

O framework SHALL declarar o range de TypeScript suportado e SHALL falhar com um erro nomeado (`COMPILER_API_UNAVAILABLE`) quando a API necessária não existir, em vez de propagar um `TypeError` genérico.

#### Scenario: TypeScript 7 resolved

- **WHEN** o CLI resolve um TypeScript que não expõe a API usada pelo compilador
- **THEN** `check`, `split` ou `skeleton` retornam `COMPILER_API_UNAVAILABLE` com a versão detectada

#### Scenario: Supported TypeScript

- **WHEN** o CLI resolve a versão suportada e pinada
- **THEN** os comandos de compilador funcionam normalmente

### Requirement: Compiler resolution is deterministic

Com um TypeScript local pinado, `check`, `split` e `skeleton` SHALL usar essa versão independentemente de um TypeScript global instalado na máquina; o comportamento SHALL ser documentado.

#### Scenario: Global TypeScript 7 and local 5.9

- **WHEN** a máquina tem TS 7 global e o projeto tem TS 5.9 no lockfile
- **THEN** os comandos usam TS 5.9 e passam

#### Scenario: No local compiler

- **WHEN** o projeto não tem um TypeScript local resolvível
- **THEN** o comando falha com `COMPILER_API_UNAVAILABLE` e instrui a instalar a versão suportada

### Requirement: CI exercises both compilers

A CI SHALL executar a camada de compilador com a versão suportada e SHALL executar um smoke test com TypeScript 7, registrando o resultado esperado de incompatibilidade.

#### Scenario: Supported compiler job

- **WHEN** a CI roda com o TypeScript pinado
- **THEN** `check`, `split` e `skeleton` passam

#### Scenario: TypeScript 7 smoke

- **WHEN** a CI roda o smoke com TypeScript 7
- **THEN** o comando falha com `COMPILER_API_UNAVAILABLE` e o job registra isso como comportamento esperado, não como crash

### Requirement: Migration decision is recorded

Uma decisão SHALL ser registrada entre vendorizar o TypeScript 5.9, migrar para a API `unstable` do TS 7 ou usar a CLI do compilador, com critérios, custo e prazo; nenhum documento SHALL declarar compatibilidade com TS 7 antes da migração.

#### Scenario: Decision record

- **WHEN** o release 1.10.0 é preparado
- **THEN** existe uma decisão registrada com a opção escolhida e a trilha para 1.11

#### Scenario: No false compatibility claim

- **WHEN** a documentação menciona TypeScript 7
- **THEN** ela declara o estado real (não suportado ou em migração), não compatibilidade

### Requirement: Compiler breakage fails before users see it

Uma mudança de lockfile, resolução de dependência ou versão de TypeScript que quebre o compilador SHALL falhar no gate de release ou no publish rehearsal, não no runtime de um usuário.

#### Scenario: Lockfile drift

- **WHEN** o lockfile passa a resolver uma versão incompatível
- **THEN** o gate de CI falha antes do publish

#### Scenario: Publish rehearsal

- **WHEN** o pacote é instalado fora do monorepo
- **THEN** os comandos de compilador executam com a versão suportada e reportam erro nomeado se ela faltar
