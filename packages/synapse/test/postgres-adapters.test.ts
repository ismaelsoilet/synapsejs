import { afterAll, describe, expect, it } from 'bun:test';
import { resetDatabaseInstance } from '../src/core/database-factory';
import { PostgresDatabaseClient } from '../src/core/postgres-client';
import { PostgresQueueEngine } from '../src/core/postgres-queue';
import { PostgresEventHub } from '../src/runtime/postgres-event-hub';

/**
 * The PostgreSQL adapters against a live engine.
 *
 * Everything here needs a real server: an assertion over the SQL text an
 * implementation emits cannot tell a correct statement from a wrong-but-valid one,
 * cannot exercise `FOR UPDATE SKIP LOCKED`, and cannot observe a dead-letter row. When
 * `TEST_DATABASE_URL` is absent the suite reports **skipped** — never passed — so
 * "the suite is green" and "nothing was verified" stay distinguishable.
 */
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres = connectionString ? describe : describe.skip;

describeWithPostgres('PostgreSQL database client', () => {
  const server = { client: null as PostgresDatabaseClient | null };

  afterAll(async () => {
    await server.client?.close?.();
    resetDatabaseInstance();
  });

  it('persists, updates, deletes and rolls back rows verified by reading them back', async () => {
    const client = new PostgresDatabaseClient(connectionString as string);
    server.client = client;

    await client.query(`
      CREATE TABLE IF NOT EXISTS adapter_roundtrip (
        id TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);
    await client.query('DELETE FROM adapter_roundtrip');

    await client.insert('adapter_roundtrip', { id: 'row-1', value: 1 });
    await client.query(`UPDATE adapter_roundtrip SET value = $1 WHERE id = $2`, [2, 'row-1']);

    const updated = await client.query<{ value: number }>('SELECT value FROM adapter_roundtrip WHERE id = $1', [
      'row-1'
    ]);
    expect(updated[0].value).toBe(2);

    await client.delete('adapter_roundtrip', { id: 'row-1' });
    const afterDelete = await client.query('SELECT id FROM adapter_roundtrip WHERE id = $1', ['row-1']);
    expect(afterDelete.length).toBe(0);

    await expect(
      client.transaction(async (tx) => {
        await tx.insert('adapter_roundtrip', { id: 'row-2', value: 3 });
        throw new Error('rollback this');
      })
    ).rejects.toThrow('rollback this');

    const afterRollback = await client.query('SELECT id FROM adapter_roundtrip WHERE id = $1', ['row-2']);
    expect(afterRollback.length).toBe(0);
  });
});

describeWithPostgres('PostgreSQL queue engine', () => {
  afterAll(async () => {
    resetDatabaseInstance();
  });

  it('claims atomically under concurrency and records a dead letter for an exhausted job', async () => {
    const client = new PostgresDatabaseClient(connectionString as string);
    const first = new PostgresQueueEngine({ db: client, visibilityTimeoutSeconds: 1 });
    const second = new PostgresQueueEngine({ db: client, visibilityTimeoutSeconds: 1 });

    await first.initSchema();
    await client.query('DELETE FROM _synapse_jobs');
    await client.query('DELETE FROM _synapse_jobs_dlq');

    const jobId = await first.enqueue({ name: 'postgres-demo', retryLimit: 1 }, { value: 1 });
    expect(typeof jobId).toBe('string');

    // Two workers race for the same job; exactly one must win it.
    const [claimedByFirst, claimedBySecond] = await Promise.all([first.claimNextJob(), second.claimNextJob()]);
    const winners = [claimedByFirst, claimedBySecond].filter((job) => job !== null);

    expect(winners.length).toBe(1);
    expect(winners[0]?.id).toBe(jobId);
    expect(winners[0]?.attempts).toBe(1);

    // Exhaust the attempt budget and fail the job: the dead letter is a real row.
    await client.query(`UPDATE _synapse_jobs SET attempts = max_attempts, status = 'running' WHERE id = $1`, [jobId]);
    await client.query(`UPDATE _synapse_jobs SET locked_at = $1 WHERE id = $2`, [Date.now() - 60_000, jobId]);

    const recovered = await first.claimNextJob();
    expect(recovered).toBeNull();

    const dlq = await first.getDlqJobs(10);
    const deadLetter = dlq.find((entry) => entry.job_id === jobId);

    expect(deadLetter).toBeDefined();
    expect(deadLetter?.name).toBe('postgres-demo');
    expect(deadLetter?.attempts).toBeGreaterThanOrEqual(1);

    // The exhausted-in-handler path writes to the same store.
    first.registerJob({
      name: 'postgres-demo-fail',
      retryLimit: 1,
      handler: async () => {
        throw new Error('sempre falha');
      }
    });

    const failing = await first.enqueue({ name: 'postgres-demo-fail', retryLimit: 1 }, { value: 2 });
    await first.processNextJob({ db: client });

    const afterHandlerFailure = await first.getDlqJobs(20);
    const handlerDeadLetter = afterHandlerFailure.find((entry) => entry.job_id === failing);

    expect(handlerDeadLetter).toBeDefined();
    expect(handlerDeadLetter?.last_error).toContain('sempre falha');

    await client.close?.();
  }, 30_000);
});

describeWithPostgres('PostgreSQL event hub', () => {
  afterAll(async () => {
    resetDatabaseInstance();
  });

  it('delivers a publish from one instance to a subscriber on another, including an offloaded payload', async () => {
    const uri = connectionString as string;
    const publisher = new PostgresEventHub({ connectionUri: uri, channelName: 'synapse_adapter_test' });
    const subscriber = new PostgresEventHub({ connectionUri: uri, channelName: 'synapse_adapter_test' });

    await publisher.init();
    await subscriber.init();

    const received: unknown[] = [];
    const unsubscribe = subscriber.subscribe('adapter/topic', (data) => received.push(data));

    try {
      await publisher.publish('adapter/topic', { hello: 'world' });

      const deadline = Date.now() + 5000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ hello: 'world' });

      // An oversized payload travels through the offload table instead of pg_notify.
      const big = { blob: 'x'.repeat(20_000) };
      await publisher.publish('adapter/topic', big);

      const bigDeadline = Date.now() + 5000;
      while (received.length < 2 && Date.now() < bigDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(received.length).toBe(2);
      expect(received[1]).toEqual(big);
    } finally {
      unsubscribe();
      await publisher.close();
      await subscriber.close();
    }
  }, 30_000);
});
