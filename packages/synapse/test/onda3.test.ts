import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { createTranslator } from '../src/client/i18n';
import { PostgresEventHub } from '../src/runtime/postgres-event-hub';
import { SynapseServer } from '../src/runtime/server';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/runtime-app');

describe('Onda 3: Isomorphic i18n Translation Primitive', () => {
  const dictionary = {
    'pt-BR': {
      welcome: 'Olá, {name}!',
      summary: 'Você possui {count} notificações não lidas.',
      only_pt: 'Disponível apenas em português'
    },
    en: {
      welcome: 'Hello, {name}!',
      summary: 'You have {count} unread notifications.'
    }
  };

  it('translates with parameter interpolation in current locale', () => {
    const t = createTranslator(dictionary, 'pt-BR');
    expect(t('welcome', { name: 'Maria' })).toBe('Olá, Maria!');
    expect(t('summary', { count: 5 })).toBe('Você possui 5 notificações não lidas.');
  });

  it('translates using secondary language dictionary', () => {
    const t = createTranslator(dictionary, 'en');
    expect(t('welcome', { name: 'John' })).toBe('Hello, John!');
    expect(t('summary', { count: 3 })).toBe('You have 3 unread notifications.');
  });

  it('falls back gracefully to fallbackLocale when key is missing in active locale', () => {
    const t = createTranslator(dictionary, 'en', 'pt-BR');
    expect(t('only_pt')).toBe('Disponível apenas em português');
  });

  it('returns the raw key when translation is absent in all dictionaries', () => {
    const t = createTranslator(dictionary, 'fr', 'pt-BR');
    expect(t('unknown_key')).toBe('unknown_key');
  });
});

describe('Onda 3: Localized Slice Routing in SynapseServer', () => {
  let synapse: SynapseServer;
  let server: { port: number; stop: () => void };
  let baseUrl: string;

  beforeAll(async () => {
    synapse = new SynapseServer(FIXTURE_DIR, 0);
    await synapse.discoverSlices();
    server = (await synapse.start()) as unknown as { port: number; stop: () => void };
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server?.stop();
  });

  it('resolves direct slice route with default pt-BR locale', async () => {
    const res = await fetch(`${baseUrl}/tickets/view-tickets`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="pt-BR"');
  });

  it('resolves localized /en prefix to the correct slice and sets html lang="en"', async () => {
    const res = await fetch(`${baseUrl}/en/tickets/view-tickets`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('LOADER-TICKETS');
  });

  it('resolves localized /pt-BR prefix and sets html lang="pt-BR"', async () => {
    const res = await fetch(`${baseUrl}/pt-BR/tickets/view-tickets`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="pt-BR"');
    expect(html).toContain('LOADER-TICKETS');
  });

  it('returns 404 when localized route does not match any slice', async () => {
    const res = await fetch(`${baseUrl}/en/nonexistent/slice`);
    expect(res.status).toBe(404);
  });
});

describe('Onda 3: Distributed PostgresEventHub Architecture', () => {
  it('instantiates with unique instanceId and exposes options', () => {
    const hub1 = new PostgresEventHub({ connectionUri: 'postgres://localhost:5432/test' });
    const hub2 = new PostgresEventHub({ connectionUri: 'postgres://localhost:5432/test' });

    expect(typeof hub1.instanceId).toBe('string');
    expect(typeof hub2.instanceId).toBe('string');
    expect(hub1.instanceId).not.toBe(hub2.instanceId);
  });

  it('delivers events locally to in-process subscribers via publish', () => {
    const hub = new PostgresEventHub({ connectionUri: 'postgres://localhost:5432/test' });
    const received: any[] = [];

    const unsub = hub.subscribe('orders:created', (data) => {
      received.push(data);
    });

    const notifiedCount = hub.publish('orders:created', { id: 'ord_123', amount: 99.9 });
    expect(notifiedCount).toBe(1);
    expect(received).toEqual([{ id: 'ord_123', amount: 99.9 }]);

    unsub();
    hub.publish('orders:created', { id: 'ord_456' });
    expect(received.length).toBe(1);
  });
});
