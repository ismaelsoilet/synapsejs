// [SYNAPSE-JS AUTO-GENERATED SKELETON MAP]
// STRICT CONTRACTS, ALGEBRAIC TYPES AND FUNCTION SIGNATURES ONLY.
// Regenerate with 'synapse skeleton' — output is deterministic and committed.
// NOT COMPILABLE: this is a signature digest for LLM context, not a .d.ts module.
// It carries no imports and names repeat across modules by design.

// ============================================================================
// MODULE: src/slices/billing/generate-invoice.slice.tsx
// ============================================================================
export declare const InvoiceInputSchema: { customerId: string; amountCents: number; taxRate: number; idempotencyToken: string; };
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS invoices (\n    id TEXT PRIMARY KEY,\n    customer_id TEXT NOT NULL,\n    base_cents INTEGER NOT NULL,\n    tax_rate REAL NOT NULL,\n    total_cents INTEGER NOT NULL,\n    idempotency_key TEXT UNIQUE NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    FOREIGN KEY (cust...;
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

export declare function createInvoiceAction(payload: unknown, db: DatabaseClient, session: SessionContext): Promise<InvoiceOutput>;
export interface InvoiceTriggerProps {
  /** Vem do loader abaixo, ou da query string, ou do formulário. */
  customerId?: string;
  onSubmitAction?: (payload: unknown) => Promise<InvoiceOutput>;
}

export declare function GenerateInvoiceLoader(context: {
  db: DatabaseClient;
  session: SessionContext;
}): Promise<{ customerId?: string }>;
export declare function InvoiceTrigger({ customerId = 'cust-sem-selecao', onSubmitAction }: InvoiceTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/catalog/products.slice.tsx
// ============================================================================
export declare const CatalogInputSchema: { category?: string | undefined; };
export type CatalogInput = Static<typeof CatalogInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS catalog_products (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    category TEXT NOT NULL,\n    price_cents INTEGER NOT NULL\n  );\n";
export declare function catalogProductsLoader(context: {
  params: Record<string, string>;
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> };
}): Promise<{ products: { id: string; name: string; }[]; }>;
export type CatalogRefreshOutput = Result<{ refreshed: boolean }, 'NO_CONTEXT'>;

export declare function catalogRefreshAction(_payload: unknown, _db: unknown, _session: unknown, ctx: { invalidateCache?: (tags?: string[]) => void }): Promise<CatalogRefreshOutput>;
export interface CatalogViewProps {
  products?: Array<{ id: string; name: string }>;
}

export declare function CatalogView({ products = [] }: CatalogViewProps): Element;

// ============================================================================
// MODULE: src/slices/chat/room.slice.tsx
// ============================================================================
export declare const RoomInputSchema: { room: string; };
export type RoomInput = Static<typeof RoomInputSchema>;

export type AnnounceOutput = Result<{ notified: number }, 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_SCHEMA'>;

export declare function announceRoomAction(payload: unknown, _db: unknown, session: SessionContext, ctx: { broadcast: (topic: string, data: unknown) => number }): Promise<AnnounceOutput>;
export interface RoomViewProps {
  room?: string;
}

export declare function RoomView({ room = 'lobby' }: RoomViewProps): Element;

// ============================================================================
// MODULE: src/slices/customers/create-customer.slice.tsx
// ============================================================================
export declare const CustomerInputSchema: { name: string; email: string; taxId: string; };
export type CustomerInput = Static<typeof CustomerInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS customers (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    email TEXT NOT NULL UNIQUE,\n    tax_id TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n  );\n\n  -- down:\n  DELETE FROM invoices WHERE customer_id IN (SELECT id FROM customers);\n  DROP TABLE IF ...;
export type CustomerOutput = Result<
  { customerId: string; name: string; email: string; taxId: string; status: 'ACTIVE' },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'DUPLICATE_EMAIL' | 'DUPLICATE_TAX_ID'
>;

export declare function createCustomerAction(payload: unknown, db: DatabaseClient): Promise<CustomerOutput>;
export interface CustomerTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CustomerOutput>;
}

export declare function CustomerTrigger({ onSubmitAction }: CustomerTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/jobs/enqueue-welcome-email.slice.tsx
// ============================================================================
export declare const WelcomeEmailInputSchema: { customerId: string; email: string; };
export type WelcomeEmailInput = Static<typeof WelcomeEmailInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS welcome_emails (\n    id TEXT PRIMARY KEY,\n    customer_id TEXT NOT NULL,\n    email TEXT NOT NULL,\n    status TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n  );\n";
export type WelcomeEmailOutput = Result<{ jobId: string }, 'INVALID_SCHEMA' | 'NO_DATABASE' | 'QUEUE_FAILED'>;

export declare function enqueueWelcomeEmailAction(payload: unknown, db: DatabaseClient, _session: unknown, ctx: ActionContext): Promise<WelcomeEmailOutput>;
export interface WelcomeEmailTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<WelcomeEmailOutput>;
}

export declare function WelcomeEmailTrigger({ onSubmitAction }: WelcomeEmailTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/products/create-product.slice.tsx
// ============================================================================
export declare const CreateProductInputSchema: { metadata?: string | undefined; name: string; email: string; };
export type CreateProductInput = Static<typeof CreateProductInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS products (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    email TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n  );\n";
export type CreateProductOutput = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

export declare function createProductAction(payload: unknown, db: DatabaseClient): Promise<CreateProductOutput>;
export interface CreateProductTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateProductOutput>;
}

export declare function CreateProductTrigger({ onSubmitAction }: CreateProductTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/webhooks/stripe-payment.slice.tsx
// ============================================================================
export declare const PaymentWebhookInputSchema: { amountCents: number; id: string; };
export type PaymentWebhookInput = Static<typeof PaymentWebhookInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS payment_deliveries (\n    delivery_id TEXT PRIMARY KEY,\n    amount_cents INTEGER NOT NULL,\n    signature TEXT NOT NULL,\n    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n  );\n";
export declare function paymentWebhookSecret(): string | undefined;
export type PaymentWebhookResult = Result<
  { deliveryId: string; status: 'ACCEPTED' | 'DUPLICATE' },
  'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_WINDOW' | 'REPLAYED_DELIVERY' | 'NO_SECRET' | 'INVALID_PAYLOAD'
>;

export declare function stripePaymentWebhook(event: WebhookEvent<PaymentWebhookInput>, ctx: ActionContext): Promise<{ ok: boolean; error?: string; deliveryId?: string }>;
export type PaymentAuditOutput = Result<{ deliveries: number }, 'NO_DATABASE'>;

export declare function paymentAuditAction(_payload: unknown, db: DatabaseClient): Promise<PaymentAuditOutput>;
export interface PaymentAuditViewProps {
  deliveries?: number;
}

export declare function PaymentAuditView({ deliveries = 0 }: PaymentAuditViewProps): Element;

