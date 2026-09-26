# Changelog

Todas as mudanças relevantes deste projeto. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

**Nada foi publicado no npm ainda.** O `synapsejs` existe apenas neste repositório; as versões abaixo
descrevem o que cada corte contém, não releases públicas. O primeiro `npm publish` está descrito em
`RELEASE-CHECKLIST.md`.

## [Unreleased]

Nada pendente de merge. O próximo corte é decidido pelo checklist de release.

## [0.6.0] — release candidate

### Corrigido

- **O pacote não era instalável por ninguém fora deste monorepo.** `typescript` estava em
  `devDependencies`, mas o CLI e os módulos de compilador o importam em runtime: qualquer comando
  de um consumidor quebrava com `Cannot find package 'typescript'`. Passou a dependência de runtime.
- **O `.gitignore` do template não chegava ao tarball** (empacotadores descartam esse nome). Todo
  projeto criado a partir do pacote publicado nasceria sem ignore, commitando `.synapse/`,
  `.codebase/`, `dist/` e `node_modules/`. O template envia o arquivo como `gitignore` e o
  `synapse new` restaura o nome ao copiar.
- Os scripts do `package.json` raiz ganharam `rehearse:publish`, e o CI passou a rodar o ensaio.

### Adicionado

- **Ensaio de publicação** (`bun run rehearse:publish`): empacota, instala o tarball fora do
  monorepo e exercita cada ponto de entrada — import, `info`, `new`, `check`, `test`, `skeleton`,
  `migrate`, `new-slice` (com o slice gerado typecheckando e passando os dois gates do splitter) e o
  handshake do MCP. Rodou em CI e encontrou os dois bugs acima na primeira execução.
- **Estudo comportamental** (`scripts/study/`, relatório em `STUDY.md`): protocolo pré-registrado e
  piloto de 3 tarefas × 2 stacks, com métricas derivadas do git e contagem de tentativas pelo runner.
- **CHANGELOG, política de versionamento e checklist de release.**

## [0.5.0]

### Adicionado

- **Segundo app de referência** em outro domínio (`examples/helpdesk-slices`, 2 fatias) e
  **exemplo de adoção sem o framework** (`examples/helpdesk-conventional`, as mesmas features em
  camadas). Escrever o segundo expôs cola que o framework dá de graça: o TypeBox só valida
  `format: 'email'` quando o formato é registrado.
- **Benchmark de superfície de contexto** (`bun run bench`): mede o fecho de imports de cada feature
  nas duas stacks e reporta dois números, porque a fronteira do fecho muda a resposta.
- **Paridade PostgreSQL** (`bun run test:postgres`): DDL num servidor fresco, idempotência de migração
  e round-trip de action, contra `postgres:16`; job de CI com service container.

### Corrigido

- DDL portável: `DATETIME` (só SQLite) virou `TIMESTAMP` no runner de migrações, no scaffolder e em
  todas as fatias — sem isso a migração falha num banco PostgreSQL vazio.
- `getDatabase` recusa esquema de URL não suportado em vez de abrir SQLite em silêncio, o que faria
  um teste de paridade passar contra o motor errado.
- Avisos do PostgreSQL silenciados no cliente: `stdout` carrega apenas o JSON do comando.

## [0.4.0]

### Adicionado

- **Invariantes das fatias sob `bun:test`** (`synapse test`): um wrapper gerado registra cada caso
  nomeado, o runner produz JUnit e o resultado sai em JSON por invariante, com nome e mensagem.
- `AGENTS.md`: contrato de fatia, contrato do splitter, contratos de comando/JSON, códigos de falha e
  uma lista explícita do que **não** existe.
- Teste da invariante de localidade e teste de contrato dos slices reais.

### Corrigido

- **Falsos verdes eliminados.** `test`, `migrate`, `synapse_run_pbt` (MCP) e `check <arquivo>`
  retornavam `PASS` sem ter verificado nada; agora falham com `NO_SLICES_DIR`,
  `TARGET_FILE_NOT_FOUND`, `NO_FILES_MATCHED`, `EMPTY_REPO_MAP` ou `NO_CASES`.
- **Splitter reescrito** por alcançabilidade via type checker, em três módulos, com imports passados
  adiante e dois gates no CI: compilação do emitido e ausência de vazamento no cliente. O output
  anterior não compilava.
- RBAC passou a ser aplicado de verdade na fatia de fatura, com e2e provando `UNAUTHORIZED` e
  `FORBIDDEN`.
- Repo map emite o contrato real (sem `any`), é determinístico e verificado no CI.
- SQLite: leitura de CTE não cai mais no caminho de escrita perdendo linhas; statements cacheados;
  singleton duplicado removido.
- `unwrap()` removido da superfície pública; `check --fast` removido (**medido** mais lento que o
  check completo: 2.5s vs 1.9s).
- README reescrito como estável/experimental/roadmap, cada linha apontando para o teste que falha
  quando a feature quebra.
