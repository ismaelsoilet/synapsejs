// [SYNAPSE-JS AUTO-GENERATED SKELETON MAP]
// STRICT CONTRACTS, ALGEBRAIC TYPES AND FUNCTION SIGNATURES ONLY.
// Regenerate with 'synapse skeleton' — output is deterministic and committed.
// NOT COMPILABLE: this is a signature digest for LLM context, not a .d.ts module.
// It carries no imports and names repeat across modules by design.

// ============================================================================
// MODULE: src/shared/inventory.ts
// ============================================================================
export declare function adjustInventoryStock(db: DatabaseClient, itemId: string, delta: number, _reason: unknown): Promise<Result<{ id: string; oldStock: number; newStock: number }, 'NO_DATABASE' | 'NOT_FOUND' | 'INSUFFICIENT_STOCK'>>;

// ============================================================================
// MODULE: src/slices/_layout.tsx
// ============================================================================
export declare function RootLayout({
  children,
  url = '/',
  session
}: {
  children: ReactNode;
  url?: string;
  session?: any;
}): Element;

// ============================================================================
// MODULE: src/slices/dashboard/overview.slice.tsx
// ============================================================================
export declare function sliceMeta(data: { metrics?: DashboardMetrics }): { title: string; description: string; openGraph: { title: string; description: string; }; };
export declare const OverviewInputSchema: { refreshAudit?: boolean | undefined; };
export type OverviewInput = Static<typeof OverviewInputSchema>;

export interface DashboardMetrics {
  totalItems: number;
  totalStock: number;
  totalValue: number;
  lowStockCount: number;
  categoriesCount: number;
}

export type OverviewOutput = Result<
  { metrics: DashboardMetrics; auditEnqueued?: boolean },
  'INVALID_SCHEMA' | 'NO_DATABASE'
>;

export declare function overviewAction(payload: unknown, db: DatabaseClient, _session: SessionContext): Promise<OverviewOutput>;
export declare function OverviewLoader(context: SliceLoaderContext): Promise<{ metrics: DashboardMetrics; timestamp: string; loadError?: string }>;
export interface OverviewViewProps {
  metrics?: DashboardMetrics;
  timestamp?: string;
  loadError?: string;
}

export declare function OverviewTrigger({
  metrics = { totalItems: 0, totalStock: 0, totalValue: 0, lowStockCount: 0, categoriesCount: 0 },
  timestamp = '',
  loadError
}: OverviewViewProps): Element;

// ============================================================================
// MODULE: src/slices/inventory/_layout.tsx
// ============================================================================
export declare function InventoryDomainLayout({
  children,
  url = ''
}: {
  children: ReactNode;
  url?: string;
  session?: any;
}): Element;

// ============================================================================
// MODULE: src/slices/inventory/create-item.slice.tsx
// ============================================================================
export declare const CreateItemInputSchema: { name: string; sku: string; category: string; price: number; stock: number; status: "active" | "low_stock" | "archived"; };
export type CreateItemInput = Static<typeof CreateItemInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS inventory (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    sku TEXT NOT NULL,\n    category TEXT NOT NULL,\n    price REAL NOT NULL,\n    stock REAL NOT NULL,\n    status TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n  );\n\n  -- down:\n  DROP TABLE IF E...;
export type CreateItemOutput = Result<
  { id: string } & CreateItemInput,
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'PERSISTENCE_FAILED'
>;

export declare function createItemAction(payload: unknown, db: DatabaseClient, session: SessionContext): Promise<CreateItemOutput>;
export interface CreateItemTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateItemOutput>;
}

export declare function CreateItemTrigger({ onSubmitAction }: CreateItemTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/inventory/delete-item.slice.tsx
// ============================================================================
export declare const DeleteItemInputSchema: { id: string; };
export type DeleteItemInput = Static<typeof DeleteItemInputSchema>;

export type DeleteItemOutput = Result<
  { id: string; deleted: true },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
>;

export declare function deleteItemAction(payload: unknown, db: DatabaseClient, session: SessionContext): Promise<DeleteItemOutput>;
export interface DeleteItemTriggerProps {
  id?: string;
  onSubmitAction?: (payload: unknown) => Promise<DeleteItemOutput>;
}

export declare function DeleteItemTrigger({ id = '', onSubmitAction }: DeleteItemTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/inventory/list-items.slice.tsx
// ============================================================================
export declare const ListItemsInputSchema: { category?: string | undefined; query?: string | undefined; limit?: number | undefined; offset?: number | undefined; };
export type ListItemsInput = Static<typeof ListItemsInputSchema>;

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

export declare function listItemsAction(payload: unknown, db: DatabaseClient, _session: SessionContext): Promise<ListItemsOutput>;
export declare function ListItemsLoader(context: SliceLoaderContext): Promise<{ rows: InventoryRow[]; total: number; loadError?: string; query?: string }>;
export interface ListItemsViewProps {
  rows?: InventoryRow[];
  total?: number;
  loadError?: string;
  query?: string;
  limit?: number;
}

export declare function ListItemsTrigger({
  rows = [],
  total = 0,
  loadError,
  query = '',
  limit = DEFAULT_LIMIT
}: ListItemsViewProps): Element;

// ============================================================================
// MODULE: src/slices/inventory/update-item.slice.tsx
// ============================================================================
export declare const UpdateItemInputSchema: { name?: string | undefined; price?: number | undefined; stock?: number | undefined; status?: "active" | "low_stock" | "archived" | undefined; id: string; };
export type UpdateItemInput = Static<typeof UpdateItemInputSchema>;

export type UpdateItemOutput = Result<
  { id: string; updated: number },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOTHING_TO_UPDATE' | 'NOT_FOUND'
>;

export declare function updateItemAction(payload: unknown, db: DatabaseClient, session: SessionContext): Promise<UpdateItemOutput>;
export interface UpdateItemTriggerProps {
  id?: string;
  onSubmitAction?: (payload: unknown) => Promise<UpdateItemOutput>;
}

export declare function UpdateItemTrigger({ id = '', onSubmitAction }: UpdateItemTriggerProps): Element;

