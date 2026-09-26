import React, { useState } from 'react';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import { 
  type DatabaseClient, 
  Result, 
  Ok, 
  Err, 
  MockDatabaseClient 
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const CustomerInputSchema = Type.Object({
  name: Type.String({ minLength: 3, maxLength: 100 }),
  email: Type.String({ format: 'email' }),
  taxId: Type.String({ minLength: 5, maxLength: 20 })
});
export type CustomerInput = Static<typeof CustomerInputSchema>;

// DDL Schema Declarativo da Fatia (Auto-Migrado pelo Synapse)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    tax_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type CustomerOutput = Result<
  { customerId: string; name: string; email: string; taxId: string; status: 'ACTIVE' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'DUPLICATE_EMAIL' | 'DUPLICATE_TAX_ID'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (Server Action)
// `db` é opcional para que o mesmo ponto de chamada valha no servidor (que
// injeta a conexão) e no cliente (onde a chamada vira stub RPC).
// ============================================================================
export async function createCustomerAction(
  payload: unknown,
  db?: DatabaseClient
): Promise<CustomerOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  // Validação rápida em memória JIT
  if (!Value.Check(CustomerInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as CustomerInput;

  // Verificação de E-mail existente
  const emailCheck = await db.query<{ id: string }>(
    `SELECT id FROM customers WHERE email = $1`,
    [input.email]
  );
  if (emailCheck.length > 0) {
    return Err('DUPLICATE_EMAIL');
  }

  // Verificação de Tax ID existente
  const taxCheck = await db.query<{ id: string }>(
    `SELECT id FROM customers WHERE tax_id = $1`,
    [input.taxId]
  );
  if (taxCheck.length > 0) {
    return Err('DUPLICATE_TAX_ID');
  }

  const generatedId = crypto.randomUUID();

  await db.query(
    `INSERT INTO customers (id, name, email, tax_id) VALUES ($1, $2, $3, $4)`,
    [generatedId, input.name, input.email, input.taxId]
  );

  return Ok({
    customerId: generatedId,
    name: input.name,
    email: input.email,
    taxId: input.taxId,
    status: 'ACTIVE'
  });
}

// ============================================================================
// 4. VISUALIZAÇÃO INTERATIVA DA UI (React)
// ============================================================================
export interface CustomerTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CustomerOutput>;
}

export function CustomerTrigger({ onSubmitAction }: CustomerTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmitAction) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      taxId: formData.get('taxId') as string
    };

    const res = await onSubmitAction(payload);
    setIsSubmitting(false);

    if (res.ok) {
      setFeedback(`Cliente cadastrado com sucesso! ID: ${res.value.customerId}`);
    } else {
      setFeedback(`Erro ao cadastrar: ${res.error}`);
    }
  };

  return (
    <div className="synapse-customer-slice">
      <h3 className="text-xl font-bold text-white mb-2">Cadastro de Cliente</h3>
      <p className="text-xs text-slate-400 font-mono mb-4">Gera a entidade base necessária para a emissão de faturas.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">Razão Social / Nome:</label>
          <input
            type="text"
            name="name"
            required
            minLength={3}
            defaultValue="Acme Corporation"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">E-mail Comercial:</label>
          <input
            type="email"
            name="email"
            required
            defaultValue="financeiro@acme.com"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">CNPJ / CPF / Tax ID:</label>
          <input
            type="text"
            name="taxId"
            required
            minLength={5}
            defaultValue="12.345.678/0001-90"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-sm rounded-lg shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando no SQLite...' : 'Cadastrar Cliente'}
        </button>
      </form>

      {feedback && (
        <div className="mt-4 p-3 rounded-lg font-mono text-xs bg-slate-800 border border-slate-700 text-slate-200">
          {feedback}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. ORÁCULO DE AUTO-VERIFICAÇÃO PBT (Property-Based Testing)
// ============================================================================
export const sliceTests = {
  description: 'Verificação PBT de invariantes para create-customer',
  cases: [
    {
      name: 'nomes com menos de 3 caracteres retornam INVALID_SCHEMA',
      run: async () => {
        fc.assert(
          fc.asyncProperty(fc.string({ minLength: 0, maxLength: 2 }), async (shortName) => {
            const result = await createCustomerAction(
              {
                name: shortName,
                email: 'valid@test.com',
                taxId: '12345678'
              },
              new MockDatabaseClient()
            );
            return result.ok === false && result.error === 'INVALID_SCHEMA';
          })
        );
      }
    },
    {
      name: 'e-mail já cadastrado retorna DUPLICATE_EMAIL',
      run: async () => {
        const mockDbEmail = new MockDatabaseClient();
        mockDbEmail.onQuery(/SELECT id FROM customers WHERE email/, () => [{ id: 'dup-123' }]);

        const dupEmailResult = await createCustomerAction(
          {
            name: 'Cliente Valido',
            email: 'ja_existe@test.com',
            taxId: '123456789'
          },
          mockDbEmail
        );

        if (dupEmailResult.ok || dupEmailResult.error !== 'DUPLICATE_EMAIL') {
          throw new Error(`Invariante violada: esperava DUPLICATE_EMAIL`);
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await createCustomerAction({
          name: 'Cliente Valido',
          email: 'novo@test.com',
          taxId: '123456789'
        });

        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error(`Invariante violada: esperava NO_DATABASE, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
