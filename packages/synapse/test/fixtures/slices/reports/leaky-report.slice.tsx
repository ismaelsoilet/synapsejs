import React from 'react';
import { type DatabaseClient, Ok, type Result } from 'synapsejs';

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY
  );
`;

export type ReportOutput = Result<{ id: string }, 'PERSISTENCE_FAILED'>;

export async function refreshReportAction(payload: unknown, db: DatabaseClient): Promise<ReportOutput> {
  await db.query(`INSERT INTO reports (id) VALUES ($1)`, ['report-1']);
  return Ok({ id: 'report-1' });
}

export function LeakyReportTrigger({ db }: { db: DatabaseClient }) {
  const load = async () => {
    await db.query('SELECT * FROM reports');
  };

  return (
    <button type="button" onClick={load}>
      Recarregar
    </button>
  );
}
