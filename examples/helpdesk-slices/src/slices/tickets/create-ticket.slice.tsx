import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
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
export const TicketInputSchema = Type.Object({
  subject: Type.String({ minLength: 3, maxLength: 120 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  requesterEmail: Type.String({ format: 'email' })
});
export type TicketInput = Static<typeof TicketInputSchema>;

// DDL declarativo da fatia (auto-migrado via AST)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL,
    requester_email TEXT NOT NULL,
    assignee TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type TicketOutput = Result<
  { ticketId: string; status: 'OPEN' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN'
>;

// ============================================================================
// 3. SERVER ACTION (`db` opcional: o mesmo ponto de chamada vale nos dois lados)
// ============================================================================
export async function createTicketAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<TicketOutput> {
  const auth = requireAuth(session, ['support']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(TicketInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as TicketInput;
  const ticketId = crypto.randomUUID();

  await db.query(
    `INSERT INTO tickets (id, subject, priority, requester_email, status) VALUES ($1, $2, $3, $4, $5)`,
    [ticketId, input.subject, input.priority, input.requesterEmail, 'OPEN']
  );

  return Ok({ ticketId, status: 'OPEN' });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export function CreateTicketTrigger({ onSubmitAction }: { onSubmitAction?: (payload: unknown) => Promise<TicketOutput> }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({
      subject: formData.get('subject') as string,
      priority: Number(formData.get('priority')),
      requesterEmail: formData.get('requesterEmail') as string
    });

    setFeedback(result.ok ? `Chamado aberto: ${result.value.ticketId}` : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input name="subject" placeholder="Assunto" required minLength={3} />
      <input name="priority" type="number" min={1} max={5} defaultValue={3} required />
      <input name="requesterEmail" type="email" placeholder="solicitante@empresa.com" required />
      <button type="submit">Abrir chamado</button>
      {feedback && <p>{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES (executado por `synapse test` sob bun:test)
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de abertura de chamado',
  cases: [
    {
      name: 'assunto curto ou prioridade fora da faixa retornam INVALID_SCHEMA',
      run: async () => {
        const session = createSession({ userId: 'pbt', roles: ['support'] });

        fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 2 }),
            fc.integer({ min: 6, max: 99 }),
            async (shortSubject, invalidPriority) => {
              const result = await createTicketAction(
                { subject: shortSubject, priority: invalidPriority, requesterEmail: 'a@b.com' },
                new MockDatabaseClient(),
                session
              );
              return result.ok === false && result.error === 'INVALID_SCHEMA';
            }
          )
        );
      }
    },
    {
      name: 'chamado válido abre com status OPEN',
      run: async () => {
        const session = createSession({ userId: 'pbt', roles: ['support'] });
        const result = await createTicketAction(
          { subject: 'Impressora não imprime', priority: 2, requesterEmail: 'a@b.com' },
          new MockDatabaseClient(),
          session
        );

        if (!result.ok || result.value.status !== 'OPEN') {
          throw new Error(`Invariante violada: esperava OPEN, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'sem o papel support retorna FORBIDDEN',
      run: async () => {
        const result = await createTicketAction(
          { subject: 'Impressora não imprime', priority: 2, requesterEmail: 'a@b.com' },
          new MockDatabaseClient(),
          createSession({ userId: 'pbt', roles: ['viewer'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(`Invariante violada: esperava FORBIDDEN, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await createTicketAction(
          { subject: 'Impressora não imprime', priority: 2, requesterEmail: 'a@b.com' },
          undefined,
          createSession({ userId: 'pbt', roles: ['support'] })
        );

        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error(`Invariante violada: esperava NO_DATABASE, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
