# Release checklist

Estado: **nada foi publicado no npm.** O pacote existe apenas neste repositório. Esta é a ordem
operacional para o primeiro publish, com o que já está verificado e o que depende de você.

## O que já está verificado (por mim, localmente)

- [x] Suíte do framework: `bun test packages/synapse/test` — 365 testes, 50 arquivos (100% PASS).
- [x] Typecheck do monorepo: `bun run check` — 0 erros.
- [x] Template typechecka como consumidor: `bun run check:template` — 0 erros.
- [x] Splitter com os dois gates em ambos os apps: `bun run split` — 0 diagnósticos, 0 vazamentos.
- [x] Oráculos das fatias com relatório por invariante: `bun run test:all` — 100% PASS.
- [x] Paridade PostgreSQL contra `postgres:16-alpine`: `TEST_DATABASE_URL=... bun run test:postgres`.
- [x] Ensaio de publicação completo: `bun run rehearse:publish` — 18 passos aprovados.
- [x] Mapa do repo determinístico: regenerar não altera o arquivo commitado.
- [x] Contrato público travado por teste (runtime + tipos) — MCP Server com ferramentas Jev System One.
- [x] Integração Cognitiva Jev-Harness: Sistema 1 não-autorregressivo em oráculos e migrações.
- [x] Integração OpenSpec 1.13.2: 12 skills e slash commands integrados para agentes.
- [x] Guardrail Pre-commit: Verificação de testes ativada em `.git/hooks/pre-commit`.
- [x] 4 Ondas Arquiteturais integradas: micro-bundles (<500B), dynamic SEO (`sliceMeta`), layouts hierárquicos, rate limiting sliding-window, proteção contra upload DoS, `PostgresEventHub`, i18n, `<DataForm>` aninhado, blacklist de revogação de tokens e TOTP 2FA.

## Já feito

- [x] **Push para o GitHub** (`ismaelsoilet/synapsejs`).
- [x] **Suíte de testes e paridade**: 365 testes aprovados.
- [x] **Release v1.1.0**: Criada no GitHub com changelog completo.
- [x] **Release v1.2.0**: Integração Jev System One + OpenSpec + Skills de Agentes.

