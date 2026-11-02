import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type React from 'react';
import { useState } from 'react';
import {
  createSession,
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  requireAuth,
  type SessionContext
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox)
// ============================================================================
export const DeleteItemInputSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 })
  },
  { additionalProperties: true }
);
export type DeleteItemInput = Static<typeof DeleteItemInputSchema>;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type DeleteItemOutput = Result<
  { id: string; deleted: true },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
>;

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export async function deleteItemAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<DeleteItemOutput> {
  const auth = requireAuth(session, ['admin']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(DeleteItemInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as DeleteItemInput;

  const existing = await db.query<{ id: string }>(`SELECT id FROM inventory WHERE id = $1`, [input.id]);
  if (existing.length === 0) {
    return Err('NOT_FOUND');
  }

  await db.query(`DELETE FROM inventory WHERE id = $1`, [input.id]);

  return Ok({ id: input.id, deleted: true });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface DeleteItemTriggerProps {
  id?: string;
  onSubmitAction?: (payload: unknown) => Promise<DeleteItemOutput>;
}

export function DeleteItemTrigger({ id = '', onSubmitAction }: DeleteItemTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({ id: formData.get('id') });

    setFeedback(result.ok ? 'Registro apagado' : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="deleteItem-id" className="text-xs font-mono text-slate-400">
        ID
      </label>
      <input
        id="deleteItem-id"
        name="id"
        defaultValue={id}
        required
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <button type="submit" className="px-4 py-2 bg-rose-600 rounded text-white text-sm">
        Apagar
      </button>
      {feedback && <p className="text-xs font-mono text-rose-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de remoção de inventory',
  cases: [
    {
      name: 'sem o papel exigido retorna FORBIDDEN',
      run: async () => {
        const result = await deleteItemAction(
          { id: 'x' },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['writer'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(`esperava FORBIDDEN, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'registro inexistente retorna NOT_FOUND e nada é apagado',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => []);

        const result = await deleteItemAction({ id: 'x' }, db, createSession({ userId: 'u1', roles: ['admin'] }));

        if (result.ok || result.error !== 'NOT_FOUND') {
          throw new Error(`esperava NOT_FOUND, obteve ${JSON.stringify(result)}`);
        }
        if (db.calls.some((call) => call.sql.startsWith('DELETE'))) {
          throw new Error('não deveria apagar quando o registro não existe');
        }
      }
    }
  ]
};
