import { describe, expect, test } from 'bun:test';
import { defineJob, MockDatabaseClient } from '../src/core';
import { PostgresQueueEngine } from '../src/core/postgres-queue';

describe('PostgresQueueEngine - Distributed Background Queue', () => {
  test('enqueues job and formats SQL with parameters', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb });

    const sendReportJob = defineJob<{ reportId: string }>({
      name: 'send_report',
      perform: async () => {}
    });

    const jobId = await queue.enqueue(sendReportJob, { reportId: 'rep_123' }, { priority: 10 });
    expect(jobId).toStartWith('job_');

    // Verify SQL query issued
    const insertCall = mockDb.calls.find((c) => c.sql.includes('INSERT INTO _synapse_jobs'));
    expect(insertCall).toBeDefined();
    expect(insertCall?.params[0]).toBe(jobId);
    expect(insertCall?.params[1]).toBe('send_report');
    expect(insertCall?.params[2]).toBe(JSON.stringify({ reportId: 'rep_123' }));
    expect(insertCall?.params[3]).toBe(10); // priority
  });

  test('claimNextJob uses FOR UPDATE SKIP LOCKED for atomic distributed pop', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb });

    // Mock response simulating a job returned by Postgres SKIP LOCKED
    mockDb.onQuery(/FOR UPDATE SKIP LOCKED/, () => [
      {
        id: 'job_test_456',
        name: 'generate_pdf',
        payload: JSON.stringify({ documentId: 'doc_99' }),
        status: 'running',
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        backoff_seconds: 5,
        run_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        last_error: null
      }
    ]);

    const claimed = await queue.claimNextJob();
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe('job_test_456');

    // Confirm that the SQL query used FOR UPDATE SKIP LOCKED
    const claimCall = mockDb.calls.find((c) => c.sql.includes('FOR UPDATE SKIP LOCKED'));
    expect(claimCall).toBeDefined();
  });

  test('processNextJob executes registered handler and marks job completed', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb });

    let handledPayload: { documentId: string } | null = null;
    const generatePdfJob = defineJob<{ documentId: string }>({
      name: 'generate_pdf',
      perform: async (payload) => {
        handledPayload = payload;
      }
    });

    queue.registerJob(generatePdfJob);

    mockDb.onQuery(/FOR UPDATE SKIP LOCKED/, () => [
      {
        id: 'job_exec_1',
        name: 'generate_pdf',
        payload: JSON.stringify({ documentId: 'doc_success' }),
        status: 'running',
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        backoff_seconds: 5,
        run_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        last_error: null
      }
    ]);

    const processed = await queue.processNextJob({ db: mockDb });
    expect(processed).toBe(true);
    expect(handledPayload as unknown).toEqual({ documentId: 'doc_success' });

    // Verify completed update
    const completeCall = mockDb.calls.find((c) => c.sql.includes("SET status = 'completed'"));
    expect(completeCall).toBeDefined();
    expect(completeCall?.params[2]).toBe('job_exec_1');
  });

  test('processNextJob handles failure and applies exponential backoff', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb });

    const failingJob = defineJob<{ test: string }>({
      name: 'failing_job',
      perform: async () => {
        throw new Error('Falha simulada na conexão externa');
      }
    });

    queue.registerJob(failingJob);

    mockDb.onQuery(/FOR UPDATE SKIP LOCKED/, () => [
      {
        id: 'job_fail_1',
        name: 'failing_job',
        payload: JSON.stringify({ test: 'fail' }),
        status: 'running',
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        backoff_seconds: 5,
        run_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        last_error: null
      }
    ]);

    const processed = await queue.processNextJob({ db: mockDb });
    expect(processed).toBe(true);

    // Verify retry status 'pending' with backoff run_at
    const retryCall = mockDb.calls.find((c) => c.sql.includes("SET status = 'pending'"));
    expect(retryCall).toBeDefined();
    expect(retryCall?.params[0]).toBe(1); // attempts
    expect(retryCall?.params[3]).toContain('Falha simulada na conexão externa');
  });

  test('processNextJob routes exhausted job to DLQ when attempts reach max_attempts', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb });

    const doomedJob = defineJob<{ test: string }>({
      name: 'doomed_job',
      perform: async () => {
        throw new Error('Falha permanente irrecuperável');
      }
    });

    queue.registerJob(doomedJob);

    mockDb.onQuery(/FOR UPDATE SKIP LOCKED/, () => [
      {
        id: 'job_doomed_1',
        name: 'doomed_job',
        payload: JSON.stringify({ test: 'doomed' }),
        status: 'running',
        priority: 0,
        attempts: 2, // 2nd attempt, max is 3, so next is 3rd (exhausted)
        max_attempts: 3,
        backoff_seconds: 5,
        run_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        last_error: null
      }
    ]);

    const processed = await queue.processNextJob({ db: mockDb });
    expect(processed).toBe(true);

    // Verify insert into _synapse_jobs_dlq
    const dlqInsert = mockDb.calls.find((c) => c.sql.includes('INSERT INTO _synapse_jobs_dlq'));
    expect(dlqInsert).toBeDefined();
    expect(dlqInsert?.params[1]).toBe('job_doomed_1');
    expect(dlqInsert?.params[2]).toBe('doomed_job');
    expect(dlqInsert?.params[4]).toBe(3); // attempts exhausted

    // Verify status updated to 'dlq'
    const statusUpdate = mockDb.calls.find((c) => c.sql.includes("SET status = 'dlq'"));
    expect(statusUpdate).toBeDefined();
  });

  test('retryDlqJob moves job from DLQ back to pending queue', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb });

    mockDb.onQuery(/SELECT \* FROM _synapse_jobs_dlq WHERE id = \$1/, () => [
      {
        id: 'dlq_123',
        job_id: 'job_doomed_1',
        name: 'doomed_job',
        payload: JSON.stringify({ test: 'doomed' }),
        attempts: 3,
        max_attempts: 3,
        last_error: 'Erro grave',
        failed_at: Date.now()
      }
    ]);

    const retried = await queue.retryDlqJob('dlq_123');
    expect(retried).toBe(true);

    // Verify job reset to pending
    const resetCall = mockDb.calls.find((c) => c.sql.includes("SET status = 'pending', attempts = 0"));
    expect(resetCall).toBeDefined();
    expect(resetCall?.params[1]).toBe('job_doomed_1');

    // Verify deletion from DLQ
    const deleteCall = mockDb.calls.find((c) => c.sql.includes('DELETE FROM _synapse_jobs_dlq'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.params[0]).toBe('dlq_123');
  });

  test('claimNextJob recovers orphaned running jobs whose worker died (visibility timeout)', async () => {
    const mockDb = new MockDatabaseClient();
    const queue = new PostgresQueueEngine({ db: mockDb, visibilityTimeoutSeconds: 60 });

    await queue.claimNextJob();

    // Verify SQL condition checks for stale running locks
    const claimCall = mockDb.calls.find((c) => c.sql.includes('FOR UPDATE SKIP LOCKED'));
    expect(claimCall).toBeDefined();
    expect(claimCall?.sql).toContain("(status = 'running' AND locked_at < $2)");
  });
});
