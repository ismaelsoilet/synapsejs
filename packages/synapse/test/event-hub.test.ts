import { describe, expect, test } from 'bun:test';
import { createActionContext, MockDatabaseClient } from '../src/core';
import { AnonymousSession } from '../src/core/session-context';
import { defineTopic, resetDeclaredTopics } from '../src/core/topics';
import { EventHub, getEventHub, resetEventHub } from '../src/runtime/event-hub';

describe('EventHub - In-Memory Realtime Pub/Sub Broker', () => {
  test('subscribes and notifies listeners on matching topic', () => {
    const hub = new EventHub();
    const received: unknown[] = [];

    const unsubscribe = hub.subscribe('tickets', (data) => {
      received.push(data);
    });

    expect(hub.listenerCount('tickets')).toBe(1);

    const notified = hub.publish('tickets', { id: 'ticket_1', status: 'OPEN' });
    expect(notified).toBe(1);
    expect(received).toEqual([{ id: 'ticket_1', status: 'OPEN' }]);

    unsubscribe();
    expect(hub.listenerCount('tickets')).toBe(0);

    const notifiedAfter = hub.publish('tickets', { id: 'ticket_2' });
    expect(notifiedAfter).toBe(0);
    expect(received.length).toBe(1);
  });

  test('isolates different topics without cross-contamination', () => {
    const hub = new EventHub();
    const tickets: unknown[] = [];
    const invoices: unknown[] = [];

    hub.subscribe('tickets', (data) => tickets.push(data));
    hub.subscribe('invoices', (data) => invoices.push(data));

    hub.publish('tickets', { ticketId: 't-1' });
    hub.publish('invoices', { invoiceId: 'inv-100' });

    expect(tickets).toEqual([{ ticketId: 't-1' }]);
    expect(invoices).toEqual([{ invoiceId: 'inv-100' }]);
  });

  test('survives listener error without crashing or blocking subsequent listeners', () => {
    const hub = new EventHub();
    const results: string[] = [];

    hub.subscribe('events', () => {
      throw new Error('Simulated listener explosion');
    });

    hub.subscribe('events', (data) => {
      results.push(String(data));
    });

    const notified = hub.publish('events', 'payload_success');
    expect(notified).toBe(1);
    expect(results).toEqual(['payload_success']);
  });

  test('ActionContext.broadcast delivers real-time event to declared subscribers', () => {
    resetEventHub();
    resetDeclaredTopics();
    defineTopic({ name: 'crm/customers', owner: 'crm/register-customer' });

    const hub = getEventHub();
    const events: unknown[] = [];

    hub.subscribe('global:crm/customers', (data) => events.push(data));

    const mockDb = new MockDatabaseClient();
    const ctx = createActionContext({
      db: mockDb,
      session: AnonymousSession(),
      sliceOwner: 'crm/register-customer'
    });

    const delivered = ctx.broadcast('crm/customers', { customerId: 'cust-99', name: 'Acme Corp' });
    expect(delivered).toBe(1);
    expect(events).toEqual([{ customerId: 'cust-99', name: 'Acme Corp' }]);

    // A feature that does not own the topic notifies nobody.
    const foreign = createActionContext({
      db: mockDb,
      session: AnonymousSession(),
      sliceOwner: 'billing/charge'
    });
    expect(foreign.broadcast('crm/customers', { customerId: 'nope' })).toBe(0);
    expect(events.length).toBe(1);

    resetDeclaredTopics();
    resetEventHub();
  });
});
