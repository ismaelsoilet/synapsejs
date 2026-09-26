# Estudo: a convenção de fatia única reduz o custo de uma mudança?

Protocolo pré-registrado em [`scripts/study/README.md`](./scripts/study/README.md), escrito antes de
qualquer execução. Resultados brutos (append-only, gravados pelo runner, não por mim):
[`scripts/study/results/`](./scripts/study/results/).

## Veredito (leia isto antes de citar qualquer número)

O piloto **sustenta a claim de arquivos e nada além dela**.

- **Sustentado:** uma mudança toca **1 arquivo** na stack de fatias contra **2, 3 e 6** na convencional
  (média 1,0 vs 3,7). A Locality of Behavior, medida.
- **Não sustentado:** "menos trabalho". A stack de fatias escreveu **mais linhas** (+197 vs +151),
  porque o arquivo único carrega contrato, action, UI e oráculo juntos, enquanto o lado convencional
  reaproveita arquivos que já existem e testa em menos linhas.
- **Não medido:** "menos iterações". Todas as seis células ficaram verdes na **primeira** tentativa de
  implementação — o conjunto de tarefas é fácil demais para essa métrica discriminar. Um teto não é
  evidência de igualdade.
- **Não medido, nunca:** tokens consumidos por um agente e taxa de sucesso do agente.

## Método

Três tarefas idênticas nas duas stacks, no mesmo repositório, mesma linguagem, mesmo runtime. O
runner (`bun run study --task <id> --stack <stack>`) é o **único** escritor de `results/`: ele conta
tentativas no log append-only e deriva arquivos/linhas do `git`, de modo que nenhum número aqui foi
digitado por mim. `--reset` reverte a célula antes da próxima.

| | |
|---|---|
| Tarefas | T1 prioridade máxima 3 com `INVALID_PRIORITY` · T2 duplicado com `DUPLICATE_TICKET` · T3 fechar chamado com papel `support` e `ALREADY_CLOSED` |
| Stack A | `examples/helpdesk-slices` — uma fatia por feature |
| Stack B | `examples/helpdesk-conventional` — routes → service → db → schemas → ui, sem o framework |
| Verde | os gates da própria stack: `check` + `test` (oráculos na A, `bun test` na B) |

## Resultados

| task | stack | registros | arquivos tocados | linhas (+/-) | caminhos |
|---|---|---|---|---|---|
| T1 | slices | 1 | 1 | +23/-1 | `create-ticket.slice.tsx` |
| T1 | conventional | 1 | 2 | +15/-1 | `ticket-service.ts`, `ticket-service.test.ts` |
| T2 | slices | 1 | 1 | +27/-1 | `create-ticket.slice.tsx` |
| T2 | conventional | 1 | 3 | +32/-2 | `db/tickets.ts`, `ticket-service.ts`, teste |
| T3 | slices | 2 | 1 | +147/-0 | `close-ticket.slice.tsx` (nova) |
| T3 | conventional | 1 | 6 | +104/-4 | `db`, `schemas`, `server`, `service`, teste, `routes/close-ticket.ts` (nova) |

Médias: **1,0 arquivo vs 3,7**; **+197 vs +151 linhas**.

## Defeitos de medição encontrados durante o piloto (declarados, não escondidos)

1. **Arquivo novo não era contado.** O coletor usava só `git diff --numstat`, que ignora arquivo
   ainda não rastreado — exatamente o que uma fatia nova é. A célula T3/slices ficou verde com
   `files: 0`, número impossível. Corrigido (`git ls-files --others` + contagem de linhas), a célula
   foi remedida e o log mantém **as duas entradas**: a inválida e a válida. O relatório usa a última e
   declara a invalidação.
2. **O tempo medido não é tempo de implementação.** O cronômetro corre de quando os gates são
   invocados, não de quando eu comecei a editar. Os 1–3s por célula são tempo de gate. Por isso a
   coluna de segundos saiu da tabela: seria lida como esforço e não é.

## Limitações (as mesmas do protocolo, agora com o piloto na mão)

- **n = 3 tarefas, 1 executor, e o executor sou eu** — o mesmo agente que passou a sessão inteira
  raciocinando sobre este framework. Contaminação direta: não sou um sujeito ingênuo. Um estudo que
  sustente decisão de produto precisa de implementadores independentes e cegos quanto à hipótese.
- **Uma execução por célula.** Sem repetição, sem variância, sem teste de significância. Isto é um
  piloto, não um experimento.
- **Tarefas pequenas e sintéticas.** Mede custo de coordenação (quantos lugares a mudança toca), não
  custo de entender um sistema grande e desconhecido.
- **Assimetria de verificação.** Na stack A o oráculo é obrigatório por convenção; na B, nada obriga
  um teste a existir. Pedi teste nos dois lados e escrevi teste nos dois lados, mas a stack A é
  estruturalmente mais exigente — o que torna a comparação levemente favorável à B.
- **O "verde" da stack B não é o mesmo que o da A.** `synapse check` roda o tsconfig do projeto e
  falha com `NO_FILES_MATCHED`; `tsc --noEmit` não tem esse guard.

## O que mudaria a recomendação

- Se a convencional tivesse tocado 1 arquivo em T3, a claim de localidade perderia base.
- Se a convencional tivesse chegado ao verde em menos tentativas, a vantagem de arquivos não se
  traduziria em menos trabalho. **Não foi o caso, mas também não houve diferença: todas as células
  foram verdes de primeira, então a métrica não decidiu nada.**

## Consequência para o 1.0

O estudo licencia a claim **estreita**: *"mudar uma feature toca um arquivo em vez de 2–6"*. Ele
**não** licencia a claim forte — *"agentes trabalham melhor com fatias"* — que continua sem medição, e
é a claim que um 1.0 estaria vendendo. Enquanto o estudo forte não existir, o número 1.0 promete mais
do que a evidência sustenta.
