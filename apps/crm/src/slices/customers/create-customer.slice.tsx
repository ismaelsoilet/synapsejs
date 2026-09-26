import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
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
export const CustomerInputSchema = Type.Object({
  name: Type.String({ minLength: 3, maxLength: 120 }),
  email: Type.String({ format: 'email' }),
  taxId: Type.String({ minLength: 5, maxLength: 20 }),
  segment: Type.Union([Type.Literal('RETAIL'), Type.Literal('CORPORATE')])
});
export type CustomerInput = Static<typeof CustomerInputSchema>;

// DDL declarativo da fatia (aplicado de forma idempotente pelo runner de migrações).
// TIMESTAMP (não DATETIME) para valer também em PostgreSQL.
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    tax_id TEXT NOT NULL UNIQUE,
    segment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type CustomerOutput = Result<
  { customerId: string; name: string; segment: 'RETAIL' | 'CORPORATE' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DUPLICATE_EMAIL' | 'DUPLICATE_TAX_ID'
>;

// ============================================================================
// 3. SERVER ACTION (`db` opcional: o mesmo ponto de chamada vale nos dois lados)
// ============================================================================
export async function createCustomerAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<CustomerOutput> {
  const auth = requireAuth(session, ['sales']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(CustomerInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as CustomerInput;

  const byEmail = await db.query<{ id: string }>(`SELECT id FROM customers WHERE email = $1`, [input.email]);
  if (byEmail.length > 0) {
    return Err('DUPLICATE_EMAIL');
  }

  const byTaxId = await db.query<{ id: string }>(`SELECT id FROM customers WHERE tax_id = $1`, [input.taxId]);
  if (byTaxId.length > 0) {
    return Err('DUPLICATE_TAX_ID');
  }

  const customerId = crypto.randomUUID();

  await db.query(`INSERT INTO customers (id, name, email, tax_id, segment) VALUES ($1, $2, $3, $4, $5)`, [
    customerId,
    input.name,
    input.email,
    input.taxId,
    input.segment
  ]);

  return Ok({ customerId, name: input.name, segment: input.segment });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface CreateCustomerFormProps {
  onSubmitAction?: (payload: unknown) => Promise<CustomerOutput>;
  defaultSegment?: 'RETAIL' | 'CORPORATE';
}

export function CreateCustomerForm({ onSubmitAction, defaultSegment = 'CORPORATE' }: CreateCustomerFormProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      taxId: formData.get('taxId') as string,
      segment: formData.get('segment') as 'RETAIL' | 'CORPORATE'
    });

    setFeedback(result.ok ? `Cliente criado: ${result.value.name}` : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="customer-name" className="text-xs font-mono text-slate-400">
        Razão social
      </label>
      <input
        id="customer-name"
        name="name"
        required
        minLength={3}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="customer-email" className="text-xs font-mono text-slate-400">
        E-mail
      </label>
      <input
        id="customer-email"
        name="email"
        type="email"
        required
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="customer-tax-id" className="text-xs font-mono text-slate-400">
        CNPJ / CPF
      </label>
      <input
        id="customer-tax-id"
        name="taxId"
        required
        minLength={5}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="customer-segment" className="text-xs font-mono text-slate-400">
        Segmento
      </label>
      <select
        id="customer-segment"
        name="segment"
        defaultValue={defaultSegment}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      >
        <option value="CORPORATE">Corporativo</option>
        <option value="RETAIL">Varejo</option>
      </select>

      <button
        type="submit"
        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-white text-sm font-medium transition-colors"
      >
        Criar cliente
      </button>

      {feedback && <p className="text-xs font-mono text-cyan-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de criação de cliente',
  cases: [
    {
      name: 'sem sessão retorna UNAUTHORIZED antes de tocar o banco',
      run: async () => {
        const db = new MockDatabaseClient();
        const result = await createCustomerAction(
          { name: 'Acme Ltda', email: 'a@b.com', taxId: '12345678', segment: 'CORPORATE' },
          db
        );

        if (result.ok || result.error !== 'UNAUTHORIZED') {
          throw new Error(`Invariante violada: esperava UNAUTHORIZED, obteve ${JSON.stringify(result)}`);
        }
        if (db.calls.length !== 0) {
          throw new Error('Invariante violada: autorização deveria acontecer antes de qualquer query');
        }
      }
    },
    {
      name: 'sessão sem o papel sales retorna FORBIDDEN',
      run: async () => {
        const result = await createCustomerAction(
          { name: 'Acme Ltda', email: 'a@b.com', taxId: '12345678', segment: 'CORPORATE' },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['support'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(`Invariante violada: esperava FORBIDDEN, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'segmento fora do contrato retorna INVALID_SCHEMA',
      run: async () => {
        fc.assert(
          fc.asyncProperty(fc.stringMatching(/^[a-z]{1,8}$/), async (invalidSegment) => {
            const result = await createCustomerAction(
              { name: 'Acme Ltda', email: 'a@b.com', taxId: '12345678', segment: invalidSegment },
              new MockDatabaseClient(),
              createSession({ userId: 'u1', roles: ['sales'] })
            );
            return result.ok === false && result.error === 'INVALID_SCHEMA';
          })
        );
      }
    },
    {
      name: 'e-mail já cadastrado retorna DUPLICATE_EMAIL',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM customers WHERE email/, () => [{ id: 'c-1' }]);

        const result = await createCustomerAction(
          { name: 'Acme Ltda', email: 'a@b.com', taxId: '12345678', segment: 'CORPORATE' },
          db,
          createSession({ userId: 'u1', roles: ['sales'] })
        );

        if (result.ok || result.error !== 'DUPLICATE_EMAIL') {
          throw new Error(`Invariante violada: esperava DUPLICATE_EMAIL, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'cliente válido é criado',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM customers/, () => []);

        const result = await createCustomerAction(
          { name: 'Acme Ltda', email: 'a@b.com', taxId: '12345678', segment: 'CORPORATE' },
          db,
          createSession({ userId: 'u1', roles: ['sales'] })
        );

        if (!result.ok || result.value.name !== 'Acme Ltda') {
          throw new Error(`Invariante violada: esperava criação, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
