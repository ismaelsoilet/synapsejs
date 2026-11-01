# Spec Delta

## Purpose

Define uma semântica única e testável para jobs agendados por cron ou data absoluta, com escopo de engine explícito e sem opções silenciosamente ignoradas.

## ADDED Requirements

### Requirement: Cron day-of-month and day-of-week use OR semantics

Quando dia-do-mês e dia-da-semana são ambos restritos, o parser SHALL considerar a união dos matches (OR), conforme POSIX/Vixie cron, e NÃO SHALL exigir que os dois coincidam.

#### Scenario: Friday or the 13th

- **WHEN** a expressão `0 0 13 * 5` é avaliada a partir de uma data conhecida
- **THEN** a próxima execução ocorre na primeira sexta-feira ou no primeiro dia 13, o que vier antes

#### Scenario: Both fields unrestricted

- **WHEN** dia-do-mês e dia-da-semana são `*`
- **THEN** a expressão continua executando todos os dias

### Requirement: Cron syntax is validated

O parser SHALL validar faixas, passos e listas, aceitar domingo como `0` e `7`, e rejeitar sintaxe não suportada com uma mensagem clara em vez de procurar uma data por cinco anos.

#### Scenario: Invalid range or step

- **WHEN** a expressão contém `70-80/5` ou `*/0`
- **THEN** o parser falha imediatamente com erro de faixa ou passo

#### Scenario: Sunday as seven

- **WHEN** a expressão usa `7` no campo de dia-da-semana
- **THEN** o parser aceita o valor como domingo

#### Scenario: Unsupported syntax

- **WHEN** a expressão usa nomes, `L`, `W`, `#` ou `?`
- **THEN** o parser rejeita com uma mensagem que nomeia a sintaxe não suportada

### Requirement: runAt is honored or removed

`defineJob({ runAt })` SHALL agendar a primeira execução para o timestamp absoluto em todos os engines que expõem a opção, ou a opção SHALL ser removida do contrato público; uma opção aceita e ignorada NÃO SHALL existir.

#### Scenario: Absolute schedule

- **WHEN** um job é definido com `runAt` no futuro e registrado
- **THEN** a primeira execução é enfileirada para aquele instante

#### Scenario: Conflicting schedule options

- **WHEN** `runAt` e `delaySeconds` são fornecidos juntos na mesma chamada
- **THEN** a chamada falha com erro claro em vez de escolher um silenciosamente

### Requirement: Cron engine scope is explicit

Cron SHALL ser suportado no SQLite e no PostgreSQL, ou o engine sem suporte SHALL falhar com `CRON_UNSUPPORTED_ENGINE` no registro do job; NUNCA SHALL ignorar a opção `cron` em silêncio.

#### Scenario: SQLite schedules a cron job

- **WHEN** um job com `cron` é registrado no `QueueEngine` SQLite
- **THEN** a primeira ocorrência é enfileirada e as seguintes são reagendadas

#### Scenario: PostgreSQL without cron support

- **WHEN** um job com `cron` é registrado no `PostgresQueueEngine` sem suporte implementado
- **THEN** o registro retorna `CRON_UNSUPPORTED_ENGINE` e o job não é aceito como agendado

### Requirement: Scheduled jobs declare their payload

Um job cron SHALL declarar o payload inicial por factory ou usar `{}` como default explícito; se o schema do job rejeitar esse payload, o registro SHALL falhar com erro claro, não em tempo de execução.

#### Scenario: Schema rejects the default payload

- **WHEN** um job cron declara um schema que exige um campo e não fornece factory de payload
- **THEN** o registro falha com erro de payload inválido

#### Scenario: Payload factory

- **WHEN** um job cron fornece uma factory de payload
- **THEN** a primeira execução e as recorrências recebem o payload produzido pela factory

### Requirement: DLQ inspection and retry are consistent

Inspeção e retry de dead-letter queue SHALL ter o mesmo comportamento observável nos engines suportados; um retry SHALL resetar `attempts` exatamente uma vez e devolver o job para `pending`.

#### Scenario: Retry a failed job

- **WHEN** um job em DLQ é reprocessado
- **THEN** ele volta a `pending` com `attempts = 0` e é executado novamente

#### Scenario: Retry a non-failed job

- **WHEN** o retry é chamado para um job que não está em DLQ
- **THEN** a operação retorna `false` e não altera o job

### Requirement: Scheduling failures are observable

Falhas ao enfileirar o agendamento inicial SHALL ser retornadas ou registradas no logger e NÃO SHALL produzir uma promise rejeitada não tratada.

#### Scenario: Database failure during registration

- **WHEN** o insert do agendamento inicial falha
- **THEN** o erro é registrado e o processo não emite `unhandledRejection`
