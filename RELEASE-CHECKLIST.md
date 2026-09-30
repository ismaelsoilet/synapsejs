# Release checklist — 1.9.0

Estado desta release: **código, documentação e gates prontos no repositório; falta a tag.**
A tag `v1.9.0` é o gatilho do workflow de publicação (`.github/workflows/release.yml`), então ela é a
decisão explícita do operador — nada publica por push em `main`.

## Rodando todos os gates

```bash
bash scripts/run-gates.sh              # 21 gates sem serviço externo
bash scripts/run-gates.sh --with-docker  # + paridade/adaptadores PostgreSQL e a imagem
```

Cada linha imprime o exit code do gate (é assim que uma lint vermelha passou batido duas vezes
neste repositório: ler a saída em vez do código). Os resultados abaixo vieram dessa execução.

## O que os gates deste commit dizem (executado localmente)

| Gate | Comando | Resultado |
|---|---|---|
| Suíte do framework | `bun test packages/synapse/test` | **568 testes, 0 falhas**, 6 skipped (Postgres sem engine local) |
| Typecheck do monorepo | `bun run check` | 0 erros |
| Template como consumidor | `bun run check:template` | 0 erros |
| Lint | `bun run lint` | 0 erros, 69 warnings de fronteira aceitos |
| Deriva de documentação | `bun run docs:check` | PASS — 568 testes / 70 arquivos / 18 tools / v1.9.0, tabela de features 46-3-1 |
| Cobertura | `bun run coverage:check` | PASS — 60% funções / 72,4% linhas (pisos 55/70) |
| Splitter, dois gates, três apps | `bun run split` | 0 diagnósticos, 0 vazamentos |
| Oráculos das fatias | `bun run test:slices` · `test:crm` · `test:helpdesk` · `test:helpdesk-conventional` | 24/24 · 18/18 · 9/9 · 6/6 |
| E2E ao vivo | `bun run test:e2e` | 7/7 |
| Paridade PostgreSQL | `TEST_DATABASE_URL=... bun run test:postgres` | PASS (migração aplicada, segunda execução ignorada, linha persistida) |
| Adaptadores PostgreSQL | `TEST_DATABASE_URL=... bun test packages/synapse/test/postgres-adapters.test.ts` | 3/3 — cliente com rollback real, claim atômico com dead-letter, event hub com payload offloaded |
| Ensaio de publicação | `bun run rehearse:publish` | 18 passos aprovados |
| Gates negativos | no-slices falha, fixture com vazamento derruba o gate, flag/comando desconhecidos recusados, config quebrada é fatal | os quatro passam |
| Imagem de container | `docker build` + `docker run` | sobe como usuário `bun`, cria seus arquivos, `/health` OK, página SSR renderiza e o bundle da fatia é construído sob demanda (200) |
| Benchmark de contexto | `bun run bench` | coluna `app`: 1.832 → 1.627 tokens (~11%) |
| Benchmark de concorrência | `bun run bench:concurrency` | 3 fatias descobertas, braços SSR e RPC sem erro, gerador de carga em processo separado |

Números de teste mudam com o tempo: quem mantém os documentos alinhados é o gate de documentação
(`bun run docs:check`) — se ele passa, os números citados correspondem à execução.

## Passos para publicar

1. `git tag v1.9.0 && git push origin v1.9.0` — a versão da tag **precisa** ser igual a
   `packages/synapse/package.json` (o workflow verifica e aborta se não for).
2. O workflow roda a suíte, os splits, os oráculos, `test:all`, `docs:check` e o ensaio de publicação;
   qualquer falha aborta o publish.
3. `npm publish --access public --provenance` com o environment `github-actions-release`. A
   credencial é **trusted publishing (OIDC)**: o job pede `id-token: write` e o repositório não tem
   token de npm configurado, então o npm troca a identidade do GitHub por uma credencial efêmera e
   assina a proveniência. O job instala um npm **pinado** (`npm@12.2.0`) porque Node 22 traz o npm 10,
   que não fala OIDC — foi exatamente isso que fez o primeiro run da v1.9.0 falhar com `ENEEDAUTH`.
4. Criar o GitHub Release com o texto de `docs/releases/1.9.0.md`.

## Depois de publicar

- [ ] Conferir a versão no registro (`npm view @ismaelsoilet/synapsejs version`).
- [ ] Conferir que `bunx synapsejs new <app>` instala a 1.9.0 e sobe (`bun run dev`).
- [ ] Avisar quem está na 1.8 apontando para `docs/migration-1.9.md` (ou `docs/migracao-1.9.pt-BR.md`).

## O que esta release NÃO resolve (dito antes de perguntarem)

- **Zero adotantes externos registrados** — nenhum deploy de terceiros é conhecido; `stable` significa
  "há teste que falha se regredir", não "alguém roda em produção".
- Sem backend compartilhado: rate limit, cache de SSR e event hub são **por processo**. N instâncias
  atrás de um load balancer permitem N vezes a cota por instância, e a taxa de acerto do cache é por
  instância.
- A publicação usa um token de npm de longa duração; trusted publishing sem token não está configurado.
- A imagem de container exige `SYNAPSE_SESSION_SECRET` (ou `--acknowledge-insecure`) em produção por
  causa da regra nova da 1.9 — ela recusa subir sem isso, de propósito.
- O `typescript` permanece na imagem porque o framework typechecka fatias em runtime (é dependência de
  execução, não de build).
