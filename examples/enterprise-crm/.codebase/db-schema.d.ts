/**
 * [SYNAPSE-JS AUTO-GENERATED DATABASE SCHEMA CATALOG]
 * Provides 100% type-safe table and column definitions extracted directly from slice DDLs.
 * Regenerate with 'synapse skeleton' or 'synapse db-schema'. DO NOT EDIT MANUALLY.
 */

export interface DbCatalogProducts {
  id: string; /** Primary Key */
  name: string;
  category: string;
  price_cents: number;
}

export interface DbCustomers {
  id: string; /** Primary Key */
  name: string;
  email: string;
  tax_id: string;
  created_at?: string | null;
}

export interface DbWelcomeEmails {
  id: string; /** Primary Key */
  customer_id: string;
  email: string;
  status: string;
  created_at?: string | null;
}

export interface DbProducts {
  id: string; /** Primary Key */
  name: string;
  email?: string | null;
  created_at?: string | null;
}

export interface DbPaymentDeliveries {
  delivery_id: string; /** Primary Key */
  amount_cents: number;
  signature: string;
  received_at?: string | null;
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
  catalog_products: DbCatalogProducts;
  customers: DbCustomers;
  welcome_emails: DbWelcomeEmails;
  products: DbProducts;
  payment_deliveries: DbPaymentDeliveries;
  invoices: DbInvoices;
}

export type TableName = keyof DatabaseSchema;
export type Row<T extends TableName> = DatabaseSchema[T];
