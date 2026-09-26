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
export const ProductInputSchema = Type.Object({
  sku: Type.String({ minLength: 3, maxLength: 40 }),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  priceCents: Type.Integer({ minimum: 1 }),
  active: Type.Optional(Type.Boolean())
});
export type ProductInput = Static<typeof ProductInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export type ProductOutput = Result<
  { productId: string; sku: string; priceCents: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DUPLICATE_SKU'
>;

// ============================================================================
// 3. SERVER ACTION
// ============================================================================
export async function createProductAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext
): Promise<ProductOutput> {
  const auth = requireAuth(session, ['catalog']);
  if (!auth.ok) {
    return Err(auth.error);
  }

  if (!db) {
    return Err('NO_DATABASE');
  }

  if (!Value.Check(ProductInputSchema, payload)) {
    return Err('INVALID_SCHEMA');
  }

  const input = payload as ProductInput;

  const existing = await db.query<{ id: string }>(`SELECT id FROM products WHERE sku = $1`, [input.sku]);
  if (existing.length > 0) {
    return Err('DUPLICATE_SKU');
  }

  const productId = crypto.randomUUID();

  await db.query(`INSERT INTO products (id, sku, name, price_cents, active) VALUES ($1, $2, $3, $4, $5)`, [
    productId,
    input.sku,
    input.name,
    input.priceCents,
    input.active === false ? 0 : 1
  ]);

  return Ok({ productId, sku: input.sku, priceCents: input.priceCents });
}

// ============================================================================
// 4. UI REACT
// ============================================================================
export interface CreateProductFormProps {
  onSubmitAction?: (payload: unknown) => Promise<ProductOutput>;
}

export function CreateProductForm({ onSubmitAction }: CreateProductFormProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitAction) return;

    const formData = new FormData(event.currentTarget);
    const result = await onSubmitAction({
      sku: formData.get('sku') as string,
      name: formData.get('name') as string,
      priceCents: Number(formData.get('priceCents'))
    });

    setFeedback(result.ok ? `Produto ${result.value.sku} criado` : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="product-sku" className="text-xs font-mono text-slate-400">
        SKU
      </label>
      <input
        id="product-sku"
        name="sku"
        required
        minLength={3}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="product-name" className="text-xs font-mono text-slate-400">
        Nome
      </label>
      <input
        id="product-name"
        name="name"
        required
        minLength={2}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <label htmlFor="product-price" className="text-xs font-mono text-slate-400">
        Preço (em centavos)
      </label>
      <input
        id="product-price"
        name="priceCents"
        type="number"
        required
        min={1}
        defaultValue={1990}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
      />

      <button
        type="submit"
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-sm font-medium transition-colors"
      >
        Criar produto
      </button>

      {feedback && <p className="text-xs font-mono text-emerald-300">{feedback}</p>}
    </form>
  );
}

// ============================================================================
// 5. ORÁCULO DE INVARIANTES
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de criação de produto',
  cases: [
    {
      name: 'sem o papel catalog retorna FORBIDDEN',
      run: async () => {
        const result = await createProductAction(
          { sku: 'SKU-1', name: 'Cadeira', priceCents: 1990 },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['sales'] })
        );

        if (result.ok || result.error !== 'FORBIDDEN') {
          throw new Error(`Invariante violada: esperava FORBIDDEN, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'preço zero ou negativo retorna INVALID_SCHEMA',
      run: async () => {
        const result = await createProductAction(
          { sku: 'SKU-1', name: 'Cadeira', priceCents: 0 },
          new MockDatabaseClient(),
          createSession({ userId: 'u1', roles: ['catalog'] })
        );

        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error(`Invariante violada: esperava INVALID_SCHEMA, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'SKU já cadastrado retorna DUPLICATE_SKU',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM products WHERE sku/, () => [{ id: 'p-1' }]);

        const result = await createProductAction(
          { sku: 'SKU-1', name: 'Cadeira', priceCents: 1990 },
          db,
          createSession({ userId: 'u1', roles: ['catalog'] })
        );

        if (result.ok || result.error !== 'DUPLICATE_SKU') {
          throw new Error(`Invariante violada: esperava DUPLICATE_SKU, obteve ${JSON.stringify(result)}`);
        }
      }
    },
    {
      name: 'produto válido é criado e o id retornado é o gravado',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT id FROM products/, () => []);

        const result = await createProductAction(
          { sku: 'SKU-1', name: 'Cadeira', priceCents: 1990 },
          db,
          createSession({ userId: 'u1', roles: ['catalog'] })
        );

        if (!result.ok) {
          throw new Error(`Invariante violada: esperava criação, obteve ${JSON.stringify(result)}`);
        }

        const inserted = db.calls.find((call) => call.sql.includes('INSERT INTO products'));
        const storedId = inserted?.params[0];

        if (storedId !== result.value.productId) {
          throw new Error(
            `Invariante violada: id retornado (${result.value.productId}) difere do gravado (${storedId})`
          );
        }
      }
    }
  ]
};
