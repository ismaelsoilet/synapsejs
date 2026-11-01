# Spec Delta

## Purpose

Mantém documentação, guias e claims alinhados ao comportamento real, com números e exemplos reproduzíveis.

## ADDED Requirements

### Requirement: Counts and version have one source

Os READMEs, `AGENTS.md`, `RELEASE-CHECKLIST.md` e o changelog SHALL citar a mesma contagem de ferramentas MCP, testes, arquivos, versão e warnings de lint que a fonte única do projeto; `bun run docs:check` SHALL passar.

#### Scenario: Tool count

- **WHEN** o registro de ferramentas MCP reporta N ferramentas
- **THEN** todos os documentos citam N e nenhuma contagem antiga permanece

#### Scenario: Test count

- **WHEN** a suíte reporta N pass e M skip no commit certificado
- **THEN** os documentos citam esses valores com pass e skip separados, sem congelar um número que a própria mudança altera

#### Scenario: Lint count

- **WHEN** o linter reporta N warnings
- **THEN** os documentos citam N, não um valor histórico

#### Scenario: Green-gates badge

- **WHEN** o comando padrão da suíte está vermelho
- **THEN** os badges “100% Green Gates”/“N Passing (100%)” não afirmam o contrário

### Requirement: Guide samples use real APIs

Os exemplos do guia de arquitetura SHALL usar APIs que existem no pacote e SHALL compilar ou executar como documentado.

#### Scenario: Transaction sample

- **WHEN** o guia mostra uma transação compartilhada
- **THEN** o exemplo usa `db.transaction` (não `db.tx`) e o código compila

#### Scenario: SubSlice sample

- **WHEN** o guia mostra composição de fatias
- **THEN** os props do `<SubSlice>` correspondem à API real (`domain`, `name`, `props`)

### Requirement: Feature status cites failing evidence

Cada feature classificada como `stable` SHALL citar evidência que falha quando a feature quebra; features sem essa evidência SHALL ser `experimental` ou `roadmap`.

#### Scenario: Stable without evidence

- **WHEN** uma feature é marcada `stable` e sua evidência não exercita o comportamento
- **THEN** o gate de status falha e a feature é reclassificada

#### Scenario: Reclassification

- **WHEN** uma feature depende de um teste double ou de uma asserção de texto gerado
- **THEN** ela é rebaixada para `experimental` e a justificativa é registrada

### Requirement: Release report is reproducible

O relatório de release SHALL listar comandos exatos, variáveis de ambiente, saída real e commit avaliado; nenhum claim de aprovação SHALL existir sem todos os gates verdes, e o relatório SHALL ser verificado por um script que reexecuta os comandos e confere o commit.

#### Scenario: Env-dependent command

- **WHEN** um comando exige `NODE_ENV=development` para passar
- **THEN** o relatório declara a variável e não apresenta o comando sem ela como verde

#### Scenario: Missing gate

- **WHEN** `docs:check` ou o teste padrão falha
- **THEN** o relatório marca o release como bloqueado, não como aprovado

#### Scenario: Verifier re-runs the report

- **WHEN** o verificador executa sobre o relatório de 1.10.0
- **THEN** ele reexecuta cada comando, compara o commit com `HEAD` e falha em qualquer divergência

### Requirement: New capabilities are documented

`new-domain`, cron, agregações, permissões, OAuth com `state` e o pipeline de CSS SHALL aparecer no README, no contrato e/ou no help do CLI, com um exemplo que possa ser executado.

#### Scenario: New command discoverable

- **WHEN** o usuário procura `new-domain` no README ou no help
- **THEN** encontra a sintaxe, o `--fields` e o resultado esperado

#### Scenario: Example is executable

- **WHEN** um exemplo documentado é copiado para uma aplicação de teste
- **THEN** ele executa sem erro de API inexistente
