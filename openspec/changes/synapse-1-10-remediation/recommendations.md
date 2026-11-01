# Recommendations

## Veredito

O SynapseJS é um artefato de engenharia sério, mas o mercado não é o problema que ele resolve
melhor. A recomendação é **não tentar ser um framework geral**. Certifique 1.10.0 como uma versão
interna confiável, **mantenha o framework como está** e trate adoção externa como uma hipótese a
ser testada com prazo e métrica, não como uma consequência automática de mais features. A extração
de `synapse-mcp`/`synapse-split` foi **rejeitada pelo mantenedor nesta rodada** (D-STRAT-01);
ferramentas novas e acoplamento com outros frameworks ficam para uma trilha futura.

## 1. Certifique 1.10.0 antes de qualquer feature nova

O working tree tem oito ondas reais, mas o comando publicado falha a suíte padrão, o gate de docs
falha e o CI é manual. Nenhuma feature nova deve entrar antes de:

- `bun test packages/synapse/test` verde **sem env vars**;
- `bun run test:all` verde sem env vars;
- `bun run docs:check` verde;
- `check`, `check:template`, `split`, `skeleton`, `db-drift`, `impact`, e2e e publish rehearsal
  verdes;
- um `release-evidence` versionado com comandos, saídas e commit.

Sem isso, cada nova onda aumenta a distância entre o que o README promete e o que o repositório
prova. O selo “APPROVED sem ressalvas” não deve existir antes do evidence file.

## 2. TypeScript 7 é uma trilha de produto, não um detalhe

O TS 7 é GA e removeu a API JS que oito módulos do compilador usam. A recomendação:

- **1.10:** pinar/vendorizar TS 5.9.3, erro nomeado `COMPILER_API_UNAVAILABLE`, resolução
  determinística e smoke de TS 7 na CI;
- **1.11:** escolher entre vendorizar 5.9, migrar para a API `unstable` do TS 7 ou usar a CLI do
  compilador. A decisão precisa de critério (esforço, cobertura, compatibilidade com projetos TS 7)
  e de um prazo, não de uma promessa.

Enquanto a migração não acontecer, a documentação deve dizer “TS 5.9 suportado; TS 7 não
suportado”, não “compatível”.

## 3. Não compita como framework geral

Os números do mercado continuam os mesmos da avaliação anterior: Next ~90,6M downloads/semana,
Hono ~100,9M, TanStack Start ~9,8M, SvelteKit ~4,5M, Convex ~2,4M; Wasp, o concorrente mais direto,
tem 18,8k stars e continua beta após cinco anos; Redwood pivotou para RedwoodSDK. O Synapse tem 0
stars, 0 forks e ~77 downloads/semana. A tese “um arquivo por feature” não é nova; o diferencial
real é o splitter + MCP + PBT no mesmo pacote.

Posicionamento recomendado: **“Bun-native vertical-slice framework para ferramentas internas e
desenvolvimento assistido por agentes”**. Isso é honesto, cabe no que o código já faz e não exige
competir com Next/Rails/Laravel em ecossistema.

## 4. Mantenha o framework como está (decisão atual)

O mantenedor decidiu **não extrair** `synapse-mcp`/`synapse-split` agora: o framework continua
como um monólito, e ferramentas novas — inclusive acoplamento com outros frameworks — ficam para
depois. Esta recomendação respeita essa decisão e registra o trade-off: a manutenção de uma pessoa
continua concentrada no pacote principal.

Se a extração voltar à mesa no futuro, os dois componentes com valor independente são:

1. **`synapse-mcp`** — repo map, schema catalog, drift, impact, rollback e test gate para qualquer
   repositório.
2. **`synapse-split`** — splitter AST + leak gate standalone, utilizável com Next/Hono/Vite.

A trilha futura recomendada é **ferramentas novas que acoplem o Synapse a outros frameworks**
(por exemplo, um adaptador de splitter/leak gate para Vite/Next), não uma extração destrutiva do
runtime atual.

## 5. Prove o claim “AI-native” com um benchmark de agente

O `bun run bench` mede superfície de contexto (1.627 vs 1.832 tokens, ~11%), não sucesso de agente.
A recomendação é um experimento controlado:

- a mesma feature (ex.: “abrir ticket” + “atribuir ticket”) em Synapse e em Next/TanStack;
- um agente com o mesmo modelo, orçamento e prompt;
- métricas: taxa de sucesso, tokens de entrada/saída, tempo até o primeiro teste verde, arquivos
  tocados, erros de import, intervenções humanas;
- resultado publicado com o script e os artefacts.

Se o ganho não for material (>30% em sucesso ou tokens, por exemplo), o claim “built for AI agents”
deve ser rebaixado para “convenções que reduzem contexto”, que é o que o bench realmente mostra.

## 6. Defina um gate de adoção e cumpra-o

Antes de investir mais como plataforma, escolha uma métrica e um prazo:

- 3 usuários externos reais (não amigos) construindo algo;
- 10 deploys reais;
- 3 contribuidores externos;
- 1 aplicação com 50+ slices em uso;
- ou 1 cliente pagante.

Se o gate não for atingido, mantenha o Synapse como ferramenta interna/portfólio e pare de
investir em features de plataforma. Isso não é fracasso: é escopo. O projeto já é um artefato
forte de engenharia, e usá-lo nos seus próprios produtos é uma razão válida para continuar.

## 7. Disciplina de release e de API

- **Semver:** 1.10.0 para as oito ondas; mudanças de comportamento com nota de migração.
- **Sem opção morta:** `runAt` ou funciona ou sai do contrato; `cron` no Postgres ou funciona ou
  falha com erro nomeado; `aggregate` no mock ou agrega ou falha.
- **Sem escrita parcial silenciosa:** `new-domain` devolve `Err` e limpa o que criou.
- **Sem claim sem teste:** a tabela de features cita um teste que falha quando a feature quebra.
- **Sem “aprovado” sem evidência:** o release-evidence é parte do release, não um extra.

## 8. Documentação como produto

O guia de arquitetura é bom conteúdo, mas o exemplo central usa `db.tx` e a API é `db.transaction`.
Corrija e adicione exemplos executáveis. Para agentes, a documentação mais valiosa é o contrato
(`synapse contract`), o repo map e as tools MCP; mantenha esses três alinhados ao comportamento.

## Matriz de decisão

| Objetivo | Recomendação |
| --- | --- |
| Ferramenta interna / produtos próprios | **Continuar**, com 1.10 certificado e escopo estreito (Bun, SQLite, CRUD, agentes) |
| Adoção OSS / comunidade | Manter o monólito; benchmark de agente; gate de 90 dias; novas ferramentas/acoplamento como trilha futura |
| Produto comercial / competir com Next/Rails | **Não**; o mercado é winner-take-most e o custo de ecossistema é proibitivo |
| Aprendizado / portfólio | **Continuar**, mas declarar isso como objetivo e parar de otimizar para adoção |

## O que mudaria esta recomendação

- 10+ deploys externos ou 3+ contribuidores;
- um benchmark de agente publicado com ganho material e reproduzível;
- um cliente pagante ou uma equipe usando o framework em produção;
- migração para TS 7 concluída sem regressão;
- um ecossistema mínimo (auth, pagamentos, e-mail, observabilidade) mantido por terceiros.

Sem um desses sinais, o caminho de menor arrependimento é: **certificar 1.10, manter o framework
como está, reavaliar com dados de uso e só então considerar ferramentas novas/acoplamento**, não
novas ondas.
