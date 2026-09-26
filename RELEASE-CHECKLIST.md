# Release checklist

Estado: **nada foi publicado no npm.** O pacote existe apenas neste repositório. Esta é a ordem
operacional para o primeiro publish, com o que já está verificado e o que depende de você.

## O que já está verificado (por mim, localmente)

- [x] Suíte do framework: `bun test packages/synapse/test` — 108 testes, 13 arquivos.
- [x] Typecheck do monorepo: `bun run check` — 0 erros.
- [x] Template typechecka como consumidor: `bun run check:template`.
- [x] Splitter com os dois gates em ambos os apps: `bun run split` — 0 diagnósticos, 0 vazamentos.
- [x] Oráculos das fatias com relatório por invariante: `bun run test:all`.
- [x] Paridade PostgreSQL contra `postgres:16-alpine`: `TEST_DATABASE_URL=... bun run test:postgres`.
- [x] Ensaio de publicação completo: `bun run rehearse:publish` — pack, instalação fora do monorepo,
      import, `info`, `new`, `check`, `test`, `skeleton`, `migrate`, `new-slice`, split do slice
      gerado e handshake do MCP.
- [x] Mapa do repo determinístico: regenerar não altera o arquivo commitado.
- [x] Contrato público travado por teste (runtime + tipos).

## Já feito

- [x] **Push para o GitHub** (`ismaelsoilet/synapsejs`, privado) em 2026-09-26.
- [x] **Primeira execução real do CI** — [run 36220544931](https://github.com/ismaelsoilet/synapsejs/actions/runs/36220544931):
      `test` 1m11s ✓, `postgres-parity` 31s ✓, `publish-rehearsal` 28s ✓. Verde na primeira tentativa,
      incluindo o serviço PostgreSQL e o ensaio de publicação dentro do runner.

## O que só você pode fazer
- [ ] **Congelar a API.** O que a 1.0 promete está listado em `AGENTS.md` §9 e travado pelo bloco
      "public contract" em `packages/synapse/test/machine-types.test.ts`. Congelar é uma decisão sua.
- [ ] **Criar o token do npm** (`NPM_TOKEN`) como secret do repositório, com permissão de publish e
      2FA configurado para automação.
- [ ] **Tag `v0.6.0`** (a versão do `packages/synapse/package.json` tem que bater com a tag — o
      workflow aborta se não bater). O `release.yml` roda todos os gates + o ensaio e só então publica.
- [ ] **Verificar o pacote publicado de fora**: `bunx synapsejs new app && cd app && bun install`, e
      rodar `bun run dev`. O ensaio local cobre o tarball; o registry é um caminho diferente.

## Critérios para promover 0.6.0 → 1.0

1. O ensaio de publicação passa **a partir do registry** (não só do tarball local).
2. ~~O CI rodou de verdade e ficou verde ao menos uma vez.~~ **Feito** — run 36220544931, 3 jobs verdes.
3. Um estudo com implementadores **independentes** (o atual tem 1 executor, que sou eu, e 3 tarefas —
   ver `STUDY.md`) sustenta ou refuta a claim forte.
4. A superfície de API está congelada por decisão explícita, não por decurso de prazo.

Enquanto (1)–(4) não estiverem fechados, o número 1.0 promete mais do que a evidência sustenta.
