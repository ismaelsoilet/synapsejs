# Changelog

Todas as mudanças relevantes deste projeto. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

**Nada foi publicado no npm ainda.** O `synapsejs` existe apenas neste repositório; as versões abaixo
descrevem o que cada corte contém, não releases públicas. O primeiro `npm publish` está descrito em
`RELEASE-CHECKLIST.md`.

## [Unreleased]

### Adicionado

- **Hidratação React de verdade.** O componente só rodava no servidor: o browser recebia HTML e um
  script inline que sequestrava o formulário. Agora o servidor gera, por fatia, um bundle de browser a
  partir do artefato do **splitter** (que deixa de ser gate decorativo e passa a ser o que mantém SQL
  fora do cliente), hidrata o mesmo componente e liga `onSubmitAction` ao endpoint RPC. No servidor
  essa prop é a própria action: o mesmo ponto de chamada vale dos dois lados.
- `synapsejs/client`, um entry browser-safe (o pacote agora declara `exports`), para o cliente não
  arrastar compilador, postgres e CLI para dentro do bundle.
- `public/` servido (só `public/`, com o caminho normalizado), CORS fechado por padrão
  (`SYNAPSE_ALLOWED_ORIGINS`), RPC exigindo `application/json` (o que fecha CSRF por construção) e
  log estruturado opcional (`SYNAPSE_LOG=json`).
- **Sessão assinada** (`signSessionToken`/`verifySessionToken`): com `SYNAPSE_SESSION_SECRET`, os papéis
  vêm da assinatura e os headers de papel deixam de valer — antes qualquer cliente forjava `x-user-roles`.
- `synapse dev --watch`.

### Corrigido

- **Evolução de schema era um beco sem saída.** O runner re-executava *todos* os statements
  quando o texto do DDL mudava, então um `ALTER TABLE` aplicado uma vez voltava a rodar na
  próxima edição e falhava para sempre (`duplicate column name`). Cada statement agora é
  registrado individualmente (`_synapse_migration_statements`) e só o que é novo roda:
  adicionar uma coluna virou declarar o `ALTER` no `sliceSchema`. Um statement que falha não é
  registrado, então corrigir e rodar de novo funciona.
- **Todo erro de domínio respondia HTTP 400.** Um cliente não conseguia distinguir sessão
  expirada (401) de proibido (403), de registro inexistente (404), de conflito (409) ou de
  contrato inválido (422). O status agora é derivado do código de erro; códigos desconhecidos
  seguem 400.
- O gate de vazamento do splitter confundia a tag HTML `<select>` com um `SELECT` de SQL e
  quebrava o build de qualquer app com dropdown.
- Sessão só nascia com `Authorization` ou `x-user-id`: mandar apenas `x-user-roles` (o que o
  fluxo de cookie do browser produz) virava sessão anônima em silêncio.

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
