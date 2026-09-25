import React from 'react';
import { Ok, type DatabaseClient, type Result } from 'synapsejs';

export type BrokenOutput = Result<{ id: string }, 'PERSISTENCE_FAILED'>;

export async function brokenAction(payload: unknown, db: DatabaseClient): Promise<BrokenOutput> {
  void payload;
  void db;
  return Ok({ id: 'broken-1' });
}

export function BrokenTrigger() {
  return <span>{missingSymbolFromNowhere}</span>;
}
