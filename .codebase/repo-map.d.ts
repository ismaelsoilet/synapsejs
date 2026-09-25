// [SYNAPSE-JS AUTO-GENERATED SKELETON MAP]
// STRICT CONTRACTS, ALGEBRAIC TYPES AND FUNCTION SIGNATURES ONLY.
// GENERATED AT: 2026-09-25T20:14:11.256Z

// ============================================================================
// MODULE: src/core/database-client.ts
// ============================================================================
export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseClient {
  /**
   * Execute parameterized SQL query with explicit generic return type.
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute single-row query, returning null if not found.
   */
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute command inside a database transaction boundary.
   */
  transaction<T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T>;
}


// ============================================================================
// MODULE: src/core/machine-types.ts
// ============================================================================
export type Ok<T> = {
  readonly ok: true;
  readonly value: T;
};

export type Err<E> = {
  readonly ok: false;
  readonly error: E;
};

export type Result<T, E> = Ok<T> | Err<E>;

export declare function Ok(value: T): Ok<T>;
export declare function Err(error: E): Err<E>;
export declare function isOk(result: Result<T, E>): result is Ok<T>;
export declare function isErr(result: Result<T, E>): result is Err<E>;
export declare function unwrap(result: Result<T, E>): T;
export declare function unwrapOr(result: Result<T, E>, fallback: T): T;
export declare function map(result: Result<T, E>, fn: (val: T) => U): Result<U, E>;
export declare function mapErr(result: Result<T, E>, fn: (err: E) => F): Result<T, F>;
export type Option<T> =
  | { readonly hasValue: true; readonly value: T }
  | { readonly hasValue: false };

export declare function Some(value: T): Option<T>;
export declare function None(): Option<T>;

// ============================================================================
// MODULE: src/core/sqlite-client.ts
// ============================================================================
export declare function getDatabase(dbPath: string): SqliteDatabaseClient;

// ============================================================================
// MODULE: src/core/index.ts
// ============================================================================

// ============================================================================
// MODULE: src/slices/billing/generate-invoice.slice.tsx
// ============================================================================
export declare const InvoiceInputSchema: any;
export type InvoiceInput = Static<typeof InvoiceInputSchema>;

export type InvoiceOutput = Result<
  { invoiceId: string; totalWithTax: number; status: 'GENERATED' },
  'INVALID_SCHEMA' | 'DUPLICATE_IDEMPOTENCY' | 'CUSTOMER_NOT_FOUND'
>;

export declare function createInvoiceAction(payload: unknown, db: DatabaseClient): Promise<InvoiceOutput>;
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

export type CreateProductOutput = Result<
  { id: string; name: string; email: string; createdAt: string },
  'INVALID_SCHEMA' | 'DUPLICATE_EMAIL' | 'PERSISTENCE_FAILED'
>;

export declare function createProductAction(payload: unknown, db: DatabaseClient): Promise<CreateProductOutput>;
export interface CreateProductTriggerProps {
  onSubmitAction?: (payload: unknown) => Promise<CreateProductOutput>;
}

export declare function CreateProductTrigger({ onSubmitAction }: CreateProductTriggerProps): Element;

