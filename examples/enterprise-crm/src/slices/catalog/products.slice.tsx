import { type Static, Type } from '@sinclair/typebox';
import { defineCache, Err, Ok, type Result, type SliceCacheConfig } from 'synapsejs';

// ============================================================================
// 1. CONTRATO DE ENTRADA
// ============================================================================
export const CatalogInputSchema = Type.Object({
  category: Type.Optional(Type.String())
});
export type CatalogInput = Static<typeof CatalogInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS catalog_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL
  );
`;

// ============================================================================
// 2. CACHE DE SSR COM STALE-WHILE-REVALIDATE (defineCache)
// ============================================================================
export const sliceCache: SliceCacheConfig = defineCache({
  ttlSeconds: 60,
  staleWhileRevalidateSeconds: 300,
  tags: ['catalog'],
  allowedParams: ['category']
});

// ============================================================================
// 3. LOADER: dados do banco a cada render (sem cache próprio, o SSR cacheia)
// ============================================================================
export async function catalogProductsLoader(context: {
  params: Record<string, string>;
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> };
}) {
  const category = context.params.category;

  const rows = category
    ? await context.db.query<{ id: string; name: string }>(
        'SELECT id, name FROM catalog_products WHERE category = $1 ORDER BY name',
        [category]
      )
    : await context.db.query<{ id: string; name: string }>('SELECT id, name FROM catalog_products ORDER BY name');

  return { products: rows };
}

// ============================================================================
// 3.5. AÇÃO E UI: invalidação do cache por tag pelo mesmo ponto de chamada
// ============================================================================
export type CatalogRefreshOutput = Result<{ refreshed: boolean }, 'NO_CONTEXT'>;

export async function catalogRefreshAction(
  _payload: unknown,
  _db?: unknown,
  _session?: unknown,
  ctx?: { invalidateCache?: (tags?: string[]) => void }
): Promise<CatalogRefreshOutput> {
  if (!ctx?.invalidateCache) {
    return Err('NO_CONTEXT');
  }

  ctx.invalidateCache(sliceCache.tags);

  return Ok({ refreshed: true });
}

export interface CatalogViewProps {
  products?: Array<{ id: string; name: string }>;
}

export function CatalogView({ products = [] }: CatalogViewProps) {
  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}

// ============================================================================
// 4. ORÁCULO: a política de cache e o loader são exercitados de verdade
// ============================================================================
export const sliceTests = {
  description: 'Invariantes do catálogo cacheado',
  cases: [
    {
      name: 'a política declara TTL e janela de revalidação',
      run: async () => {
        if (sliceCache.ttlSeconds <= 0 || (sliceCache.staleWhileRevalidateSeconds ?? 0) <= 0) {
          throw new Error(`esperava uma política de ISR completa, obtive ${JSON.stringify(sliceCache)}`);
        }

        if (!sliceCache.tags?.includes('catalog')) {
          throw new Error('esperava a tag catalog para invalidação por filtro');
        }
      }
    },
    {
      name: 'o loader filtra a categoria quando o parâmetro é informado',
      run: async () => {
        const calls: Array<{ sql: string; params?: unknown[] }> = [];
        const db = {
          query: async (sql: string, params?: unknown[]) => {
            calls.push({ sql, params });
            return [] as unknown[];
          }
        };

        await catalogProductsLoader({ params: { category: 'livros' }, db: db as never });
        await catalogProductsLoader({ params: {}, db: db as never });

        if (calls[0].params?.[0] !== 'livros' || !calls[0].sql.includes('WHERE category = $1')) {
          throw new Error(`esperava filtro parametrizado, obtive ${JSON.stringify(calls[0])}`);
        }

        if (calls[1].sql.includes('WHERE')) {
          throw new Error(`esperava a consulta sem filtro, obtive ${JSON.stringify(calls[1])}`);
        }
      }
    }
  ]
};
