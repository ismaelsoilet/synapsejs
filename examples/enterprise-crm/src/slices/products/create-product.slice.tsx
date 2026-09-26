import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
import type React from 'react';
import { useState } from 'react';
import { type DatabaseClient, Err, MockDatabaseClient, Ok, type Result } from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const CreateProductInputSchema = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 100 }),
  email: Type.String({ format: 'email' }),
  metadata: Type.Optional(Type.String())
});
export type CreateProductInput = Static<typeof CreateProductInputSchema>;

// DDL Schema Declarativo da Fatia (Auto-Migrado pelo Synapse)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type CreateProductOutput = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (Server Action)
// `db` é opcional para que o mesmo ponto de chamada valha no servidor (que
// injeta a conexão) e no cliente (onde a chamada vira stub RPC).
// ============================================================================
export async function createProductAction(payload: unknown, db?: DatabaseClient): Promise<CreateProductOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  // Parsing JIT em memória
  if (!Value.Check(CreateProductInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as CreateProductInput;

  // Checagem de Duplicidade
  const existing = await db.query<{ id: string }>(`SELECT id FROM ${'products'} WHERE email = $1`, [input.email]);
  if (existing.length > 0) {
    return Err('DUPLICATE_EMAIL');
  }

  const generatedId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(`INSERT INTO ${'products'} (id, name, email) VALUES ($1, $2, $3)`, [
    generatedId,
    input.name,
    input.email
  ]);

  return Ok({
    id: generatedId,
    name: input.name,
    email: input.email,
    createdAt: now
  });
}

// ============================================================================
// 4. VISUALIZAÇÃO INTERATIVA DA UI (React)
// ============================================================================
export interface CreateProductTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateProductOutput>;
}

export function CreateProductTrigger({ onSubmitAction }: CreateProductTriggerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmitAction) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get('name') as string,
      email: formData.get('email') as string
    };

    const res = await onSubmitAction(payload);
    setIsSubmitting(false);

    if (res.ok) {
      setFeedback(`Registro criado com sucesso! ID: ${res.value.id}`);
    } else {
      setFeedback(`Erro ao processar: ${res.error}`);
    }
  };

  return (
    <div className="synapse-products-slice">
      <h3 className="text-xl font-bold text-white mb-4">Novo Registro: CreateProduct</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="product-name" className="block text-xs font-mono text-slate-300 mb-1">
            Nome Completo:
          </label>
          <input
            type="text"
            id="product-name"
            name="name"
            required
            minLength={2}
            placeholder="Ex: João da Silva"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="product-email" className="block text-xs font-mono text-slate-300 mb-1">
            E-mail Corporativo:
          </label>
          <input
            type="email"
            id="product-email"
            name="email"
            required
            placeholder="usuario@empresa.com"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-sm rounded-lg shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar Registro'}
        </button>
      </form>

      {feedback && (
        <div className="mt-4 p-3 rounded-lg font-mono text-xs bg-slate-800 border border-slate-700 text-slate-300">
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
  description: 'Verificação PBT de invariantes para create-product',
  cases: [
    {
      name: 'nome curto ou e-mail sem @ retornam INVALID_SCHEMA',
      run: async () => {
        fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 1 }),
            fc.stringMatching(/^[a-z0-9]{1,10}$/),
            async (shortName, invalidEmail) => {
              const result = await createProductAction(
                { name: shortName, email: invalidEmail },
                new MockDatabaseClient()
              );
              return result.ok === false && result.error === 'INVALID_SCHEMA';
            }
          )
        );
      }
    },
    {
      name: 'e-mail já cadastrado retorna DUPLICATE_EMAIL',
      run: async () => {
        const mockDbDuplicate = new MockDatabaseClient();
        mockDbDuplicate.onQuery(/SELECT id FROM/, () => [{ id: 'existing-id-123' }]);

        const dupResult = await createProductAction(
          { name: 'Usuario Valido', email: 'teste@dominio.com' },
          mockDbDuplicate
        );

        if (dupResult.ok || dupResult.error !== 'DUPLICATE_EMAIL') {
          throw new Error(`Invariante violada: esperava DUPLICATE_EMAIL, obteve ${JSON.stringify(dupResult)}`);
        }
      }
    },
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await createProductAction({ name: 'Produto Valido', email: 'novo@dominio.com' });

        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error(`Invariante violada: esperava NO_DATABASE, obteve ${JSON.stringify(result)}`);
        }
      }
    }
  ]
};
