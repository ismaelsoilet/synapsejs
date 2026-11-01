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
  type SessionContext
} from 'synapsejs';
import { DataForm, type FormField, Card } from 'synapsejs/client';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const CreateItemInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  sku: Type.String({ minLength: 1, maxLength: 255 }),
  category: Type.String({ minLength: 1, maxLength: 255 }),
  price: Type.Number(),
  stock: Type.Number(),
  status: Type.Union([Type.Literal('active'), Type.Literal('low_stock'), Type.Literal('archived')])
}, { additionalProperties: true });
export type CreateItemInput = Static<typeof CreateItemInputSchema>;

// DDL Schema Declarativo da Fatia (Auto-Migrado pelo Synapse)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    stock REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- down:
  DROP TABLE IF EXISTS inventory;
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type CreateItemOutput = Result<
  { id: string } & CreateItemInput,
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'PERSISTENCE_FAILED'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (Server Action)
// ============================================================================
export async function createItemAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<CreateItemOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(CreateItemInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as CreateItemInput;

  const generatedId = crypto.randomUUID();

  try {
    const inserted = await db.insert<{ id: string } & CreateItemInput>('inventory', {
      id: generatedId,
      ...input
    });
    return Ok(inserted);
  } catch (_err) {
    return Err('PERSISTENCE_FAILED');
  }
}

// ============================================================================
// 4. VISUALIZAÇÃO INTERATIVA DA UI (React)
// ============================================================================
export interface CreateItemTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateItemOutput>;
}

const FORM_FIELDS: FormField[] = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'sku', label: 'Sku', type: 'text', required: true },
  { name: 'category', label: 'Category', type: 'text', required: true },
  { name: 'price', label: 'Price', type: 'number', required: true },
  { name: 'stock', label: 'Stock', type: 'number', required: true },
  { name: 'status', label: 'Status', type: 'select', required: true, options: [{ label: 'active', value: 'active' }, { label: 'low_stock', value: 'low_stock' }, { label: 'archived', value: 'archived' }] }
];

export function CreateItemTrigger({ onSubmitAction }: CreateItemTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (formData: Record<string, unknown>) => {
    if (!onSubmitAction) return;
    const res = await onSubmitAction(formData);
    if (res.ok) {
      setFeedback('Registro criado com sucesso! ID: ' + res.value.id);
    } else {
      setFeedback('Erro: ' + res.error);
    }
  };

  return (
    <Card title="CreateItem" subtitle="Gerenciado por SynapseJS">
      <DataForm
        fields={FORM_FIELDS}
        onSubmit={handleSubmit}
        submitLabel="Salvar CreateItem"
      />
      {feedback && (
        <div className="mt-4 p-3 rounded font-mono text-xs bg-slate-800 text-slate-300">
          {feedback}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT (Property-Based Testing)
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de create-item',
  cases: [
    {
      name: 'payload inválido retorna INVALID_SCHEMA',
      run: async () => {
        const result = await createItemAction({ invalidField: 123 }, new MockDatabaseClient());
        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error('esperava INVALID_SCHEMA');
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await createItemAction({});
        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error('esperava NO_DATABASE');
        }
      }
    }
  ]
};
