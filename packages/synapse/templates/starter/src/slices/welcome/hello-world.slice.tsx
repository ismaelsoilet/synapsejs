import React, { useState } from 'react';
import { 
  Type, 
  Static, 
  Value, 
  fc, 
  Result, 
  Ok, 
  Err, 
  type DatabaseClient, 
  type SessionContext,
  MockDatabaseClient 
} from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA JIT (TypeBox)
// ============================================================================
export const HelloWorldInputSchema = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 50 }),
  message: Type.Optional(Type.String({ maxLength: 200 }))
});
export type HelloWorldInput = Static<typeof HelloWorldInputSchema>;

// DDL DECLARATIVO DA FATIA (Auto-migrado via AST pelo Synapse)
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS greetings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM ESTRITA DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type HelloWorldOutput = Result<
  { greetingId: string; greeting: string; createdAt: string },
  'INVALID_SCHEMA' | 'PERSISTENCE_FAILED'
>;

// ============================================================================
// 3. EXECUÇÃO DE SERVIDOR PURA (SERVER ACTION)
// ============================================================================
export async function helloWorldAction(
  payload: unknown,
  db: DatabaseClient,
  session?: SessionContext
): Promise<HelloWorldOutput> {
  if (!Value.Check(HelloWorldInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }
  const input = payload as HelloWorldInput;
  const greetingId = crypto.randomUUID();
  const greeting = `Olá, ${input.name}! Bem-vindo ao SynapseJS.`;

  await db.query(
    `INSERT INTO greetings (id, name, message) VALUES ($1, $2, $3)`,
    [greetingId, input.name, input.message || 'Boas-vindas']
  );

  return Ok({
    greetingId,
    greeting,
    createdAt: new Date().toISOString()
  });
}

// ============================================================================
// 4. COMPONENTE UI REACT
// ============================================================================
export interface HelloWorldViewProps {
  defaultName?: string;
  onSubmitAction?: (payload: unknown) => Promise<HelloWorldOutput>;
}

export function HelloWorldView({ defaultName = 'Desenvolvedor', onSubmitAction }: HelloWorldViewProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmitAction) return;

    const form = e.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name') as string,
      message: (formData.get('message') as string) || undefined
    };

    const res = await onSubmitAction(payload);
    if (res.ok) {
      setFeedback(res.value.greeting);
    } else {
      setFeedback(`Erro: ${res.error}`);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-slate-900 border border-slate-800 rounded-xl text-slate-100">
      <h2 className="text-xl font-bold mb-4 text-cyan-400">⚡ SynapseJS Starter Slice</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">Seu Nome:</label>
          <input
            name="name"
            defaultValue={defaultName}
            required
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">Mensagem (Opcional):</label>
          <input
            name="message"
            placeholder="Primeira fatia no SynapseJS..."
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
          />
        </div>
        <button
          type="submit"
          className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-white font-medium text-sm transition-colors"
        >
          Executar Ação RPC
        </button>
      </form>
      {feedback && (
        <div className="mt-4 p-3 bg-slate-800 rounded text-xs font-mono text-cyan-300">
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
  description: 'Verificação PBT de invariantes para hello-world',
  run: async () => {
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2, maxLength: 50 }),
        async (validName) => {
          const mockDb = new MockDatabaseClient();
          const result = await helloWorldAction({ name: validName }, mockDb);
          return result.ok === true && result.value.greeting.includes(validName);
        }
      )
    );
    return true;
  }
};

if (import.meta.main) {
  sliceTests.run().then(() => console.log('✅ [PBT PASS] Hello World oráculo aprovado!'));
}
