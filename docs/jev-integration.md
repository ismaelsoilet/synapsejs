# 🧠 SynapseJS + Jev System One: Guia de Arquitetura & Integração

## 1. Visão Geral

O **SynapseJS** e o **Jev-Harness** operam juntos no modelo cognitivo de duas camadas para agentes autônomos de software:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT / CODING LLM                              │
└───────────────────▲────────────────────────────────▲───────────────────┘
                    │                                │
       [Decisões Reflexas & Gating]        [Execução & Locality N=1]
                    │                                │
┌───────────────────┴────────────────┐  ┌────────────┴───────────────────┐
│        JEV-HARNESS                 │  │          SYNAPSEJS             │
│        (Sistema 1 Cognitivo)       │  │          (Sistema 2 Estrutural)│
├────────────────────────────────────┤  ├────────────────────────────────┤
│ • Decisões semânticas em 70-300ms  │  │ • Locality of Behavior (N = 1) │
│ • Heurísticas locais (< 500µs)     │  │ • Fatias verticais (*.slice.tsx│
│ • Triagem de testes (test-gate)    │  │ • Oráculos PBT com fast-check  │
│ • Aborto de loops (abort-check)    │  │ • AST Splitter (zero data-leak)│
│ • Modulação de raciocínio Astra-Jev│  │ • MCP Server Nativo (15 tools) │
│ • Roteamento de tiers de modelo    │  │ • Migrações DDL por fatia & PBT│
└────────────────────────────────────┘  └────────────────────────────────┘
```

- **Sistema 2 (SynapseJS):** Provê estrutura isolada onde cada funcionalidade reside em um único arquivo contíguo (`*.slice.tsx`), com compilação livre de vazamentos (`AST Splitter`), oráculos de Property-Based Testing (`fast-check`) e catálogo de schema centralizado.
- **Sistema 1 (Jev-Harness):** Provê o reflexo semântico ultra-rápido (70ms a 300ms ou < 500µs em modo offline) que protege o agente contra gasto inútil de tokens em erros mecânicos de ambiente, loops de refatoração destrutivos e raciocínio pesado desnecessário.

---

## 2. Comandos CLI & Portão de Teste

### Triagem de Testes com `synapse test --gate`

Ao rodar os oráculos de teste das fatias, a flag `--gate` (ou a presença de `.jev.json` no projeto) ativa automaticamente a triagem semântica:

```bash
# Executa os oráculos com triagem Jev System One
bun run synapse test --gate
```

Quando um oráculo falha, o JSON de diagnóstico do SynapseJS retorna enriquecido com a análise semântica:

```json
{
  "operation": "PBT_ORACLE_TEST_SUITE",
  "status": "FAIL",
  "totalSlices": 4,
  "passedSlices": 3,
  "triage": {
    "category": "env_missing",
    "confidence": 1.0,
    "skipLlm": true,
    "skipLlmProb": 0.86,
    "severityScore": 0.73,
    "actionRecommendation": "AUTO-ACTION: Install missing dependency or check environment configuration (Do NOT call LLM).",
    "isMock": false
  }
}
```

Se `skipLlm = true`, o agente é instruído a resolver o problema deterministicamente sem acionar dezenas de milhares de tokens da LLM.

---

## 3. Ferramentas MCP do Jev no SynapseJS

O servidor nativo Model Context Protocol do SynapseJS (`synapse mcp`) disponibiliza 15 ferramentas nativas, incluindo 4 ferramentas semânticas exclusivas do Jev:

| Ferramenta MCP | Descrição | Parâmetros |
|---|---|---|
| `synapse_test_gate` | Roda os oráculos PBT e tria falhas imediatamente com Jev System One | `{ forceRemote?: boolean }` |
| `synapse_abort_check` | Detecta loops de refatoração e trajetórias condenadas | `{ plan: string, history: string }` |
| `synapse_verify_completion` | Valida se a fatia cumpre os critérios de aceitação com evidências | `{ criteria: string, output: string }` |
| `synapse_reasoning_effort` | Modula dinamicamente o esforço de raciocínio (Astra-Jev) para economizar tempo e tokens | `{ context: string, provider?: string, sessionContextTokens?: number }` |

### Exemplo de Modulação de Raciocínio (Astra-Jev)

Antes de executar operações mecânicas (`synapse split`, `synapse migrate`, `synapse skeleton`), o agente pode consultar `synapse_reasoning_effort`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "synapse_reasoning_effort",
    "arguments": { "context": "synapse split" }
  }
}
```

**Resposta:**
```json
{
  "effort": "low",
  "confidence": 0.85,
  "cacheSafeRecommendation": "Low reasoning effort saves ~7,000 reasoning tokens. Safe to use for mechanical tool calls."
}
```

Isso reduz o tempo de resposta em modelos de raciocínio profundo de ~200s para ~1.5s em passos mecânicos.

---

## 4. Configuração de Provedores

O Jev-Harness suporta múltiplos provedores através de `.jev.json`, variáveis de ambiente ou heurísticas locais:

### 1. OpenCode Zen (Free Tier)
```bash
export JEV_PROVIDER="opencode"
```

### 2. Arquivo Local `.jev.json`
```json
{
  "provider": "opencode",
  "model": "jev-1.13-free",
  "skip_llm_threshold": 0.65,
  "abort_threshold": 0.70
}
```

### 3. Modo Simulação Autônoma (Zero-Config / Offline)
Caso nenhuma credencial esteja configurada ou não haja conexão de rede, o Jev opera instantaneamente via **heurísticas locais determinísticas** (< 500µs), garantindo que seus builds, testes e CI nunca quebrem ou fiquem bloqueados.
