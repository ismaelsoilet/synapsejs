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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DO DOMÍNIO (Result<T, E>)
// ============================================================================
export type CreateProductOutput = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (Server Action)
// ============================================================================
export async function createProductAction(
  payload: unknown,
  db: DatabaseClient
): Promise<CreateProductOutput> {
  // Parsing JIT em memória
  if (!Value.Check(CreateProductInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as CreateProductInput;

  // Checagem de Duplicidade
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM ${'products'} WHERE email = $1`,
    [input.email]
  );
  if (existing.length > 0) {
    return Err('DUPLICATE_EMAIL');
  }

  const generatedId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO ${'products'} (id, name, email) VALUES ($1, $2, $3)`,
    [generatedId, input.name, input.email]
  );

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
          <label className="block text-xs font-mono text-slate-300 mb-1">Nome Completo:</label>
          <input
            type="text"
            name="name"
            required
            minLength={2}
            placeholder="Ex: João da Silva"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">E-mail Corporativo:</label>
          <input
            type="email"
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
  run: async () => {
    // 1. Invariante: Nomes curtos ou e-mails sem @ SEMPRE retornam INVALID_SCHEMA
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 1 }),
        fc.stringMatching(/^[a-z0-9]{1,10}$/),
        async (shortName, invalidEmail) => {
          const mockDb = new MockDatabaseClient();
          const result = await createProductAction(
            { name: shortName, email: invalidEmail },
            mockDb
          );
          return result.ok === false && result.error === 'INVALID_SCHEMA';
        }
      )
    );

    // 2. Invariante: E-mail já cadastrado SEMPRE retorna DUPLICATE_EMAIL
    const mockDbDuplicate = new MockDatabaseClient();
    mockDbDuplicate.onQuery(/SELECT id FROM/, () => [{ id: 'existing-id-123' }]);

    const dupResult = await createProductAction(
      { name: 'Usuario Valido', email: 'teste@dominio.com' },
      mockDbDuplicate
    );

    if (dupResult.ok || dupResult.error !== 'DUPLICATE_EMAIL') {
      throw new Error(`Invariante violada: esperava DUPLICATE_EMAIL, obteve ${JSON.stringify(dupResult)}`);
    }

    return true;
  }
};

if (import.meta.main) {
  console.log('⚡ Executando Oráculo PBT do Slice create-product...');
  sliceTests.run()
    .then(() => {
      console.log('✅ [PBT ORACLE PASS] Todos os invariantes aprovados com sucesso!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ [PBT ORACLE FAIL] Falha na verificação de invariantes:', err);
      process.exit(1);
    });
}
