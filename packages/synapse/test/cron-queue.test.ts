import { describe, expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { defineJob, MockDatabaseClient } from '../src/core';
import { parseNextCronOccurrence } from '../src/core/cron-parser';
import { QueueEngine } from '../src/runtime/queue-engine';

describe('Cron Expression Parser & Queue Integration', () => {
  test('parseNextCronOccurrence calculates next minute correctly', () => {
    const base = new Date('2026-10-31T12:00:00.000Z');
    const next = parseNextCronOccurrence('* * * * *', base);
    expect(next.toISOString()).toBe('2026-10-31T12:01:00.000Z');
  });

  test('parseNextCronOccurrence calculates step interval */15 correctly', () => {
    const base = new Date('2026-10-31T12:07:00.000Z');
    const next = parseNextCronOccurrence('*/15 * * * *', base);
    expect(next.toISOString()).toBe('2026-10-31T12:15:00.000Z');
  });

  test('parseNextCronOccurrence calculates daily schedule 0 2 * * * correctly', () => {
    const base = new Date('2026-10-31T03:00:00.000Z');
    const next = parseNextCronOccurrence('0 2 * * *', base);
    expect(next.toISOString()).toBe('2026-11-01T02:00:00.000Z');
  });

  test('parseNextCronOccurrence uses OR when day-of-month and day-of-week are both restricted', () => {
    // 2026-10-01 is a Thursday. The next Friday is 2026-10-02; the next 13th is
    // 2026-10-13. POSIX cron runs on either, so the answer must be the Friday.
    const base = new Date('2026-10-01T00:00:00.000Z');
    const next = parseNextCronOccurrence('0 0 13 * 5', base);
    expect(next.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  test('parseNextCronOccurrence accepts Sunday as 0 and 7', () => {
    const base = new Date('2026-10-01T00:00:00.000Z'); // Thursday
    expect(parseNextCronOccurrence('0 0 * * 0', base).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(parseNextCronOccurrence('0 0 * * 7', base).toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  test('parseNextCronOccurrence rejects invalid ranges, steps and unsupported syntax', () => {
    expect(() => parseNextCronOccurrence('*/0 * * * *')).toThrow(/Invalid cron step/);
    expect(() => parseNextCronOccurrence('70-80/5 * * * *')).toThrow(/Invalid cron range/);
    expect(() => parseNextCronOccurrence('0 0 * * MON')).toThrow(/Unsupported cron syntax/);
    expect(() => parseNextCronOccurrence('0 0 L * *')).toThrow(/Unsupported cron syntax/);
  });

  test('QueueEngine auto-schedules and reschedules recurring cron jobs', async () => {
    const engine = new QueueEngine({ dbPath: ':memory:' });
    let runCount = 0;

    const testCronJob = defineJob({
      name: 'cleanup-cron',
      cron: '* * * * *',
      handler: async () => {
        runCount++;
      }
    });

    engine.registerJob(testCronJob);

    // Initial cron job should be enqueued in pending status
    const statsInitial = engine.getStats();
    expect(statsInitial.pending).toBe(1);

    // Force run_at to now for test execution
    engine.database.run('UPDATE _synapse_jobs SET run_at = ?1 WHERE name = ?2', [Date.now() - 1000, 'cleanup-cron']);

    const db = new MockDatabaseClient();
    const processed = await engine.processNextJob({ db });
    expect(processed).toBe(true);
    expect(runCount).toBe(1);

    // Should have 1 completed job and 1 newly scheduled pending recurrence
    const statsAfter = engine.getStats();
    expect(statsAfter.completed).toBe(1);
    expect(statsAfter.pending).toBe(1);

    engine.close();
  });

  test('QueueEngine honors runAt and rejects conflicting schedule options', async () => {
    const engine = new QueueEngine({ dbPath: ':memory:' });
    const job = defineJob({ name: 'run-at-job', handler: async () => {} });
    const runAt = Date.now() + 60_000;

    const id = await engine.enqueue(job, {}, { runAt });
    const row = engine.database.prepare('SELECT run_at FROM _synapse_jobs WHERE id = ?1').get(id) as {
      run_at: number;
    };
    expect(Number(row.run_at)).toBe(runAt);

    await expect(engine.enqueue(job, {}, { runAt, delaySeconds: 1 })).rejects.toThrow(/CONFLICTING_SCHEDULE/);

    engine.close();
  });

  test('registerJob schedules runAt and validates the starting payload', () => {
    const engine = new QueueEngine({ dbPath: ':memory:' });
    const runAt = Date.now() + 60_000;
    const job = defineJob({ name: 'registered-run-at', runAt, handler: async () => {} });

    engine.registerJob(job);
    expect(engine.getStats().pending).toBe(1);

    const schemaJob = defineJob({
      name: 'schema-cron',
      cron: '* * * * *',
      schema: Type.Object({ id: Type.String() }),
      handler: async () => {}
    });

    expect(() => engine.registerJob(schemaJob)).toThrow(/INVALID_CRON_PAYLOAD/);

    const payloadJob = defineJob({
      name: 'payload-cron',
      cron: '* * * * *',
      cronPayload: () => ({ id: 'fixed' }),
      schema: Type.Object({ id: Type.String() }),
      handler: async () => {}
    });

    engine.registerJob(payloadJob);
    const row = engine.database
      .prepare('SELECT payload FROM _synapse_jobs WHERE name = ?1 LIMIT 1')
      .get('payload-cron') as { payload: string };
    expect(JSON.parse(row.payload)).toEqual({ id: 'fixed' });

    engine.close();
  });

  test('QueueEngine supports DLQ inspection and retryJob', async () => {
    const engine = new QueueEngine({ dbPath: ':memory:' });

    const failingJob = defineJob({
      name: 'flaky-job',
      retryLimit: 1,
      handler: async () => {
        throw new Error('Database down');
      }
    });

    engine.registerJob(failingJob);
    const jobId = await engine.enqueue(failingJob, { orderId: 123 });

    const db = new MockDatabaseClient();
    await engine.processNextJob({ db });

    // Job failed and exceeded max_attempts (1) -> Dead Letter Queue
    const dlq = engine.getDeadLetterJobs();
    expect(dlq.length).toBe(1);
    expect(dlq[0].id).toBe(jobId);
    expect(dlq[0].status).toBe('failed');
    expect(dlq[0].last_error).toContain('Database down');

    // Retry job
    const retried = engine.retryJob(jobId);
    expect(retried).toBe(true);

    const stats = engine.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);

    engine.close();
  });
});
