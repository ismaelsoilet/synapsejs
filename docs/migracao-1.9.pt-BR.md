# Migrando de 1.8 para 1.9

A 1.9 é uma **release de endurecimento de segurança**. O framework funciona igual para um deploy
correto; o que mudou é que quatro comportamentos que eram inseguros *por padrão* agora são recusados
até você pedir por eles explicitamente. Uma aplicação na 1.8 continua rodando depois do upgrade
assim que a configuração abaixo estiver no lugar.

Nada no contrato da fatia mudou: o mesmo arquivo `*.slice.tsx`, os mesmos exports, as mesmas actions
`Result<T, E>`. Se a sua app nunca dependeu dos defaults inseguros, não há nada a fazer.

---

## Antes de subir

```bash
bun install                                   # resolve a 1.9
bun run check                                 # tipos
bun run synapse test                          # os oráculos das suas fatias
```

Depois percorra as quatro mudanças que quebram. Cada uma diz o sintoma que você veria, por que mudou
e exatamente qual flag ou chamada restaura o comportamento antigo *onde restaurar é seguro*.

---

## 1. `synapse start` recusa rodar em produção sem segredo de sessão

**Sintoma:** o processo sai com status 1 e imprime
`{"status":"FAIL","code":"MISSING_SESSION_SECRET", ...}`.

**Por quê:** sem `SYNAPSE_SESSION_SECRET` todo header de identidade (`x-user-id`, `x-user-roles`) é
controlado pelo atacante, e um servidor de produção que confia neles é um bypass de autenticação
esperando ser encontrado. O comportamento anterior — avisar e subir mesmo assim — é o que esta
release remove.

**Correção (recomendada):**

```bash
SYNAPSE_SESSION_SECRET="$(openssl rand -base64 48)" bun run start
```

Sua fatia de login assina a sessão com `signSessionToken(claims, secret)`; o servidor agora verifica e
tira **o tenant exclusivamente das claims verificadas** (um token assinado sem claim de tenant produz
sessão sem tenant — o header `x-tenant-id` e o subdomínio passam a ser ignorados sempre que houver
segredo configurado).

**Correção (risco assumido):**

```bash
bun run start --acknowledge-insecure          # ou SYNAPSE_ACKNOWLEDGE_INSECURE=true
```

O servidor sobe, avisa no log, e toda requisição resolve para anônimo.

**Desenvolvimento não muda:** `synapse dev` continua funcionando como antes.

---

## 2. Headers de identidade exigem opt-in explícito de desenvolvimento

**Sintoma:** localmente, `x-user-id` / `x-user-roles` (e o cookie `synapse_roles`) param de produzir
sessão; as páginas renderizam como anônimo.

**Por quê:** "sem segredo configurado" não significa mais "confie nos headers". Só o opt-in explícito
significa — assim um valor não definido, `staging` ou um erro de digitação não concede identidade
silenciosamente.

**Correção:**

```bash
SYNAPSE_DEV_HEADERS=true bun run dev
```

`NODE_ENV=development` (ou `test`) também vale como opt-in. Se preferir, assine um token de verdade no
desenvolvimento — o template de login (`synapse new-slice auth login --template=login`) já faz isso.

---

## 3. Server-sent events exigem tópico declarado

**Sintoma:** `GET /_synapse/sse/<topico>` responde `404 TOPIC_NOT_FOUND`, `401 UNAUTHENTICATED` ou
`403 TOPIC_FORBIDDEN`.

**Por quê:** o gateway aceitava qualquer nome de tópico de qualquer chamador, então qualquer cliente
lia qualquer broadcast que soubesse soletrar. O acesso agora é declarado, e tópicos são separados por
tenant — dois tenants com o mesmo nome nunca veem os eventos um do outro.

**Correção:** declare o tópico na fatia que é dona dele.

```ts
import { defineTopic } from 'synapsejs';

export const ticketsTopic = defineTopic({
  name: 'tickets',
  owner: 'tickets/view-tickets',   // a fatia autorizada a publicar nele
  readRoles: ['support'],          // papéis que podem assinar; omita para "qualquer sessão"
  // public: true,                 // só para um tópico deliberadamente anônimo
  // tenantId: 'acme',             // só para um tópico que existe em um tenant
});
```

`ctx.broadcast('tickets', data)` notifica zero inscritos se quem chama não for o `owner` declarado. O
registro e as assinaturas concorrentes são limitados por `config.realtime` (`maxTopics`,
`maxSubscriptions`, `maxConnectionsPerClient`; 1000/1000/8 por padrão) e a recusa é
`429 REALTIME_LIMIT_EXCEEDED` com `Retry-After`.

---

## 4. O upgrade de WebSocket é recusado sem allow-list de origem

**Sintoma:** `GET /_synapse/ws/<dominio>/<nome>` responde `403 ORIGIN_NOT_ALLOWED`.

**Por quê:** `SYNAPSE_ALLOWED_ORIGINS` não definido significava "libera qualquer origem", e a ausência
do header `Origin` pulava a checagem — um sequestro cross-site de WebSocket sem autenticação alguma.

**Correção:**

```bash
SYNAPSE_ALLOWED_ORIGINS=https://app.exemplo.com,https://admin.exemplo.com
```

`*` libera todas as origens (não recomendado). Origem ausente ou opaca (`null`) é sempre recusada. Uma
**origem loopback** (`http://localhost:*`, `http://127.0.0.1:*`) continua liberada, então o
desenvolvimento local não precisa de configuração.

---

## 5. Cookies escritos por `ctx.setCookie` são seguros por padrão

**Sintoma:** um cookie escrito pela sua action não é mais legível por JavaScript e não vai em
navegações cross-site.

**Por quê:** os atributos seguros eram opt-in, então a própria documentação do framework mostrava o
ponto de chamada inseguro. Agora `HttpOnly`, `Secure` e `SameSite=Lax` são o padrão.

**Correção:** declare o atributo explicitamente se você realmente precisar.

```ts
ctx.setCookie('theme', 'dark', { httpOnly: false, secure: false });
```

Vale lembrar que um cookie escrito por **script no browser** (`storeSession`) nunca pode ser
`HttpOnly` — `document.cookie` não permite. Uma sessão que precisa ser inalcançável por script é a que
o servidor emite via `ctx.setCookie`.

---

## 6. CDN de terceiros é opt-in e a política de segurança é estrita

**Sintoma:** páginas renderizam sem Tailwind e sem Google Fonts.

**Por quê:** toda página executava um compilador de terceiros em runtime, sem hash de integridade, numa
origem que guarda um cookie de sessão legível por script — e nenhuma CSP era emitida.

**Correção (qualquer uma das duas):**

```bash
# A) sirva seu próprio CSS — ele sempre ganha da origem de terceiros
public/synapse.css

# B) faça opt-in, fixando o hash de integridade de cada origem
SYNAPSE_ENABLE_CDN=true \
SYNAPSE_CDN_INTEGRITY="sha384-..." \
SYNAPSE_FONTS_INTEGRITY="sha384-..." \
bun run start
```

Sem hash de integridade a tag não é emitida — script de terceiros sem pin é exatamente o risco que o
switch existe para bloquear. Para emitir sua própria política em vez da embutida, defina `SYNAPSE_CSP`
(ou `config.contentSecurityPolicy`); o framework nunca enfraquece uma política que você fornece.

---

## O que muda sem quebrar

Isto já vem ligado e não exige ação, mas explica comportamentos que você pode notar:

| Comportamento | Detalhe |
|---|---|
| Headers de segurança em tudo | toda resposta — inclusive 404, arquivos estáticos e páginas de erro — carrega `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` e CSP; HSTS só sobre TLS |
| Teto de corpo no processo | 12 MiB por padrão (`SYNAPSE_MAX_REQUEST_BODY_BYTES`), atrás dos limites por rota (RPC 5 MB, webhook 10 MB, upload 5 MB) |
| Upload confere os bytes | a extensão declarada precisa bater com o conteúdo; política padrão png/jpg/jpeg/gif/webp/pdf/txt/csv/json/md (`SYNAPSE_UPLOAD_ALLOWED_TYPES`), recusa `415 UNSUPPORTED_FILE_TYPE` |
| Rate limit cobre tudo | inclusive `/_synapse/api/*`, o otimizador de imagem e as páginas renderizadas; recusa `429` com `Retry-After` |
| Confiança em proxy é opt-in | `SYNAPSE_TRUST_PROXY=true` (ou `config.trustProxy`); caso contrário a identidade é o endereço do peer |
| Revogação consultada por requisição | token revogado via `revokeSessionTokenInDb` para de autenticar em todo lugar, com memo de `SYNAPSE_REVOCATION_MEMO_TTL_MS` (30 s) |
| Tenant só de claims verificadas | quando há segredo configurado; fontes não verificadas são ignoradas |
| Health mínimo quando anônimo | status, veredito do banco, contagem de fatias e versão; tabela de rotas, caminhos e erro exigem sessão |
| Shutdown drena | o `drainTimeoutMs` configurado é honrado, o que sobra recebe `503 DRAINING`, a persistência fecha depois, e `stop()` é idempotente |
| Erros mascarados em produção | falhas de RPC, webhook, upload e imagem retornam `INTERNAL_ERROR` com correlation id; o texto da exceção vai só para o log |
| `synapse impact` falha em alvo inexistente | `TARGET_NOT_RESOLVED` com exit não-zero, em vez de sucesso vazio |
| Flags e comandos desconhecidos são recusados | `UNKNOWN_FLAG` / `UNKNOWN_COMMAND` no stdout com exit não-zero, em todo comando |

---

## Referência de configuração nova

| Variável / config | Padrão | Para que serve |
|---|---|---|
| `SYNAPSE_SESSION_SECRET` | — | obrigatório em produção; assina e verifica sessões |
| `SYNAPSE_ACKNOWLEDGE_INSECURE` / `--acknowledge-insecure` | false | sobe produção sem segredo, com registro |
| `SYNAPSE_DEV_HEADERS` | false | confia em headers de identidade **só** em desenvolvimento |
| `SYNAPSE_ALLOWED_ORIGINS` | — | allow-list do upgrade de WebSocket (loopback sempre liberado) |
| `SYNAPSE_ENABLE_CDN` + `SYNAPSE_CDN_INTEGRITY` / `SYNAPSE_FONTS_INTEGRITY` | off | CDN e fontes de terceiros, fixados por SRI |
| `SYNAPSE_CSP` / `config.contentSecurityPolicy` | política estrita embutida | sua própria política, emitida como está |
| `SYNAPSE_MAX_REQUEST_BODY_BYTES` / `config.maxRequestBodyBytes` | 12 MiB | teto de corpo no processo |
| `SYNAPSE_UPLOAD_ALLOWED_TYPES` | png, jpg, jpeg, gif, webp, pdf, txt, csv, json, md | política de upload aceita |
| `SYNAPSE_TRUST_PROXY` / `config.trustProxy` | false | honra `x-forwarded-for` / `cf-connecting-ip` |
| `config.rateLimit` | 150 burst / 100 rps / 10k identidades | rate limiting, por processo |
| `config.realtime` | 1000 tópicos / 1000 assinaturas / 8 por cliente | limites de tempo real |
| `SYNAPSE_REVOCATION_MEMO_TTL_MS`, `SYNAPSE_REVOCATION_TTL_MS`, `SYNAPSE_REVOCATION_MAX_ENTRIES` | 30 s / 7 d / 10 000 | cache e limites de revogação |

O resto do contrato da fatia — `db` opcional, `requireAuth`, `MockDatabaseClient`, `defineJob`,
`defineCache`, `defineSocket`, `sliceTests` — está inalterado.

## Verificando o upgrade

```bash
bun run check                     # tipos
bun run synapse test              # oráculos por invariante
bun run synapse split             # gates de compilação e zero vazamento
bun run synapse coverage          # todo item opcional do contrato exercitado
curl -s localhost:3000/_synapse/api/health   # status, banco, slicesLoaded
```

Se algo se comportar mal, os corpos de recusa são legíveis por máquina — `MISSING_SESSION_SECRET`,
`UNAUTHENTICATED`, `TOPIC_NOT_FOUND`, `TOPIC_FORBIDDEN`, `REALTIME_LIMIT_EXCEEDED`,
`ORIGIN_NOT_ALLOWED`, `UNSUPPORTED_FILE_TYPE`, `TARGET_NOT_RESOLVED`, `UNKNOWN_FLAG` — e
`bun run synapse contract` imprime o contrato de autoria completo, incluindo os códigos de recusa de
tempo real e seus status.
