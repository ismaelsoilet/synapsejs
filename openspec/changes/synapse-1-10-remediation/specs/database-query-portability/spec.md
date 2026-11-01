# Spec Delta

## Purpose

Define um contrato único para agregações, `HAVING` e contagens em SQLite e PostgreSQL, com SQL parametrizado e sem depender de extensões de dialeto.

## ADDED Requirements

### Requirement: HAVING is portable

`HAVING` SHALL aceitar uma condição agregada estruturada com função, coluna, operador e valor, compilada como uma expressão portável (por exemplo, `SUM(amount) > $1`), e NÃO SHALL depender de alias de saída em engines que o proíbem.

#### Scenario: Same aggregate on SQLite and PostgreSQL

- **WHEN** a mesma consulta com `GROUP BY` e `HAVING SUM(amount) > 1000` é executada nos dois engines
- **THEN** os dois retornam o mesmo conjunto de grupos e o teste real de PostgreSQL passa

#### Scenario: Alias-only condition

- **WHEN** uma condição de `HAVING` referencia apenas um alias de saída
- **THEN** o builder a compila para a expressão agregada equivalente ou a rejeita com um erro explícito, nunca gera SQL que falha só em um engine

### Requirement: count, exists and aggregate share one contract

Todos os `DatabaseClient` SHALL implementar `count`, `exists` e `aggregate` com o mesmo contrato observável; `exists` SHALL usar uma consulta com limite e NÃO SHALL varrer a tabela inteira.

#### Scenario: Existence on a large table

- **WHEN** `exists` é chamado em uma tabela com muitos registros correspondentes
- **THEN** a consulta para no primeiro registro e o resultado é booleano

#### Scenario: Aggregate grouping

- **WHEN** `aggregate` recebe `select`, `aggregations`, `groupBy` e `orderBy`
- **THEN** o resultado contém uma linha por grupo com os valores agregados

### Requirement: Mock database does not silently ignore aggregation

`MockDatabaseClient` SHALL implementar agregações e agrupamento de forma fiel ou SHALL falhar com um erro explícito de operação não suportada; NUNCA SHALL devolver linhas cruas como se fossem agregadas.

#### Scenario: Aggregate through the mock

- **WHEN** um slice test chama `aggregate` no `MockDatabaseClient`
- **THEN** recebe grupos agregados corretos ou um erro `UNSUPPORTED_OPERATION`, nunca as linhas originais

### Requirement: Aggregation SQL is allowlisted and parameterized

Funções, identificadores e operadores de agregação SHALL ser validados por allowlist; valores SHALL ser enviados como parâmetros; uma entrada inválida SHALL falhar antes de executar SQL.

#### Scenario: Invalid aggregate function

- **WHEN** `aggregations` contém uma função fora de `COUNT`, `SUM`, `AVG`, `MIN` e `MAX`
- **THEN** a compilação falha com erro de função inválida e nenhum SQL é executado

#### Scenario: Injection in groupBy

- **WHEN** `groupBy` contém um separador, comentário ou expressão arbitrária
- **THEN** a compilação falha com erro de identificador inválido

#### Scenario: Value is a parameter

- **WHEN** uma condição de `HAVING` usa um valor numérico
- **THEN** o SQL contém um placeholder e o valor aparece apenas na lista de parâmetros

### Requirement: PostgreSQL parity runs in CI

Os testes de agregação e `HAVING` SHALL executar contra um PostgreSQL real na CI; quando o engine é esperado, a ausência de conexão SHALL falhar em vez de silenciosamente pular.

#### Scenario: CI with PostgreSQL service

- **WHEN** a CI fornece `TEST_DATABASE_URL`
- **THEN** a suíte de agregação executa e reporta pass ou fail

#### Scenario: Deliberate regression

- **WHEN** o compilador de `HAVING` volta a emitir um alias de saída
- **THEN** o teste de PostgreSQL falha e identifica a consulta
