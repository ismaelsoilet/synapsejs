// [SYNAPSE-JS AUTO-GENERATED SKELETON MAP]
// STRICT CONTRACTS, ALGEBRAIC TYPES AND FUNCTION SIGNATURES ONLY.
// GENERATED AT: 2026-09-25T22:47:12.706Z

// ============================================================================
// MODULE: src/slices/billing/generate-invoice.slice.tsx
// ============================================================================
export declare const InvoiceInputSchema: { customerId: string; amountCents: number; taxRate: number; idempotencyToken: string; };
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS invoices (\n    id TEXT PRIMARY KEY,\n    customer_id TEXT NOT NULL,\n    base_cents INTEGER NOT NULL,\n    tax_rate REAL NOT NULL,\n    total_cents INTEGER NOT NULL,\n    idempotency_key TEXT UNIQUE NOT NULL,\n    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n    FOREIGN KEY (custo...;
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

export declare function createInvoiceAction(payload: unknown, db: DatabaseClient, session: SessionContext): Promise<InvoiceOutput>;
export interface InvoiceTriggerProps {
  customerId: string;
  onSubmitAction?: (payload: unknown) => Promise<InvoiceOutput>;
}

export declare function InvoiceTrigger({ customerId, onSubmitAction }: InvoiceTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/customers/create-customer.slice.tsx
// ============================================================================
export declare const CustomerInputSchema: { name: string; email: string; taxId: string; };
export type CustomerInput = Static<typeof CustomerInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS customers (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    email TEXT NOT NULL UNIQUE,\n    tax_id TEXT NOT NULL,\n    created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n  );\n";
export type CustomerOutput = Result<
  { customerId: string; name: string; email: string; taxId: string; status: 'ACTIVE' },
  'INVALID_SCHEMA' | 'DUPLICATE_EMAIL' | 'DUPLICATE_TAX_ID'
>;

export declare function createCustomerAction(payload: unknown, db: DatabaseClient): Promise<CustomerOutput>;
export interface CustomerTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CustomerOutput>;
}

export declare function CustomerTrigger({ onSubmitAction }: CustomerTriggerProps): Element;

// ============================================================================
// MODULE: src/slices/products/create-product.slice.tsx
// ============================================================================
export declare const CreateProductInputSchema: { metadata?: string | undefined; name: string; email: string; };
export type CreateProductInput = Static<typeof CreateProductInputSchema>;

export declare const sliceSchema: "\n  CREATE TABLE IF NOT EXISTS products (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    email TEXT,\n    created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n  );\n";
export type CreateProductOutput = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

export declare function createProductAction(payload: unknown, db: DatabaseClient): Promise<CreateProductOutput>;
export interface CreateProductTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateProductOutput>;
}

export declare function CreateProductTrigger({ onSubmitAction }: CreateProductTriggerProps): Element;

