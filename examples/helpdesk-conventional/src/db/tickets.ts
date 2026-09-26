import { Database } from 'bun:sqlite';

export const TICKETS_DDL = `
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    priority INTEGER NOT NULL,
    requester_email TEXT NOT NULL,
    assignee TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export function openDatabase(filePath = ':memory:'): Database {
  const db = new Database(filePath);
  db.run('PRAGMA journal_mode = WAL;');
  db.run(TICKETS_DDL);
  return db;
}

export function insertTicket(
  db: Database,
  ticket: { id: string; subject: string; priority: number; requesterEmail: string }
): void {
  db.query(`INSERT INTO tickets (id, subject, priority, requester_email, status) VALUES ($1, $2, $3, $4, $5)`).run(
    ticket.id,
    ticket.subject,
    ticket.priority,
    ticket.requesterEmail,
    'OPEN'
  );
}

export function findTicketById(db: Database, id: string): { id: string } | null {
  return db.query<{ id: string }, [string]>(`SELECT id FROM tickets WHERE id = $1`).get(id) ?? null;
}

export function updateTicketAssignee(db: Database, id: string, assignee: string): void {
  db.query(`UPDATE tickets SET assignee = $1, status = $2 WHERE id = $3`).run(assignee, 'ASSIGNED', id);
}
