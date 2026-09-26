import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  type DatabaseClient,
  Result,
  Ok,
  Err,
  MockDatabaseClient,
  createSession,
  requireAuth,
  type SessionContext
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const AssignTicketInputSchema = Type.Object({
  ticketId: Type.String({ minLength: 10 }),
  assignee: Type.String({ minLength: 3, maxLength: 60 })
});
export type AssignTicketInput = Static<typeof AssignTicketInputSchema>;

// Esta fatia não declara `sliceSchema`: a tabela `tickets` pertence à fatia
// create-ticket. O runner de migrações simplesmente não encontra DDL aqui.

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type AssignTicketOutput = Result<
  { ticketId: string; assignee: string; status: 'ASSIGNED' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TICKET_NOT_FOUND'
>;

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export async function assignTicketAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<AssignTicketOutput> {
  const auth = requireAuth(session, ['support']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(AssignTicketInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as AssignTicketInput;

  const existing = await db.query<{ id: string }>(`SELECT id FROM tickets WHERE id = $1`, [input.ticketId]);
  if (existing.length === 0) {
    return Err('TICKET_NOT_FOUND');
  }

  await db.query(`UPDATE tickets SET assignee = $1, status = $2 WHERE id = $3`, [
    input.assignee,
    'ASSIGNED',
    input.ticketId
  ]);

  return Ok({ ticketId: input.ticketId, assignee: input.assignee, status: 'ASSIGNED' });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export function AssignTicketTrigger({ onSubmitAction }: { onSubmitAction?: (payload: unknown) => Promise<AssignTicketOutput> }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({
      ticketId: formData.get('ticketId') as string,
      assignee: formData.get('assignee') as string
    });

    setFeedback(result.ok ? `Atribuído a ${result.value.assignee}` : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input name="ticketId" placeholder="ID do chamado" required minLength={10} />
      <input name="assignee" placeholder="Responsável" required minLength={3} />
      <button type="submit">Atribuir</button>
      {feedback && <p>{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de atribuição de chamado',
  cases: [
    {
      name: 'chamado inexistente retorna TICKET_NOT_FOUND',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM tickets/, () => []);

        const result = await assignTicketAction(
          { ticketId: 'ticket-inexistente-1', assignee: 'Ana' },
          db,
          createSession({ userId: 'pbt', roles: ['support'] })
        );

        if (result.ok || result.error !== 'TICKET_NOT_FOUND') {
          throw new Error(`Invariante violada: esperava TICKET_NOT_FOUND, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'chamado existente é atribuído',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM tickets/, () => [{ id: 'ticket-1' }]);

        const result = await assignTicketAction(
          { ticketId: 'ticket-000000001', assignee: 'Ana' },
          db,
          createSession({ userId: 'pbt', roles: ['support'] })
        );

        if (!result.ok || result.value.status !== 'ASSIGNED') {
          throw new Error(`Invariante violada: esperava ASSIGNED, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'sem sessão retorna UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const db = new MockDatabaseClient();
        const result = await assignTicketAction({ ticketId: 'ticket-000000001', assignee: 'Ana' }, db);

        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(`Invariante violada: esperava UNAUTHORIZED, obteve ${JSON.stringify(result)}`);
        }
        if (db.calls.length !== 0) {
          throw new Error('Invariante violada: a autorização deveria acontecer antes de qualquer query');
        }
      }
    }
  ]
};
