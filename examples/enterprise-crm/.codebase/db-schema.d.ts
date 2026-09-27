/**
 * [SYNAPSE-JS AUTO-GENERATED DATABASE SCHEMA CATALOG]
 * Provides 100% type-safe table and column definitions extracted directly from slice DDLs.
 * Regenerate with 'synapse skeleton' or 'synapse db-schema'. DO NOT EDIT MANUALLY.
 */

export interface DbCustomers {
  id: string; /** Primary Key */
  name: string;
  email: string;
  tax_id: string;
  created_at?: string | null;
}

export interface DbProducts {
  id: string; /** Primary Key */
  name: string;
  email?: string | null;
  created_at?: string | null;
}

export interface DbInvoices {
  id: string; /** Primary Key */
  customer_id: string;
  base_cents: number;
  tax_rate: number;
  total_cents: number;
  idempotency_key: string;
  created_at?: string | null;
}

export interface DatabaseSchema {
  customers: DbCustomers;
  products: DbProducts;
  invoices: DbInvoices;
}

export type TableName = keyof DatabaseSchema;
export type Row<T extends TableName> = DatabaseSchema[T];
