import { describe, expect, test } from 'bun:test';
import { defineJob, MockDatabaseClient } from '../src/core';
import { QueueEngine } from '../src/runtime/queue-engine';

describe('Background Jobs & SQLite Queue Engine (Fase B)', () => {
  test('defineJob creates an immutable job definition', () => {
    const job = defineJob<{ email: string }>({
      name: 'send-email',
      retryLimit: 5,
      backoffSeconds: 10,
      handler: async (payload, _ctx) => {
        expect(payload.email).toBe('user@example.com');
      }
    });

    expect(job.name).toBe('send-email');
    expect(job.retryLimit).toBe(5);
    expect(job.backoffSeconds).toBe(10);
    expect(Object.isFrozen(job)).toBe(true);
  });

  test('QueueEngine enqueues and processes a job successfully', async () => {
    const queue = new QueueEngine({ dbPath: ':memory:' });
    const mockDb = new MockDatabaseClient();

    let processedPayload: { email: string } | null = null;
    let actionCtxEnqueued = false;

    const emailJob = defineJob<{ email: string }>({
      name: 'send-welcome',
      handler: async (payload, ctx) => {
        processedPayload = payload;
        // Verify ActionContext is provided
        expect(ctx.db).toBeDefined();
        actionCtxEnqueued = typeof ctx.enqueue === 'function';
      }
    });

    queue.registerJob(emailJob);

    const jobId = await queue.enqueue(emailJob, { email: 'welcome@synapse.dev' });
    expect(jobId).toStartWith('job_');

    const statsBefore = queue.getStats();
    expect(statsBefore.pending).toBe(1);

    const processed = await queue.processNextJob({ db: mockDb });
    expect(processed).toBe(true);
    expect(processedPayload as unknown).toEqual({ email: 'welcome@synapse.dev' });
    expect(actionCtxEnqueued).toBe(true);

    const statsAfter = queue.getStats();
    expect(statsAfter.pending).toBe(0);
    expect(statsAfter.completed).toBe(1);

    queue.close();
  });

  test('QueueEngine retries on failure with backoff and marks failed upon exceeding max_attempts', async () => {
    const queue = new QueueEngine({ dbPath: ':memory:' });
    const mockDb = new MockDatabaseClient();

    let callCount = 0;
    const failingJob = defineJob<{ attempt: number }>({
      name: 'flaky-task',
      retryLimit: 2,
      backoffSeconds: 1,
      handler: async (_payload, _ctx) => {
        callCount++;
        throw new Error(`Falha simulada #${callCount}`);
      }
    });

    queue.registerJob(failingJob);
    await queue.enqueue(failingJob, { attempt: 1 });

    // Attempt 1 -> fails, should be rescheduled to pending with future run_at
    const processed1 = await queue.processNextJob({ db: mockDb });
    expect(processed1).toBe(true);
    expect(callCount).toBe(1);

    const statsAfter1 = queue.getStats();
    expect(statsAfter1.pending).toBe(1);
    expect(statsAfter1.failed).toBe(0);

    // Job has future run_at, so immediate claimNextJob returns null
    const noJobYet = await queue.processNextJob({ db: mockDb });
    expect(noJobYet).toBe(false);

    // Force run_at to past to simulate time advance
    const claimable = queue.claimNextJob();
    expect(claimable).toBeNull();

    // Fast-forward run_at in SQLite database for testing retry
    queue.database.run("UPDATE _synapse_jobs SET run_at = 0 WHERE name = 'flaky-task'");

    // Attempt 2 -> hits max_attempts (2), must transition to failed
    const processed2 = await queue.processNextJob({ db: mockDb });
    expect(processed2).toBe(true);
    expect(callCount).toBe(2);

    const statsAfter2 = queue.getStats();
    expect(statsAfter2.pending).toBe(0);
    expect(statsAfter2.failed).toBe(1);

    queue.close();
  });

  test('QueueEngine marks job failed when no handler is registered', async () => {
    const queue = new QueueEngine({ dbPath: ':memory:' });
    const mockDb = new MockDatabaseClient();

    await queue.enqueue('unregistered-job', { data: 123 });

    const processed = await queue.processNextJob({ db: mockDb });
    expect(processed).toBe(true);

    const stats = queue.getStats();
    expect(stats.failed).toBe(1);

    queue.close();
  });

  test('QueueEngine respects job priority order', async () => {
    const queue = new QueueEngine({ dbPath: ':memory:' });
    const executionOrder: string[] = [];

    queue.registerJob(
      defineJob({
        name: 'task-low',
        handler: async () => {
          executionOrder.push('low');
        }
      })
    );
    queue.registerJob(
      defineJob({
        name: 'task-high',
        handler: async () => {
          executionOrder.push('high');
        }
      })
    );

    await queue.enqueue('task-low', {}, { priority: 0 });
    await queue.enqueue('task-high', {}, { priority: 10 });

    const mockDb = new MockDatabaseClient();
    await queue.processNextJob({ db: mockDb });
    await queue.processNextJob({ db: mockDb });

    expect(executionOrder).toEqual(['high', 'low']);

    queue.close();
  });
});
