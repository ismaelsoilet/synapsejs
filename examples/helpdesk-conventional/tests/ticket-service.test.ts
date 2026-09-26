import { beforeEach, describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDatabase } from '../src/db/tickets';
import { assignTicket, createTicket, listTickets } from '../src/services/ticket-service';

const support = { userId: 'u1', roles: ['support'] };
const viewer = { userId: 'u2', roles: ['viewer'] };

const validTicket = { subject: 'Impressora não imprime', priority: 2, requesterEmail: 'a@b.com' };

let db: Database;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('createTicket', () => {
  it('rejects callers without a session', () => {
    expect(createTicket(validTicket, db)).toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('rejects callers without the support role', () => {
    expect(createTicket(validTicket, db, viewer)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('rejects an invalid payload', () => {
    expect(createTicket({ subject: 'ab', priority: 9, requesterEmail: 'nope' }, db, support)).toEqual({
      ok: false,
      error: 'INVALID_SCHEMA'
    });
  });

  it('creates an open ticket', () => {
    const result = createTicket(validTicket, db, support);

    expect(result.ok).toBe(true);
    expect(listTickets(db).length).toBe(1);
    expect(listTickets(db)[0].status).toBe('OPEN');
  });
});

describe('assignTicket', () => {
  it('reports an unknown ticket', () => {
    expect(assignTicket({ ticketId: 'ticket-inexistente-1', assignee: 'Ana' }, db, support)).toEqual({
      ok: false,
      error: 'TICKET_NOT_FOUND'
    });
  });

  it('assigns an existing ticket', () => {
    const created = createTicket(validTicket, db, support);
    if (!created.ok) {
      throw new Error('fixture inválida');
    }

    const assigned = assignTicket({ ticketId: created.value.ticketId, assignee: 'Ana' }, db, support);

    expect(assigned.ok).toBe(true);
    expect(listTickets(db)[0].assignee).toBe('Ana');
    expect(listTickets(db)[0].status).toBe('ASSIGNED');
  });
});
