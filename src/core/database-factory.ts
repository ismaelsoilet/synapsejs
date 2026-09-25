/**
 * SynapseJS - Universal Database Factory
 * 
 * Auto-detects the database engine from DATABASE_URL:
 * - If postgres:// or postgresql:// -> Instantiates PostgresDatabaseClient
 * - Otherwise -> Instantiates embedded SqliteDatabaseClient
 */

import * as path from 'path';
import type { DatabaseClient } from './database-client';
import { SqliteDatabaseClient } from './sqlite-client';
import { PostgresDatabaseClient } from './postgres-client';

let cachedInstance: DatabaseClient | null = null;

export function getDatabase(connectionUri?: string): DatabaseClient {
  if (cachedInstance) {
    return cachedInstance;
  }

  const uri = connectionUri || process.env.DATABASE_URL;

  if (uri && (uri.startsWith('postgres://') || uri.startsWith('postgresql://'))) {
    cachedInstance = new PostgresDatabaseClient(uri);
    return cachedInstance;
  }

  // Fallback to embedded SQLite
  const dbPath = uri || path.join(process.cwd(), '.synapse/synapse.sqlite');
  const sqlite = new SqliteDatabaseClient(dbPath);

  // Initialize base tables if not yet created
  sqlite.initSchema(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      tax_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      base_cents INTEGER NOT NULL,
      tax_rate REAL NOT NULL,
      total_cents INTEGER NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `);

  cachedInstance = sqlite;
  return cachedInstance;
}

export function resetDatabaseInstance(): void {
  cachedInstance = null;
}
