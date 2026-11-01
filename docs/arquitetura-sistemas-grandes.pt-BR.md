# Arquitetura de Sistemas de Grande Escala no SynapseJS

Este guia detalha como estruturar aplicações corporativas e complexas no SynapseJS preservando a **Localidade de Comportamento ($N=1$)**, mantendo a alta velocidade de desenvolvimento por agentes de IA e humanos, sem cair no erro de arquivos gigantes (> 500 linhas) e sem fragmentar o sistema prematuramente em microsserviços.

---

## 1. O Problema: "God Slices" vs. Microsserviços Prematuros

Em sistemas empresariais com dezenas de tabelas e fluxos de negócio interdependentes, dois erros comuns acontecem:

1. **A Fatia Monolítica ("God Slice"):** Tentar colocar um módulo inteiro (ex: todo o faturamento ou toda a fiscalização) dentro de um único arquivo `faturamento.slice.tsx`. O arquivo passa de 1.500 linhas, queima contexto excessivo de LLM e gera atrito de manutenção.
2. **Microsserviços Prematuros:** Quebrar a aplicação em múltiplos repositórios e serviços com gRPC/Kafka. O desenvolvedor troca a simplicidade do monólito por transações distribuídas (Sagas), latência de rede, esquemas dessincronizados e custos de infraestrutura multiplicados.

### A Solução: O Monólito Modular por Fatias de Intenção (Feature-Sliced Monolith)

No SynapseJS, a regra de ouro para escala é:
> **Uma fatia (`*.slice.tsx`) representa uma INTENÇÃO DE NEGÓCIO (Use Case), e NÃO uma tela inteira.**

---

## 2. Estrutura Recomendada de Diretórios por Domínio

```text
src/
├── slices/
│   ├── fiscalizacao/
│   │   ├── _layout.tsx                 # Moldura visual do domínio (Header, tabs, breadcrumbs)
│   │   ├── listar-demandas.slice.tsx   # Consulta, paginação e filtros SSR (< 200 linhas)
│   │   ├── abrir-demanda.slice.tsx     # Formulário de entrada e criação de protocolo (< 250 linhas)
│   │   ├── autuar-infracao.slice.tsx   # Lavratura de auto e cálculo de penalidade (< 220 linhas)
│   │   ├── tramitar.slice.tsx          # Despacho departamental e assinatura digital (< 200 linhas)
│   │   └── _components/                # Componentes visuais auxiliares exclusivos do domínio
│   │       └── status-badge.tsx
│   └── faturamento/
│       ├── _layout.tsx
│       ├── emitir-boleto.slice.tsx
│       └── conciliar-pagamento.slice.tsx
├── shared/
│   ├── fiscalizacao.ts                 # Transações de negócio compartilhadas com db.transaction
│   └── faturamento.ts
└── client/                             # Primitivas de UI globais reutilizáveis
```

> O layout gerado por `synapse new-domain` usa classes utilitárias. Para operar air-gapped, a
> aplicação precisa fornecer o CSS compilado (por exemplo, um build Tailwind local) ou um tema
> equivalente; o framework copia o CSS da aplicação e não injeta um tema próprio.

---

## 3. Composição de Fatias sem Violação de Regras

O SynapseJS impõe em tempo de compilação a regra `SLICE_IMPORTS_SLICE`: **uma fatia nunca deve importar outra fatia diretamente**.

Para compor interfaces complexas (por exemplo, exibir a fatia de tramitação dentro do painel da demanda):

### Uso do `<SubSlice />`

```tsx
import { SubSlice } from 'synapsejs/client';

export function DetalheDemandaView({ demandaId }: { demandaId: string }) {
  return (
    <div className="flex gap-6">
      <main className="flex-1">
        <h1>Demanda #{demandaId}</h1>
      </main>
      <aside className="w-80">
        {/* Renderiza a fatia de tramitação com RPC transparente embutido */}
        <SubSlice 
          domain="fiscalizacao" 
          name="tramitar" 
          props={{ demandaId }} 
        />
      </aside>
    </div>
  );
}
```

O `<SubSlice>` resolve a ação via rota HTTP/RPC em tempo de execução sem criar dependência estática na AST do cliente.

---

## 4. Transações de Banco de Dados Compartilhadas: `src/shared/`

Quando duas fatias precisam participar da **mesma transação atômica** no PostgreSQL (exemplo: `autuar-infracao` precisa debitar a conta e bloquear certidão no mesmo `COMMIT`):

1. Crie o módulo compartilhado com `synapse new-shared <nome>`.
2. A lógica reside em `src/shared/<nome>.ts`:

```typescript
// src/shared/fiscalizacao.ts
import type { DatabaseClient } from 'synapsejs';

export async function aplicarPenalidadeTransacional(
  db: DatabaseClient,
  params: { empresaId: string; valorMulta: number; autoId: string }
) {
  return await db.transaction(async (trx) => {
    // Ambas as operações ocorrem na mesma transação atômica ACID
    await trx.query(
      'INSERT INTO autos_infracao (id, empresa_id, valor) VALUES ($1, $2, $3)',
      [params.autoId, params.empresaId, params.valorMulta]
    );
    await trx.query(
      'UPDATE empresas SET certidao_negativa = FALSE WHERE id = $1',
      [params.empresaId]
    );
  });
}
```

3. Cada fatia importa o `shared` e passa sua conexão de banco (`ctx.db`), tratando os retornos com `Ok` ou `Err`.

---

## 5. Diretrizes de Governança de Tamanho de Código

Para garantir que o código continue veloz e fácil de processar por agentes de IA e humanos:

* **Teto por fatia:** Máximo recomendado de **500 linhas** por arquivo `.slice.tsx`; acima disso o splitter emite `WARN_LARGE_SLICE` (não bloqueante).
* **Identificação de quebra:** Se um arquivo contém mais de 2 mutações de banco não relacionadas, divida em duas fatias.
* **Componentes visuais extensos:** Formulários muito longos com mais de 20 campos devem ter campos agrupados ou sub-componentes colocados em uma pasta local `_components/` dentro do próprio domínio.
* **Consistência de Banco:** Mantenha um **único banco de dados PostgreSQL**. A integridade referencial com chaves estrangeiras entre tabelas de fatias diferentes é garantida e verificada automaticamente pelo comando `synapse db-schema` e `synapse db-drift`.
