# Spec Delta

## Purpose

Garante que permissões e OAuth funcionem no caminho de produção com token assinado, com limites de claim e erros explícitos.

## ADDED Requirements

### Requirement: Signed tokens carry permissions

Tokens assinados SHALL carregar as permissões do usuário no claim assinado; depois da verificação, `requireAuth(session, { permissions })` SHALL aplicá-las. Tokens emitidos antes desta mudança SHALL continuar válidos com lista de permissões vazia. Consulta ao banco pode ser um fallback documentado, mas NÃO SHALL ser o contrato principal.

#### Scenario: Sign and verify permissions

- **WHEN** um token é assinado com `permissions: ['orders:read']` e verificado
- **THEN** a sessão resultante contém a permissão e `requireAuth` a aceita

#### Scenario: Legacy token

- **WHEN** um token válido não contém o claim de permissões
- **THEN** ele continua autenticado e a sessão tem permissões vazias

#### Scenario: Missing permission

- **WHEN** a sessão não tem a permissão exigida e não é admin
- **THEN** `requireAuth` retorna `FORBIDDEN`

### Requirement: Permission claims are validated

O claim de permissões SHALL ser um array de strings, com limite de quantidade e comprimento; um token com claim malformado, adulterado ou excessivo SHALL ser rejeitado como `INVALID_TOKEN` antes de qualquer autorização.

#### Scenario: Malformed claim

- **WHEN** o claim de permissões não é um array de strings
- **THEN** `verifySessionToken` retorna `INVALID_TOKEN`

#### Scenario: Oversized claim

- **WHEN** o claim excede o limite configurado de permissões ou de caracteres
- **THEN** o token é rejeitado com `INVALID_TOKEN` antes de autorizar a requisição

#### Scenario: Tampered payload

- **WHEN** o payload é alterado sem a assinatura correspondente
- **THEN** a verificação falha antes de ler os claims

### Requirement: Admin bypass is explicit and configurable

O bypass de `admin`/`superadmin` SHALL ser documentado e configurável, com default `true` por compatibilidade; desligá-lo SHALL fazer a verificação normal de permissões.

#### Scenario: Default bypass

- **WHEN** a configuração default é usada e um usuário `admin` exige uma permissão que não está na lista
- **THEN** a ação é permitida porque o bypass está ligado, e o default está documentado

#### Scenario: Bypass disabled

- **WHEN** o bypass é desligado e o usuário admin não possui a permissão
- **THEN** `requireAuth` retorna `FORBIDDEN`

### Requirement: OAuth token exchange is bounded

`exchangeOAuthCode` SHALL aplicar timeout e abortar a requisição, e SHALL retornar `Err` em falha de rede ou resposta não-2xx; NÃO SHALL lançar.

#### Scenario: Slow provider

- **WHEN** o provedor não responde dentro do timeout configurado
- **THEN** a função retorna `Err('NETWORK_ERROR')` e a requisição é abortada

#### Scenario: Provider rejects the code

- **WHEN** o provedor responde com status não-2xx
- **THEN** a função retorna `Err('TOKEN_EXCHANGE_FAILED')`

### Requirement: OAuth state and PKCE are verifiable

O template SHALL gerar e validar o parâmetro `state`, e o PKCE SHALL seguir RFC 7636: verifier entre 43 e 128 caracteres, método `S256` e challenge igual ao SHA-256 do verifier codificado em base64url.

#### Scenario: State mismatch

- **WHEN** o callback recebe um `state` diferente do emitido para a sessão
- **THEN** a troca de código é recusada

#### Scenario: PKCE values

- **WHEN** um desafio PKCE é gerado
- **THEN** o verifier tem entre 43 e 128 caracteres e o challenge é o SHA-256 correto com método `S256`

### Requirement: Login template proves permissions end to end

O oracle do template de login SHALL assinar um token com permissões, verificar o token com a mesma função do servidor e provar que uma ação protegida por permissão aceita a sessão resultante.

#### Scenario: Issued token is accepted

- **WHEN** o oracle executa o login com um usuário que tem `orders:read`
- **THEN** o token emitido é aceito por `verifySessionToken` e a ação protegida retorna sucesso

#### Scenario: Permission is enforced

- **WHEN** o mesmo usuário tenta uma ação que exige `orders:write`
- **THEN** a ação retorna `FORBIDDEN`
