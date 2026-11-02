import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useState } from 'react';
import {
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';
import { Badge, Button, Card, DataTable, Pagination } from 'synapsejs/client';

// ============================================================================
// 1. CONTRATO DE ENTRADA (TypeBox)
// ============================================================================
export const ListItemsInputSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 60 })),
    category: Type.Optional(Type.String({ maxLength: 50 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 }))
  },
  { additionalProperties: true }
);
export type ListItemsInput = Static<typeof ListItemsInputSchema>;

// ============================================================================
// 2. MODELAGEM DE DOMÍNIO (Result<T, E>)
// ============================================================================
export interface InventoryRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  status: 'active' | 'low_stock' | 'archived';
  created_at: string;
}

export type ListItemsOutput = Result<
  { rows: InventoryRow[]; total: number; limit: number; offset: number },
  'INVALID_SCHEMA' | 'NO_DATABASE'
>;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// ============================================================================
// 3. SERVER ACTION — busca utilizando Query Builder Isomórfico
// ============================================================================
export async function listItemsAction(
  payload: unknown,
  db?: DatabaseClient,
  _session?: SessionContext
): Promise<ListItemsOutput> {
  if (!db) {
    return Err('NO_DATABASE');
  }

  const input = (payload ?? {}) as ListItemsInput;
  if (!Value.Check(ListItemsInputSchema, input)) {
    return Err('INVALID_SCHEMA');
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = input.offset ?? 0;
  const term = (input.query ?? '').trim();

  let sql = 'SELECT * FROM inventory WHERE 1=1';
  const params: unknown[] = [];

  if (term) {
    params.push(`%${term}%`);
    params.push(`%${term}%`);
    sql += ` AND (name LIKE $1 OR sku LIKE $2)`;
  }

  if (input.category) {
    params.push(input.category);
    sql += ` AND category = $${params.length}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const rows = await db.query<InventoryRow>(sql, params);
  const countRow = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM inventory');
  const total = Number(countRow?.count ?? rows.length);

  return Ok({ rows, total, limit, offset });
}

// ============================================================================
// 4. LOADER — a lista renderiza no servidor com SSR instantâneo
// ============================================================================
export async function ListItemsLoader(
  context: SliceLoaderContext
): Promise<{ rows: InventoryRow[]; total: number; loadError?: string; query?: string }> {
  const query = (context.params.query ?? '').slice(0, 60);
  const limit = Number(context.params.limit ?? DEFAULT_LIMIT);
  const offset = Number(context.params.offset ?? 0);

  const result = await listItemsAction({ query, limit, offset }, context.db, context.session);

  return result.ok
    ? { rows: result.value.rows, total: result.value.total, query }
    : { rows: [], total: 0, query, loadError: result.error };
}

// ============================================================================
// 5. UI REACT com <DataTable>, <Badge>, <Pagination> e busca
// ============================================================================
export interface ListItemsViewProps {
  rows?: InventoryRow[];
  total?: number;
  loadError?: string;
  query?: string;
  limit?: number;
}

export function ListItemsTrigger({
  rows = [],
  total = 0,
  loadError,
  query = '',
  limit = DEFAULT_LIMIT
}: ListItemsViewProps) {
  const [searchTerm, setSearchTerm] = useState(query);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['id', 'sku', 'name', 'category', 'price', 'stock', 'status', 'created_at'];
    const lines = [
      header.join(','),
      ...rows.map((row) =>
        header.map((column) => csvEscape((row as unknown as Record<string, unknown>)[column])).join(',')
      )
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (loadError) {
    return (
      <div className="p-4 rounded-xl border border-rose-800/80 bg-rose-950/40 text-rose-200 font-mono text-sm shadow-lg">
        ❌ Falha ao carregar catálogo: {loadError}
      </div>
    );
  }

  const columns = [
    { key: 'sku', header: 'SKU / Código', sortable: true },
    { key: 'name', header: 'Produto', sortable: true },
    { key: 'category', header: 'Categoria' },
    {
      key: 'price',
      header: 'Preço Unitário',
      render: (val: unknown) => (
        <span className="font-mono font-semibold text-emerald-400">R$ {Number(val || 0).toFixed(2)}</span>
      )
    },
    {
      key: 'stock',
      header: 'Estoque',
      render: (val: unknown) => {
        const stock = Number(val || 0);
        return (
          <span className={`font-mono font-bold ${stock <= 5 ? 'text-amber-400' : 'text-slate-200'}`}>{stock} un</span>
        );
      }
    },
    {
      key: 'status',
      header: 'Status',
      render: (val: unknown) => {
        const s = String(val);
        const variant = s === 'active' ? 'success' : s === 'low_stock' ? 'warning' : 'neutral';
        return <Badge variant={variant}>{s.replace('_', ' ').toUpperCase()}</Badge>;
      }
    }
  ];

  return (
    <Card title="Catálogo de Produtos em Estoque" subtitle={`${total} itens registrados no catálogo`}>
      <div className="mb-4 flex flex-col sm:flex-row gap-3 justify-between items-center">
        <form method="GET" action="/inventory/list-items" className="w-full sm:w-80 flex gap-2">
          <input
            type="text"
            name="query"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome ou SKU..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
        </form>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            ⬇ Exportar CSV
          </Button>
          <a href="/inventory/create-item">
            <Button variant="primary">➕ Novo Item</Button>
          </a>
        </div>
      </div>

      <DataTable data={rows} columns={columns} emptyMessage="Nenhum item cadastrado no inventário." />

      {total > limit && (
        <div className="mt-6 flex justify-center">
          <Pagination total={total} limit={limit} offset={0} />
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// 6. ORÁCULO DE INVARIANTES (Property-Based Testing via Fast-Check)
// ============================================================================
export const sliceTests = {
  description: 'Invariantes de listagem de estoque',
  cases: [
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await listItemsAction({});
        if (result.ok || result.error !== 'NO_DATABASE') {
          throw new Error('esperava NO_DATABASE');
        }
      }
    },
    {
      name: 'rejeita limites acima de 100 via validação TypeBox',
      run: async () => {
        const mockDb = new MockDatabaseClient();
        const result = await listItemsAction({ limit: 999 }, mockDb);
        if (result.ok || result.error !== 'INVALID_SCHEMA') {
          throw new Error('esperava INVALID_SCHEMA para limit > 100');
        }
      }
    },
    {
      name: 'busca vazia em banco vazio retorna 0 linhas com status Ok',
      run: async () => {
        const mockDb = new MockDatabaseClient();
        const result = await listItemsAction({}, mockDb);
        if (!result.ok) {
          throw new Error('esperava Ok');
        }
        if (result.value.rows.length !== 0) {
          throw new Error('esperava lista vazia');
        }
      }
    }
  ]
};
