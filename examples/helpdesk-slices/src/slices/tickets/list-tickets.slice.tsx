import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const ListTicketsInputSchema = Type.Object({
  status: Type.Optional(Type.Union([Type.Literal('OPEN'), Type.Literal('ASSIGNED'), Type.Literal('CLOSED')]))
});
export type ListTicketsInput = Static<typeof ListTicketsInputSchema>;

// Sem `sliceSchema`: a tabela `tickets` pertence à fatia create-ticket.

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export interface TicketRow {
  id: string;
  subject: string;
  priority: number;
  status: string;
  assignee: string | null;
}

export type ListTicketsOutput = Result<
  { tickets: TicketRow[] },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// ============================================================================
// 3. SERVER ACTION (chamável por RPC, sem banco retorna NO_DATABASE)
// ============================================================================
export async function listTicketsAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<ListTicketsOutput> {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as ListTicketsInput;
  if (!Value.Check(ListTicketsInputSchema, input)) {
    return Err('INVALID_SCHEMA');
  }

  const rows = input.status
    ? await db.query<TicketRow>(
        `SELECT id, subject, priority, status, assignee FROM tickets WHERE status = $1 ORDER BY priority DESC`,
        [input.status]
      )
    : await db.query<TicketRow>(`SELECT id, subject, priority, status, assignee FROM tickets ORDER BY priority DESC`);

  return Ok({ tickets: rows });
}

// ============================================================================
// 4. LOADER: dados reais no SSR, sem prop hardcoded em lugar nenhum
// ============================================================================
export async function ListTicketsLoader(
  context: SliceLoaderContext
): Promise<{ tickets: TicketRow[]; loadError?: string }> {
  const status = context.params.status as ListTicketsInput['status'];

  const result = await listTicketsAction({ status }, context.db, context.session);

  if (!result.ok) {
    return { tickets: [], loadError: result.error };
  }

  return { tickets: result.value.tickets };
}

// ============================================================================
// 5. UI REACT (recebe o que o loader buscou)
// ============================================================================
export interface ListTicketsViewProps {
  tickets?: TicketRow[];
  loadError?: string;
}

export function ListTicketsView({ tickets = [], loadError }: ListTicketsViewProps) {
  if (loadError) {
    return (
      <div className="p-4 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-200 font-mono text-sm">
        Não foi possível listar: {loadError}
      </div>
    );
  }

  if (tickets.length === 0) {
    return <p className="text-slate-400 text-sm">Nenhum chamado registrado ainda.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-mono text-slate-400">
          <th className="pb-2">Assunto</th>
          <th className="pb-2">Prioridade</th>
          <th className="pb-2">Status</th>
          <th className="pb-2">Responsável</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((ticket) => (
          <tr key={ticket.id} className="border-t border-slate-800">
            <td className="py-2 text-slate-200">{ticket.subject}</td>
            <td className="py-2 text-slate-400">{ticket.priority}</td>
            <td className="py-2 text-cyan-400 font-mono text-xs">{ticket.status}</td>
            <td className="py-2 text-slate-400">{ticket.assignee ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de listagem de chamados',
  cases: [
    {
      name: 'sem sessão autenticada retorna UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const result = await listTicketsAction({}, undefined, undefined);

        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(`Invariante violada: esperava UNAUTHORIZED, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'status inválido retorna INVALID_SCHEMA',
      run: async () => {
        const result = await listTicketsAction({ status: 'NOPE' }, new MockDatabaseClient(), {
          isAuthenticated: true,
          roles: ['support']
        });

        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`Invariante violada: esperava INVALID_SCHEMA, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
