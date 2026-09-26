import { Value } from '@sinclair/typebox/value';
import type { Database } from 'bun:sqlite';
import { findTicketById, insertTicket, updateTicketAssignee } from '../db/tickets';
import { AssignTicketSchema, CreateTicketSchema, type Ticket } from '../schemas/ticket';

export type ServiceResult<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export type Session = { userId: string; roles: string[] };

function isSupport(session?: Session): boolean {
  return Boolean(session && session.roles.includes('support'));
}

export function createTicket(
  payload: unknown,
  db: Database,
  session?: Session
): ServiceResult<{ ticketId: string; status: 'OPEN' }, 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_SCHEMA'> {
  if (!session) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }
  if (!isSupport(session)) {
    return { ok: false, error: 'FORBIDDEN' };
  }
  if (!Value.Check(CreateTicketSchema, payload)) {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  const input = payload as { subject: string; priority: number; requesterEmail: string };
  const ticketId = crypto.randomUUID();
  insertTicket(db, { id: ticketId, ...input });

  return { ok: true, value: { ticketId, status: 'OPEN' } };
}

export function assignTicket(
  payload: unknown,
  db: Database,
  session?: Session
): ServiceResult<{ ticketId: string; assignee: string; status: 'ASSIGNED' }, 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_SCHEMA' | 'TICKET_NOT_FOUND'> {
  if (!session) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }
  if (!isSupport(session)) {
    return { ok: false, error: 'FORBIDDEN' };
  }
  if (!Value.Check(AssignTicketSchema, payload)) {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  const input = payload as { ticketId: string; assignee: string };
  if (!findTicketById(db, input.ticketId)) {
    return { ok: false, error: 'TICKET_NOT_FOUND' };
  }

  updateTicketAssignee(db, input.ticketId, input.assignee);
  return { ok: true, value: { ticketId: input.ticketId, assignee: input.assignee, status: 'ASSIGNED' } };
}

export function listTickets(db: Database): Ticket[] {
  return db
    .query<
      { id: string; subject: string; priority: number; requester_email: string; assignee: string | null; status: 'OPEN' | 'ASSIGNED' },
      []
    >(`SELECT id, subject, priority, requester_email, assignee, status FROM tickets`)
    .all()
    .map((row) => ({
      id: row.id,
      subject: row.subject,
      priority: row.priority,
      requesterEmail: row.requester_email,
      assignee: row.assignee,
      status: row.status
    }));
}
