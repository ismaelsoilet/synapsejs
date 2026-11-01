# Spec Delta

## Purpose

Garante que o scaffolding de domínio, os caminhos de escrita e o diagnóstico de fatias grandes sejam seguros, atômicos e documentados.

## ADDED Requirements

### Requirement: Domain scaffolding rejects unsafe paths

`synapse new-domain`, `synapse new-shared` e a tool MCP `synapse_scaffold_domain` SHALL validar cada segmento e SHALL assegurar que o caminho resolvido permanece dentro do diretório que a operação controla, antes de escrever qualquer arquivo.

#### Scenario: Traversal attempt

- **WHEN** o domínio é `../../tmp` ou contém separador, prefixo absoluto, segmento vazio ou excesso de comprimento
- **THEN** a operação falha com erro de caminho e nenhum arquivo ou diretório é criado

#### Scenario: Valid domain

- **WHEN** o domínio é `faturamento`
- **THEN** os arquivos são criados somente dentro de `src/slices/faturamento` e `src/shared`

### Requirement: Domain scaffolding is atomic

Uma falha parcial em `new-domain` SHALL retornar `Err` e SHALL remover os arquivos que a própria operação criou, ou SHALL retornar um erro de escrita parcial que lista os caminhos; NUNCA SHALL devolver `Ok` com um conjunto incompleto de arquivos.

#### Scenario: File already exists

- **WHEN** o slice inicial ou o módulo compartilhado já existe
- **THEN** a operação retorna `Err` e não deixa um domínio parcialmente criado

#### Scenario: Write failure in the middle

- **WHEN** a criação do módulo compartilhado falha depois do layout e do slice
- **THEN** os arquivos criados são removidos ou o erro informa exatamente quais permaneceram

### Requirement: Domain scaffolding is discoverable and callable

`new-domain` SHALL aparecer no help do CLI, no README e no contrato, e a tool MCP correspondente SHALL ter um teste de invocação real, não apenas de presença na lista.

#### Scenario: CLI help

- **WHEN** o usuário executa o help do CLI
- **THEN** `new-domain` aparece com a sintaxe e o `--fields`

#### Scenario: MCP invocation

- **WHEN** a tool `synapse_scaffold_domain` é invocada com um domínio válido
- **THEN** a resposta lista os três arquivos criados e eles existem no disco

### Requirement: Large slice warning is tested and non-blocking

`WARN_LARGE_SLICE` SHALL ser emitido para fatias acima de 500 linhas, SHALL ser não bloqueante e SHALL ter um fixture que o exercite; o limiar do código e o valor do guia SHALL concordar.

#### Scenario: Slice above the threshold

- **WHEN** uma fatia tem 501 linhas
- **THEN** o split retorna PASS com o diagnóstico `WARN_LARGE_SLICE`

#### Scenario: Slice at the threshold

- **WHEN** uma fatia tem exatamente 500 linhas
- **THEN** nenhum warning é emitido

#### Scenario: Warning does not block

- **WHEN** o único diagnóstico é `WARN_LARGE_SLICE`
- **THEN** o status do split permanece PASS e nenhum leak é reportado

### Requirement: Generated layout works air-gapped

O layout gerado por `new-domain` SHALL funcionar com o bundle de CSS local no modo air-gapped ou SHALL documentar explicitamente a dependência de uma pipeline de estilos da aplicação.

#### Scenario: Air-gapped domain

- **WHEN** o domínio é gerado e servido com `SYNAPSE_DISABLE_CDN=true`
- **THEN** o layout é estilizado pelo CSS local e não faz requisição a CDN

#### Scenario: Missing style pipeline

- **WHEN** a aplicação não tem pipeline de estilos
- **THEN** o guia do `new-domain` informa o que precisa ser configurado antes de usar o layout
