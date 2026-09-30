import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  type ActionContext,
  AnonymousSession,
  createActionContext,
  createSession,
  defineConfig,
  loadSynapseConfig,
  MockDatabaseClient
} from '../src/core';

describe('ActionContext & Service Extensibility', () => {
  test('creates an ActionContext with duck-typed DatabaseClient interface', async () => {
    const mockDb = new MockDatabaseClient();
    mockDb.onQuery('SELECT * FROM users', () => [{ id: 'u1', name: 'Alice' }]);

    const session = createSession({
      userId: 'user-123',
      tenantId: 'org-acme',
      roles: ['admin']
    });

    const customServices = {
      mailer: { send: () => true },
      stripe: { charge: () => 'ch_123' }
    };

    let enqueuedJob: { name: string; payload: unknown } | null = null;

    const ctx: ActionContext<typeof customServices> = createActionContext({
      db: mockDb,
      session,
      services: customServices,
      enqueue: async (job, payload) => {
        enqueuedJob = {
          name: typeof job === 'string' ? job : job.name,
          payload
        };
        return 'job-1';
      }
    });

    // 1. DatabaseClient interface works directly on ctx
    const users = await ctx.query('SELECT * FROM users');
    expect(users).toEqual([{ id: 'u1', name: 'Alice' }]);

    const user = await ctx.queryOne('SELECT * FROM users');
    expect(user).toEqual({ id: 'u1', name: 'Alice' });

    // 2. Session and Tenant properties
    expect(ctx.session.userId).toBe('user-123');
    expect(ctx.session.tenantId).toBe('org-acme');
    expect(ctx.tenantId).toBe('org-acme');

    // 3. Extensible Services
    expect(ctx.services.mailer.send()).toBe(true);
    expect(ctx.services.stripe.charge()).toBe('ch_123');

    // 4. Background Job Enqueue
    const jobId = await ctx.enqueue('send-email', { to: 'alice@example.com' });
    expect(jobId).toBe('job-1');
    expect(enqueuedJob as unknown).toEqual({
      name: 'send-email',
      payload: { to: 'alice@example.com' }
    });

    // 5. Logger methods exist
    expect(typeof ctx.logger.info).toBe('function');
    expect(typeof ctx.logger.error).toBe('function');
  });

  test('falls back to default anonymous session and noop defaults when minimal options provided', () => {
    const mockDb = new MockDatabaseClient();
    const session = AnonymousSession();

    const ctx = createActionContext({
      db: mockDb,
      session
    });

    expect(ctx.session.isAuthenticated).toBe(false);
    expect(ctx.tenantId).toBeUndefined();
    expect(ctx.services).toEqual({});
  });

  test('defineConfig returns the configuration object as-is with type safety', () => {
    const config = defineConfig({
      services: {
        cache: new Map()
      }
    });

    expect(config.services).toBeDefined();
    if (typeof config.services === 'object' && config.services !== null) {
      expect(config.services.cache).toBeInstanceOf(Map);
    }
  });

  test('loadSynapseConfig gracefully returns empty config if synapse.config.ts is missing', async () => {
    const config = await loadSynapseConfig('/non-existent-dir');
    expect(config).toEqual({});
  });

  test('loadSynapseConfig treats a broken configuration file as fatal', async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-config-'));
    fs.writeFileSync(path.join(sandbox, 'synapse.config.ts'), 'export default { this is not valid typescript', 'utf-8');

    // A config file that cannot be loaded must not degrade to defaults: it carries
    // security-relevant settings nobody would have chosen.
    await expect(loadSynapseConfig(sandbox)).rejects.toThrow(/falha ao carregar/);

    fs.rmSync(sandbox, { recursive: true, force: true });
  });
});
