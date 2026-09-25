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

  cachedInstance = sqlite;
  return cachedInstance;
}

export function resetDatabaseInstance(): void {
  cachedInstance = null;
}
