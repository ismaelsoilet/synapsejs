/**
 * [SYNAPSE-JS AUTO-GENERATED DATABASE SCHEMA CATALOG]
 * Provides 100% type-safe table and column definitions extracted directly from slice DDLs.
 * Regenerate with 'synapse skeleton' or 'synapse db-schema'. DO NOT EDIT MANUALLY.
 */

export interface DbInventory {
  id: string; /** Primary Key */
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  status: string;
  created_at?: string | null;
}

export interface DatabaseSchema {
  inventory: DbInventory;
}

export type TableName = keyof DatabaseSchema;
export type Row<T extends TableName> = DatabaseSchema[T];
