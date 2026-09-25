// [SYNAPSE-JS AUTO-GENERATED SKELETON MAP]
// STRICT CONTRACTS, ALGEBRAIC TYPES AND FUNCTION SIGNATURES ONLY.
// GENERATED AT: 2026-09-25T22:00:32.333Z

// ============================================================================
// MODULE: src/slices/billing/generate-invoice.slice.tsx
// ============================================================================
export declare const InvoiceInputSchema: any;
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

export declare const sliceSchema: any;
export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
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
export declare const CustomerInputSchema: any;
export type CustomerInput = Static<typeof CustomerInputSchema>;

export declare const sliceSchema: any;
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
export declare const CreateProductInputSchema: any;
export type CreateProductInput = Static<typeof CreateProductInputSchema>;

export declare const sliceSchema: any;
export type CreateProductOutput = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

export declare function createProductAction(payload: unknown, db: DatabaseClient): Promise<CreateProductOutput>;
export interface CreateProductTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateProductOutput>;
}

export declare function CreateProductTrigger({ onSubmitAction }: CreateProductTriggerProps): Element;

