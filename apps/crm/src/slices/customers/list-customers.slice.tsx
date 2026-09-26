// biome-ignore lint/correctness/noUnusedImports: falso positivo do Biome 2.5.14 — `Static` e usado em tipo e o typecheck prova (`Cannot find name 'Static'` ao remover)
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import React, { useState } from 'react';
import {
  createSession,
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox)
// ============================================================================
export const ListCustomersInputSchema = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 60 })),
  segment: Type.Optional(Type.Union([Type.Literal('RETAIL'), Type.Literal('CORPORATE')]))
});
export type ListCustomersInput = Static<typeof ListCustomersInputSchema>;

// A tabela pertence à fatia create-customer.

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  segment: string;
  createdAt: string;
}

export type ListCustomersOutput = Result<
  { customers: CustomerRow[] },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED'
>;

// ============================================================================
// 3. SERVER ACTION — busca parametrizada, nunca concatenada
// ============================================================================
export async function listCustomersAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<ListCustomersOutput> {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as ListCustomersInput;
  if (!Value.Check(ListCustomersInputSchema, input)) {
    return Err('INVALID_SCHEMA');
  }

  const rows = await db.query<{ id: string; name: string; email: string; segment: string; created_at: string }>(
    `SELECT id, name, email, segment, created_at FROM customers
     WHERE ($1 = '' OR name LIKE '%' || $1 || '%' OR email LIKE '%' || $1 || '%')
       AND ($2 = '' OR segment = $2)
     ORDER BY created_at DESC
     LIMIT 50`,
    [input.query ?? '', input.segment ?? '']
  );

  return Ok({
    customers: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      segment: row.segment,
      createdAt: row.created_at
    }))
  });
}

// ============================================================================
// 4. LOADER — dados reais no SSR (o que a primeira tela de um CRM precisa)
// ============================================================================
export async function ListCustomersLoader(
  context: SliceLoaderContext
): Promise<{ customers: CustomerRow[]; loadError?: string; query?: string }> {
  const query = (context.params.query ?? '').slice(0, 60);
  const segment = context.params.segment as ListCustomersInput['segment'];

  const result = await listCustomersAction({ query, segment }, context.db, context.session);

  if (!result.ok) {
    return { customers: [], loadError: result.error, query };
  }

  return { customers: result.value.customers, query };
}

// ============================================================================
// 5. UI REACT
// ============================================================================
export interface ListCustomersViewProps {
  customers?: CustomerRow[];
  loadError?: string;
  query?: string;
}

export function ListCustomersView({ customers = [], loadError, query = '' }: ListCustomersViewProps) {
  const [term, setTerm] = useState(query);

  if (loadError) {
    return (
      <div className="p-4 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 font-mono text-sm">
        Não foi possível listar clientes: {loadError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form method="GET" className="flex gap-2">
        <label htmlFor="customer-search" className="sr-only">
          Buscar cliente
        </label>
        <input
          id="customer-search"
          name="query"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar por nome ou e-mail"
          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm transition-colors"
        >
          Buscar
        </button>
      </form>

      {customers.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum cliente encontrado.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-mono text-slate-400">
              <th className="pb-2">Nome</th>
              <th className="pb-2">E-mail</th>
              <th className="pb-2">Segmento</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-t border-slate-800">
                <td className="py-2 text-slate-200">{customer.name}</td>
                <td className="py-2 text-slate-400">{customer.email}</td>
                <td className="py-2 text-cyan-400 font-mono text-xs">{customer.segment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de listagem de clientes',
  cases: [
    {
      name: 'sem sessão retorna UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const db = new MockDatabaseClient();
        const result = await listCustomersAction({}, db);

        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(`Invariante violada: esperava UNAUTHORIZED, obteve ${JSON.stringify(result)}`);
        }
        if (db.calls.length !== 0) {
          throw new Error('Invariante violada: autorização deveria acontecer antes de qualquer query');
        }
      }
    },
    {
      name: 'termo de busca acima de 60 caracteres retorna INVALID_SCHEMA',
      run: async () => {
        const result = await listCustomersAction(
          { query: 'x'.repeat(61) },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['sales'] })
        );

        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`Invariante violada: esperava INVALID_SCHEMA, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'busca é parametrizada: entrada do usuário nunca entra no texto do SQL',
      run: async () => {
        const injection = "'; DROP TABLE customers; --";
        const db = new MockDatabaseClient().onQuery(/SELECT id, name, email, segment/, () => []);

        await listCustomersAction({ query: injection }, db, createSession({ userId: 'u1', roles: ['sales'] }));

        const statement = db.calls.find((call) => call.sql.includes('SELECT id, name, email, segment'));

        if (!statement) {
          throw new Error('Invariante violada: nenhuma consulta foi feita');
        }
        if (statement.sql.includes('DROP TABLE')) {
          throw new Error('Invariante violada: a entrada do usuário entrou no texto do SQL');
        }
        if (!statement.sql.includes('$1')) {
          throw new Error('Invariante violada: a consulta não usa placeholder');
        }
        if (statement.params[0] !== injection) {
          throw new Error(
            `Invariante violada: o termo deveria viajar como parâmetro, veio ${String(statement.params[0])}`
          );
        }
      }
    },
    {
      name: 'listagem vazia é sucesso, não erro',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id, name, email, segment/, () => []);

        const result = await listCustomersAction({}, db, createSession({ userId: 'u1', roles: ['sales'] }));

        if (!result.ok || result.value.customers.length !== 0) {
          throw new Error(`Invariante violada: esperava lista vazia com Ok, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
