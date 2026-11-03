import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
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
import { Icon } from '../../shared/icons';
import { EmptyState, FeatureGuide, formatDate, LinkButton } from '../../shared/ui';

export type InventoryStatus = 'active' | 'low_stock' | 'archived';
export type InventorySort =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'price_asc'
  | 'price_desc'
  | 'stock_asc'
  | 'stock_desc';

export const ListItemsInputSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 60 })),
    category: Type.Optional(Type.String({ maxLength: 50 })),
    status: Type.Optional(
      Type.Union([Type.Literal('active'), Type.Literal('low_stock'), Type.Literal('archived'), Type.Literal('')])
    ),
    minPrice: Type.Optional(Type.Number({ minimum: 0 })),
    maxPrice: Type.Optional(Type.Number({ minimum: 0 })),
    minStock: Type.Optional(Type.Integer({ minimum: 0 })),
    lowStock: Type.Optional(Type.Boolean()),
    sort: Type.Optional(
      Type.Union([
        Type.Literal('newest'),
        Type.Literal('oldest'),
        Type.Literal('name_asc'),
        Type.Literal('name_desc'),
        Type.Literal('price_asc'),
        Type.Literal('price_desc'),
        Type.Literal('stock_asc'),
        Type.Literal('stock_desc')
      ])
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 }))
  },
  { additionalProperties: true }
);
export type ListItemsInput = Static<typeof ListItemsInputSchema>;

export interface InventoryRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  status: InventoryStatus;
  created_at: string;
}

export interface ListFilters {
  query: string;
  category: string;
  status: InventoryStatus | '';
  minPrice: number | null;
  maxPrice: number | null;
  minStock: number | null;
  lowStock: boolean;
  sort: InventorySort;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_FILTERS: ListFilters = {
  query: '',
  category: '',
  status: '',
  minPrice: null,
  maxPrice: null,
  minStock: null,
  lowStock: false,
  sort: 'newest',
  limit: DEFAULT_LIMIT,
  offset: 0
};

const SORT_SQL: Record<InventorySort, string> = {
  newest: 'created_at DESC',
  oldest: 'created_at ASC',
  name_asc: 'name ASC',
  name_desc: 'name DESC',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  stock_asc: 'stock ASC',
  stock_desc: 'stock DESC'
};

const STATUS_VALUES: InventoryStatus[] = ['active', 'low_stock', 'archived'];
const SORT_VALUES: InventorySort[] = [
  'newest',
  'oldest',
  'name_asc',
  'name_desc',
  'price_asc',
  'price_desc',
  'stock_asc',
  'stock_desc'
];

export type ListItemsOutput = Result<
  { rows: InventoryRow[]; total: number; limit: number; offset: number },
  'INVALID_SCHEMA' | 'NO_DATABASE'
>;

export async function listItemsAction(
  payload: unknown,
  db?: DatabaseClient,
  _session?: SessionContext
): Promise<ListItemsOutput> {
  if (!db) return Err('NO_DATABASE');

  const input = (payload ?? {}) as ListItemsInput;
  if (!Value.Check(ListItemsInputSchema, input)) return Err('INVALID_SCHEMA');
  if (input.minPrice !== undefined && input.maxPrice !== undefined && input.minPrice > input.maxPrice) {
    return Err('INVALID_SCHEMA');
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(input.offset ?? 0, 0);
  const term = (input.query ?? '').trim();
  const where: string[] = [];
  const params: unknown[] = [];

  if (term) {
    params.push(`%${term}%`);
    const nameParam = params.length;
    params.push(`%${term}%`);
    const skuParam = params.length;
    where.push(`(name LIKE $${nameParam} OR sku LIKE $${skuParam})`);
  }
  if (input.category) {
    params.push(input.category);
    where.push(`category = $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    where.push(`status = $${params.length}`);
  }
  if (input.minPrice !== undefined) {
    params.push(input.minPrice);
    where.push(`price >= $${params.length}`);
  }
  if (input.maxPrice !== undefined) {
    params.push(input.maxPrice);
    where.push(`price <= $${params.length}`);
  }
  if (input.minStock !== undefined) {
    params.push(input.minStock);
    where.push(`stock >= $${params.length}`);
  }
  if (input.lowStock) {
    where.push('stock <= 5');
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sortSql = SORT_SQL[input.sort ?? 'newest'];
  const rows = await db.query<InventoryRow>(
    `SELECT * FROM inventory ${whereSql} ORDER BY ${sortSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const countRow = await db.queryOne<{ count: number }>(`SELECT count(*) as count FROM inventory ${whereSql}`, params);

  return Ok({ rows, total: Number(countRow?.count ?? 0), limit, offset });
}

export interface ListItemsLoaderData {
  rows: InventoryRow[];
  total: number;
  allTotal: number;
  lowStockCount: number;
  statusCounts: Record<InventoryStatus, number>;
  categories: string[];
  filters: ListFilters;
  loadError?: string;
}

function stringParam(context: SliceLoaderContext, key: string): string {
  const value = context.params[key];
  return typeof value === 'string' ? value : '';
}

function numberParam(context: SliceLoaderContext, key: string): number | null {
  const raw = stringParam(context, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function ListItemsLoader(context: SliceLoaderContext): Promise<ListItemsLoaderData> {
  const statusRaw = stringParam(context, 'status');
  const sortRaw = stringParam(context, 'sort');
  const limitRaw = Number(stringParam(context, 'limit') || DEFAULT_LIMIT);
  const offsetRaw = Number(stringParam(context, 'offset') || 0);
  const filters: ListFilters = {
    query: stringParam(context, 'query').slice(0, 60),
    category: stringParam(context, 'category').slice(0, 50),
    status: STATUS_VALUES.includes(statusRaw as InventoryStatus) ? (statusRaw as InventoryStatus) : '',
    minPrice: numberParam(context, 'minPrice'),
    maxPrice: numberParam(context, 'maxPrice'),
    minStock: numberParam(context, 'minStock'),
    lowStock: stringParam(context, 'lowStock') === 'true',
    sort: SORT_VALUES.includes(sortRaw as InventorySort) ? (sortRaw as InventorySort) : 'newest',
    limit: Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0
  };

  const result = await listItemsAction(
    {
      query: filters.query || undefined,
      category: filters.category || undefined,
      status: filters.status || undefined,
      minPrice: filters.minPrice ?? undefined,
      maxPrice: filters.maxPrice ?? undefined,
      minStock: filters.minStock ?? undefined,
      lowStock: filters.lowStock || undefined,
      sort: filters.sort,
      limit: filters.limit,
      offset: filters.offset
    },
    context.db,
    context.session
  );

  const statusCounts: Record<InventoryStatus, number> = { active: 0, low_stock: 0, archived: 0 };
  let categories: string[] = [];
  let allTotal = 0;
  let lowStockCount = 0;

  try {
    const statusRows = await context.db.query<{ status: string; count: number }>(
      'SELECT status, count(*) as count FROM inventory GROUP BY status'
    );
    for (const row of statusRows) {
      if (STATUS_VALUES.includes(row.status as InventoryStatus)) {
        statusCounts[row.status as InventoryStatus] = Number(row.count);
      }
    }
    allTotal = statusCounts.active + statusCounts.low_stock + statusCounts.archived;
    const low = await context.db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM inventory WHERE stock <= 5'
    );
    lowStockCount = Number(low?.count ?? 0);
    categories = (
      await context.db.query<{ category: string }>(
        'SELECT DISTINCT category FROM inventory WHERE category IS NOT NULL ORDER BY category'
      )
    ).map((row) => row.category);
  } catch {
    // Metrics are supplementary; the list still renders if one aggregate fails.
  }

  if (!result.ok) {
    return {
      rows: [],
      total: 0,
      allTotal,
      lowStockCount,
      statusCounts,
      categories,
      filters,
      loadError: result.error
    };
  }

  return {
    rows: result.value.rows,
    total: result.value.total,
    allTotal,
    lowStockCount,
    statusCounts,
    categories,
    filters
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Highlight({ text, term }: { text: string; term: string }) {
  const query = term.trim();
  if (!query) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'ig'));
  let cursor = 0;
  return (
    <>
      {parts.map((part) => {
        const key = `${cursor}:${part}`;
        cursor += part.length;
        return part.toLowerCase() === query.toLowerCase() ? (
          <mark key={key} className="rounded bg-cyan-400/10 px-0.5 text-cyan-200">
            {part}
          </mark>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </>
  );
}

function buildHref(filters: ListFilters, overrides: Partial<ListFilters> = {}): string {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (next.query) params.set('query', next.query);
  if (next.category) params.set('category', next.category);
  if (next.status) params.set('status', next.status);
  if (next.minPrice !== null) params.set('minPrice', String(next.minPrice));
  if (next.maxPrice !== null) params.set('maxPrice', String(next.maxPrice));
  if (next.minStock !== null) params.set('minStock', String(next.minStock));
  if (next.lowStock) params.set('lowStock', 'true');
  if (next.sort !== 'newest') params.set('sort', next.sort);
  if (next.limit !== DEFAULT_LIMIT) params.set('limit', String(next.limit));
  if (next.offset > 0) params.set('offset', String(next.offset));

  const query = params.toString();
  return `/inventory/list-items${query ? `?${query}` : ''}`;
}

export interface ListItemsViewProps extends Partial<ListItemsLoaderData> {
  rows?: InventoryRow[];
}

export function ListItemsTrigger({
  rows = [],
  total = 0,
  allTotal = 0,
  lowStockCount = 0,
  statusCounts = { active: 0, low_stock: 0, archived: 0 },
  categories = [],
  filters = DEFAULT_FILTERS,
  loadError
}: ListItemsViewProps) {
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
      <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 p-4 font-mono text-sm text-rose-200 shadow-lg">
        Falha ao carregar catálogo: {loadError}
      </div>
    );
  }

  const hasAdvanced =
    Boolean(filters.category) ||
    Boolean(filters.status) ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.minStock !== null ||
    filters.lowStock ||
    filters.sort !== 'newest';

  const page = Math.floor(filters.offset / filters.limit) + 1;
  const pages = Math.max(1, Math.ceil(total / filters.limit));
  const activeChips: Array<{ label: string; href: string }> = [];

  if (filters.query) {
    activeChips.push({
      label: `Busca: “${filters.query}”`,
      href: buildHref(filters, { query: '', offset: 0 })
    });
  }
  if (filters.category) {
    activeChips.push({
      label: `Categoria: ${filters.category}`,
      href: buildHref(filters, { category: '', offset: 0 })
    });
  }
  if (filters.status) {
    activeChips.push({
      label: `Status: ${filters.status.replace('_', ' ')}`,
      href: buildHref(filters, { status: '', offset: 0 })
    });
  }
  if (filters.lowStock) {
    activeChips.push({
      label: 'Estoque ≤ 5',
      href: buildHref(filters, { lowStock: false, offset: 0 })
    });
  }
  if (filters.minPrice !== null) {
    activeChips.push({
      label: `Preço ≥ R$ ${filters.minPrice.toFixed(2)}`,
      href: buildHref(filters, { minPrice: null, offset: 0 })
    });
  }
  if (filters.maxPrice !== null) {
    activeChips.push({
      label: `Preço ≤ R$ ${filters.maxPrice.toFixed(2)}`,
      href: buildHref(filters, { maxPrice: null, offset: 0 })
    });
  }
  if (filters.minStock !== null) {
    activeChips.push({
      label: `Estoque ≥ ${filters.minStock}`,
      href: buildHref(filters, { minStock: null, offset: 0 })
    });
  }
  if (filters.sort !== 'newest') {
    activeChips.push({
      label: `Ordenação: ${filters.sort}`,
      href: buildHref(filters, { sort: 'newest', offset: 0 })
    });
  }

  const quickFilters = [
    {
      id: 'all',
      label: 'Todos',
      count: allTotal,
      href: buildHref(filters, { status: '', lowStock: false, offset: 0 }),
      active: !filters.status && !filters.lowStock
    },
    {
      id: 'active',
      label: 'Ativos',
      count: statusCounts.active,
      href: buildHref(filters, { status: 'active', lowStock: false, offset: 0 }),
      active: filters.status === 'active' && !filters.lowStock
    },
    {
      id: 'low',
      label: 'Baixo estoque',
      count: lowStockCount,
      href: buildHref(filters, { status: '', lowStock: true, offset: 0 }),
      active: filters.lowStock
    },
    {
      id: 'archived',
      label: 'Arquivados',
      count: statusCounts.archived,
      href: buildHref(filters, { status: 'archived', lowStock: false, offset: 0 }),
      active: filters.status === 'archived' && !filters.lowStock
    }
  ];

  const columns = [
    {
      key: 'sku',
      header: 'SKU',
      render: (value: unknown) => (
        <span className="font-mono text-[11px] text-slate-400">
          <Highlight text={String(value)} term={filters.query} />
        </span>
      )
    },
    {
      key: 'name',
      header: 'Produto',
      render: (value: unknown) => (
        <span className="font-semibold text-slate-200">
          <Highlight text={String(value)} term={filters.query} />
        </span>
      )
    },
    {
      key: 'category',
      header: 'Categoria',
      render: (value: unknown) => <Badge variant="neutral">{String(value)}</Badge>
    },
    {
      key: 'price',
      header: 'Preço',
      render: (value: unknown) => (
        <span className="font-mono font-semibold text-emerald-400">
          R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
      )
    },
    {
      key: 'stock',
      header: 'Estoque',
      render: (value: unknown) => {
        const stock = Number(value || 0);
        const critical = stock <= 5;
        return (
          <div className="flex items-center gap-2">
            <span className={`font-mono text-xs font-bold ${critical ? 'text-amber-400' : 'text-slate-200'}`}>
              {stock}
            </span>
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-800">
              <span
                className={`block h-full rounded-full ${critical ? 'bg-amber-400' : 'bg-cyan-400'}`}
                style={{ width: `${Math.min(100, stock)}%` }}
              />
            </span>
          </div>
        );
      }
    },
    {
      key: 'status',
      header: 'Status',
      render: (value: unknown) => {
        const status = String(value) as InventoryStatus;
        const variant = status === 'active' ? 'success' : status === 'low_stock' ? 'warning' : 'neutral';
        return <Badge variant={variant}>{status.replace('_', ' ')}</Badge>;
      }
    },
    {
      key: 'created_at',
      header: 'Criado em',
      render: (value: unknown) => (
        <span className="font-mono text-[10px] text-slate-500">{formatDate(String(value))}</span>
      )
    }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Inventário</div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white">Catálogo de produtos</h1>
          <p className="mt-1 text-xs text-slate-400">
            {total} de {allTotal} registros · filtros, busca com highlight e paginação no servidor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            <Icon name="download" className="mr-1.5 h-3.5 w-3.5" /> Exportar página
          </Button>
          <LinkButton href="/inventory/create-item">
            <Icon name="plus" className="mr-1.5 h-3.5 w-3.5" /> Novo item
          </LinkButton>
        </div>
      </div>

      <Card title="Filtros e busca" subtitle="A URL preserva cada filtro; o loader e a action executam no servidor.">
        <form method="GET" action="/inventory/list-items" className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            />
            <input
              type="search"
              name="query"
              defaultValue={filters.query}
              placeholder="Buscar por nome ou SKU…"
              className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-2.5 pl-9 pr-3 text-sm text-white outline-none transition focus:border-cyan-400"
            />
          </div>
          <input type="hidden" name="category" value={filters.category} />
          <input type="hidden" name="status" value={filters.status} />
          {filters.minPrice !== null ? <input type="hidden" name="minPrice" value={filters.minPrice} /> : null}
          {filters.maxPrice !== null ? <input type="hidden" name="maxPrice" value={filters.maxPrice} /> : null}
          {filters.minStock !== null ? <input type="hidden" name="minStock" value={filters.minStock} /> : null}
          {filters.lowStock ? <input type="hidden" name="lowStock" value="true" /> : null}
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="limit" value={filters.limit} />
          <Button type="submit" variant="primary">
            Buscar
          </Button>
          {filters.query ? (
            <a
              href={buildHref(filters, { query: '', offset: 0 })}
              className="inline-flex items-center justify-center rounded-md px-3 py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-200"
            >
              Limpar busca
            </a>
          ) : null}
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {quickFilters.map((filter) => (
            <a
              key={filter.id}
              href={filter.href}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                filter.active
                  ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              {filter.label}
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${filter.active ? 'bg-cyan-400/15' : 'bg-slate-800'}`}
              >
                {filter.count}
              </span>
            </a>
          ))}
        </div>

        {activeChips.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ativos</span>
            {activeChips.map((chip) => (
              <a
                key={chip.label}
                href={chip.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1 text-[10px] text-cyan-200 transition hover:border-cyan-400/40"
              >
                {chip.label}
                <Icon name="close" className="h-3 w-3" />
              </a>
            ))}
            <a href="/inventory/list-items" className="text-[10px] font-semibold text-slate-500 hover:text-rose-300">
              Limpar tudo
            </a>
          </div>
        ) : null}

        <details open={hasAdvanced} className="group mt-4 border-t border-slate-800 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold text-slate-300">
            <Icon name="filter" className="h-3.5 w-3.5 text-cyan-300" />
            Filtros avançados
            {hasAdvanced ? (
              <span className="rounded-full bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200">
                {activeChips.length}
              </span>
            ) : null}
            <Icon name="chevronDown" className="ml-auto h-3.5 w-3.5 text-slate-500 transition group-open:rotate-180" />
          </summary>
          <form method="GET" action="/inventory/list-items" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="query" value={filters.query} />
            {filters.lowStock ? <input type="hidden" name="lowStock" value="true" /> : null}
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Categoria
              <select
                name="category"
                defaultValue={filters.category}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Status
              <select
                name="status"
                defaultValue={filters.status}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              >
                <option value="">Todos</option>
                <option value="active">Ativo</option>
                <option value="low_stock">Baixo estoque</option>
                <option value="archived">Arquivado</option>
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Ordenar por
              <select
                name="sort"
                defaultValue={filters.sort}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              >
                <option value="newest">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
                <option value="name_asc">Nome A–Z</option>
                <option value="name_desc">Nome Z–A</option>
                <option value="price_asc">Menor preço</option>
                <option value="price_desc">Maior preço</option>
                <option value="stock_asc">Menor estoque</option>
                <option value="stock_desc">Maior estoque</option>
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Preço mínimo
              <input
                type="number"
                name="minPrice"
                min="0"
                step="0.01"
                defaultValue={filters.minPrice ?? ''}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Preço máximo
              <input
                type="number"
                name="maxPrice"
                min="0"
                step="0.01"
                defaultValue={filters.maxPrice ?? ''}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Estoque mínimo
              <input
                type="number"
                name="minStock"
                min="0"
                step="1"
                defaultValue={filters.minStock ?? ''}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Por página
              <select
                name="limit"
                defaultValue={String(filters.limit)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" variant="primary">
                Aplicar filtros
              </Button>
              <a
                href="/inventory/list-items"
                className="rounded-md px-3 py-2 text-xs font-semibold text-slate-400 transition hover:text-rose-300"
              >
                Limpar filtros
              </a>
            </div>
          </form>
        </details>
      </Card>

      <Card title="Resultados" subtitle={`Página ${page} de ${pages} · ${total} resultado${total === 1 ? '' : 's'}`}>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="filter" className="h-5 w-5" />}
            title="Nenhum produto encontrado"
            description="Ajuste a busca ou remova um dos filtros ativos."
            action={<LinkButton href="/inventory/list-items">Limpar filtros</LinkButton>}
          />
        ) : (
          <DataTable data={rows} columns={columns} />
        )}
        {total > filters.limit ? (
          <div className="mt-5 flex justify-center border-t border-slate-800 pt-4">
            <Pagination
              currentPage={page}
              totalPages={pages}
              onPageChange={(nextPage) => {
                if (typeof window !== 'undefined') {
                  window.location.assign(buildHref(filters, { offset: (nextPage - 1) * filters.limit }));
                }
              }}
            />
          </div>
        ) : null}
      </Card>

      <FeatureGuide
        title="ListView: busca, filtros e paginação"
        icon="filter"
        what="Uma lista orientada pela URL que combina busca textual com highlight, filtros rápidos, filtros avançados, ordenação, paginação e export CSV."
        useCases={[
          'Catálogos administrativos com muitos registros',
          'CRMs e pedidos por status, período ou valor',
          'Telas de operação que precisam compartilhar o estado do filtro por link'
        ]}
        steps={[
          'Os controles fazem GET e preservam o estado na query string.',
          'O loader normaliza os parâmetros e chama a action; a action monta WHERE/LIMIT/OFFSET com parâmetros.',
          'A resposta inclui total filtrado, contagens por status e categorias para os controles.',
          'O React renderiza badges, highlight e paginação; o CSV exporta a página atual.'
        ]}
        observe="Digite “mon” e envie; veja o highlight. Alterne os quick filters e abra “Filtros avançados”. Cada chip remove um filtro sem perder os demais; o número da página e o total vêm do servidor."
      />
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Catálogo | Synapse Showcase',
    description: 'ListView com busca destacada, quick filters, filtros avançados, badges e paginação server-side.'
  };
}

export const sliceTests = {
  description: 'Invariantes de listagem de estoque',
  cases: [
    {
      name: 'sem conexão de banco retorna NO_DATABASE',
      run: async () => {
        const result = await listItemsAction({});
        if (result.ok || result.error !== 'NO_DATABASE') throw new Error('esperava NO_DATABASE');
      }
    },
    {
      name: 'rejeita limites acima de 50 via validação TypeBox',
      run: async () => {
        const result = await listItemsAction({ limit: 999 }, new MockDatabaseClient());
        if (result.ok || result.error !== 'INVALID_SCHEMA') throw new Error('esperava INVALID_SCHEMA');
      }
    },
    {
      name: 'rejeita faixa de preço invertida',
      run: async () => {
        const result = await listItemsAction({ minPrice: 100, maxPrice: 10 }, new MockDatabaseClient());
        if (result.ok || result.error !== 'INVALID_SCHEMA') throw new Error('esperava INVALID_SCHEMA');
      }
    },
    {
      name: 'rejeita ordenação fora da allowlist',
      run: async () => {
        const result = await listItemsAction({ sort: 'name; DROP TABLE inventory' }, new MockDatabaseClient());
        if (result.ok || result.error !== 'INVALID_SCHEMA') throw new Error('esperava INVALID_SCHEMA');
      }
    },
    {
      name: 'busca vazia em banco vazio retorna 0 linhas com status Ok',
      run: async () => {
        const result = await listItemsAction({}, new MockDatabaseClient());
        if (!result.ok || result.value.rows.length !== 0) throw new Error('esperava lista vazia');
      }
    }
  ]
};
