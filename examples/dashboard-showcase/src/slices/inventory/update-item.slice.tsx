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
// 1. CONTRATO DE ENTRADA (TypeBox) — todos os campos editáveis são opcionais
// ============================================================================
export const UpdateItemInputSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    price: Type.Optional(Type.Number({ minimum: 0 })),
    stock: Type.Optional(Type.Number({ minimum: 0 })),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('low_stock'), Type.Literal('archived')]))
  },
  { additionalProperties: true }
);
export type UpdateItemInput = Static<typeof UpdateItemInputSchema>;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type UpdateItemOutput = Result<
  { id: string; updated: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOTHING_TO_UPDATE' | 'NOT_FOUND'
>;

/**
 * Allowlist de campos editáveis: o nome da coluna NUNCA vem do payload, então o
 * SQL é montado só com o que está aqui. É o que separa update parcial de injeção.
 */
const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  price: 'price',
  stock: 'stock',
  status: 'status'
};

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export async function updateItemAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<UpdateItemOutput> {
  const auth = requireAuth(session, ['writer']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(UpdateItemInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as UpdateItemInput;

  const existing = await db.query<{ id: string }>(`SELECT id FROM inventory WHERE id = $1`, [input.id]);
  if (existing.length === 0) {
    return Err('NOT_FOUND');
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = (input as Record<string, unknown>)[field];
    if (value === undefined) {
      continue;
    }
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }

  if (assignments.length === 0) {
    return Err('NOTHING_TO_UPDATE');
  }

  params.push(input.id);
  await db.query(`UPDATE inventory SET ${assignments.join(', ')} WHERE id = $${params.length}`, params);

  return Ok({ id: input.id, updated: assignments.length });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface UpdateItemTriggerProps {
  id?: string;
  onSubmitAction?: (payload: unknown) => Promise<UpdateItemOutput>;
}

export function UpdateItemTrigger({ id = '', onSubmitAction }: UpdateItemTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { id: formData.get('id') };
    const name = formData.get('name');
    if (typeof name === 'string' && name.length > 0) {
      payload.name = name;
    }

    const result = await onSubmitAction(payload);
    setFeedback(result.ok ? `Atualizado (${result.value.updated} campo(s))` : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="updateItem-id" className="text-xs font-mono text-slate-400">
        ID
      </label>
      <input
        id="updateItem-id"
        name="id"
        defaultValue={id}
        required
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="updateItem-name" className="text-xs font-mono text-slate-400">
        Nome (vazio = não altera)
      </label>
      <input
        id="updateItem-name"
        name="name"
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <button type="submit" className="px-4 py-2 bg-cyan-600 rounded text-white text-sm">
        Salvar
      </button>
      {feedback && <p className="text-xs font-mono text-cyan-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de atualização parcial de inventory',
  cases: [
    {
      name: 'sem o papel exigido retorna FORBIDDEN',
      run: async () => {
        const result = await updateItemAction(
          { id: 'x', name: 'Novo' },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['viewer'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(`esperava FORBIDDEN, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'payload sem nenhum campo editável retorna NOTHING_TO_UPDATE',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => [{ id: 'x' }]);

        const result = await updateItemAction({ id: 'x' }, db, createSession({ userId: 'u1', roles: ['writer'] }));

        if (result.ok || result.error !== 'NOTHING_TO_UPDATE') {
          throw new Error(`esperava NOTHING_TO_UPDATE, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'registro inexistente retorna NOT_FOUND',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => []);

        const result = await updateItemAction(
          { id: 'x', name: 'Novo' },
          db,
          createSession({ userId: 'u1', roles: ['writer'] })
        );

        if (result.ok || result.error !== 'NOT_FOUND') {
          throw new Error(`esperava NOT_FOUND, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'só as colunas da allowlist aparecem no UPDATE',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM/, () => [{ id: 'x' }]);

        await updateItemAction(
          { id: 'x', name: 'Novo', evil: 'name = 1 --' },
          db,
          createSession({ userId: 'u1', roles: ['writer'] })
        );

        const update = db.calls.find((call) => call.sql.startsWith('UPDATE'));
        if (!update || update.sql.includes('evil') || update.sql.includes('--')) {
          throw new Error(`a allowlist vazou: ${update?.sql ?? 'nenhum UPDATE'}`);
        }
        if (!update.sql.includes('name = $1')) {
          throw new Error(`UPDATE inesperado: ${update.sql}`);
        }
      }
    }
  ]
};
