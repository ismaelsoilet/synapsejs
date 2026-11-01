# Spec Delta

## Purpose

Garante que estilos, error boundaries e navegação SPA sejam realmente ligados ao runtime e preservem o estado que a documentação promete.

## ADDED Requirements

### Requirement: CSS bundle exists before it is referenced

O bundle de CSS referenciado pelo HTML SHALL existir antes da primeira resposta que o referencia; `synapse build`, `dev` e `start` SHALL produzi-lo quando houver uma fonte de CSS, e a rota SHALL servi-lo com `Content-Type: text/css`.

#### Scenario: First boot with a CSS source

- **WHEN** a aplicação inicia com `src/styles/main.css` ou `public/synapse.css`
- **THEN** o HTML referencia o bundle e a primeira requisição ao CSS recebe 200 com o conteúdo

#### Scenario: No CSS source

- **WHEN** a aplicação não declara nenhuma fonte de CSS
- **THEN** nenhum link é emitido e nenhum tema é injetado silenciosamente

### Requirement: CSS pipeline semantics are honest

O pipeline SHALL compilar o formato que documenta ou SHALL ser documentado como cópia de arquivo; o modo air-gapped NÃO SHALL depender de CDN e NÃO SHALL injetar um tema hardcoded como default.

#### Scenario: Documented source format

- **WHEN** a documentação promete compilação de um formato
- **THEN** o pipeline produz CSS válido para esse formato, ou a documentação é corrigida para dizer que a compilação é responsabilidade da aplicação

#### Scenario: Air-gapped mode

- **WHEN** `SYNAPSE_DISABLE_CDN=true` está configurado
- **THEN** a página não carrega script ou stylesheet de terceiros e o layout continua estilizado pelo bundle local

### Requirement: Error boundary is integrated

O caminho de renderização do cliente SHALL envolver a view da fatia em `SliceErrorBoundary` por padrão, com opt-out explícito, exibindo um fallback e mantendo a navegação; o SSR SHALL continuar retornando 500 com `X-Robots-Tag` em falha de loader/render.

#### Scenario: Throwing child component

- **WHEN** um componente da fatia lança durante a renderização no cliente e o boundary está no default
- **THEN** o fallback é exibido, o erro é logado e o restante da aplicação continua navegável

#### Scenario: Explicit opt-out

- **WHEN** a aplicação desliga o boundary na configuração
- **THEN** o comportamento anterior é restaurado e a decisão está documentada

#### Scenario: SSR render failure

- **WHEN** o loader ou o render falha no servidor
- **THEN** a resposta é 500, sem hidratação do bundle e com `X-Robots-Tag: noindex, nofollow`

### Requirement: SPA navigation preserves marked state

A navegação SPA SHALL preservar foco, `checked`/`selected`, valor e scroll dos elementos marcados com `data-synapse-preserve`, com chaves escapadas; uma transição que falha SHALL cair para navegação completa.

#### Scenario: Focus and checked state

- **WHEN** o usuário navega com um input focado e um checkbox marcado
- **THEN** o foco e o estado marcado sobrevivem à troca de página

#### Scenario: Key with selector characters

- **WHEN** o valor de `data-synapse-preserve` contém aspas ou colchetes
- **THEN** a restauração não lança e a navegação continua

#### Scenario: Failed transition

- **WHEN** `startViewTransition` ou a hidratação do novo bundle falha
- **THEN** a aplicação executa navegação completa em vez de deixar a página em branco

### Requirement: No blank page on navigation failure

Uma falha de transição, parsing de props ou import do bundle SHALL resultar em navegação completa ou fallback visível, nunca em uma página em branco.

#### Scenario: Props payload is malformed

- **WHEN** o `<script data-synapse-props>` contém JSON inválido
- **THEN** a navegação não quebra o documento e o usuário chega à página de destino

#### Scenario: Client bundle import rejects

- **WHEN** o `import()` do bundle do cliente rejeita
- **THEN** a navegação completa é acionada e um erro é registrado no console
