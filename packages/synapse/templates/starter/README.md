# SynapseJS Starter App ⚡

Aplicação construída com **SynapseJS** — framework fullstack para Bun onde uma feature inteira
(contrato, DDL, server action, UI e oráculo) vive num único arquivo `*.slice.tsx`.

Requisito: **Bun >= 1.2**.

## Comandos rápidos

```bash
# 1. Iniciar servidor com SSR e auto-migração
bun run dev

# 2. Criar uma nova fatia vertical com 1 comando
bun run new-slice <domain> <name>
# Exemplo: bun run new-slice users register-user

# 3. Rodar os oráculos da fatia
bun run test

# 4. Checar tipos
bun run check

# 5. Iniciar servidor MCP local (JSON-RPC sobre stdio)
bun run mcp

# 6. Particionar as fatias em shared/server/client e rodar os dois gates
bun run split
```

## RBAC no browser

As Server Actions recebem `SessionContext`. Para exercitar uma action protegida a partir da UI,
defina os cookies que o shell SSR repassa como headers:

```js
document.cookie = 'synapse_token=demo; synapse_roles=support';
```

Sem credencial a action responde `Err('UNAUTHORIZED')` — o RBAC é aplicado de verdade, não decorativo.
