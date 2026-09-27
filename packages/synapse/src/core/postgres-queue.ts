/**
 * SynapseJS - Distributed PostgreSQL Queue Engine
 *
 * Provides cluster-safe background job processing with zero row collisions across multiple worker nodes,
 * using PostgreSQL's native `FOR UPDATE SKIP LOCKED`, visibility timeouts for crash recovery,
 * exponential backoff with Full Jitter, and dedicated Dead Letter Queue (DLQ).
 */

import type { JobRecord } from '../runtime/queue-engine';
import type { DatabaseClient } from './database-client';
import {
  AnonymousSession,
  createActionContext,
  createDefaultLogger,
  type JobDefinition,
  type JobEnqueueOptions,
  type SessionContext,
  type StructuredLogger
} from './index';

export interface PostgresQueueOptions {
  db: DatabaseClient;
  logger?: StructuredLogger;
  visibilityTimeoutSeconds?: number;
}

export interface DlqRecord {
  id: string;
  job_id: string;
  name: string;
  payload: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  failed_at: number;
}

export class PostgresQueueEngine {
  private db: DatabaseClient;
  private logger: StructuredLogger;
  private visibilityTimeoutMs: number;
  private registry: Map<string, JobDefinition<unknown>> = new Map();
  private schemaInitialized = false;

  constructor(options: PostgresQueueOptions) {
    this.db = options.db;
    this.logger = options.logger || createDefaultLogger('PostgresQueue');
    this.visibilityTimeoutMs = (options.visibilityTimeoutSeconds ?? 300) * 1000;
  }

  async initSchema(): Promise<void> {
    if (this.schemaInitialized) return;

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS _synapse_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        backoff_seconds INTEGER NOT NULL DEFAULT 5,
        run_at BIGINT NOT NULL,
        locked_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_error TEXT
      );
    `);

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS _synapse_jobs_dlq (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        last_error TEXT,
        failed_at BIGINT NOT NULL
      );
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_synapse_jobs_pending 
      ON _synapse_jobs (status, run_at, priority DESC);
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_synapse_jobs_stale
      ON _synapse_jobs (status, locked_at);
    `);

    this.schemaInitialized = true;
  }

  registerJob<T>(job: JobDefinition<T>): void {
    this.registry.set(job.name, job as JobDefinition<unknown>);
  }

  async enqueue<TPayload>(
    jobOrName: { name: string; retryLimit?: number; backoffSeconds?: number } | string,
    payload: TPayload,
    options?: JobEnqueueOptions
  ): Promise<string> {
    await this.initSchema();

    const id = `job_${crypto.randomUUID().replace(/-/g, '')}`;
    const name = typeof jobOrName === 'string' ? jobOrName : jobOrName.name;
    const maxAttempts = typeof jobOrName === 'object' && jobOrName.retryLimit ? jobOrName.retryLimit : 3;
    const backoffSeconds = typeof jobOrName === 'object' && jobOrName.backoffSeconds ? jobOrName.backoffSeconds : 5;
    const priority = options?.priority ?? 0;
    const delaySeconds = options?.delaySeconds ?? 0;
    const now = Date.now();
    const runAt = now + delaySeconds * 1000;
    const payloadStr = JSON.stringify(payload);

    await this.db.query(
      `INSERT INTO _synapse_jobs (
        id, name, payload, status, priority, attempts, max_attempts, backoff_seconds, run_at, locked_at, created_at, updated_at
      ) VALUES ($1, $2, $3, 'pending', $4, 0, $5, $6, $7, NULL, $8, $8)`,
      [id, name, payloadStr, priority, maxAttempts, backoffSeconds, runAt, now]
    );

    return id;
  }

  /**
   * Atomically claims the next pending job or recovers orphaned jobs whose worker died
   * (locked_at older than visibilityTimeout), using PostgreSQL's FOR UPDATE SKIP LOCKED.
   */
  async claimNextJob(): Promise<JobRecord | null> {
    await this.initSchema();

    const now = Date.now();
    const staleThreshold = now - this.visibilityTimeoutMs;

    const rows = await this.db.query<JobRecord>(
      `UPDATE _synapse_jobs
       SET status = 'running', locked_at = $1, updated_at = $1
       WHERE id = (
         SELECT id FROM _synapse_jobs
         WHERE (status = 'pending' AND run_at <= $1)
            OR (status = 'running' AND locked_at < $2)
         ORDER BY priority DESC, run_at ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *;`,
      [now, staleThreshold]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Processes a single claimed job.
   */
  async processNextJob(deps: {
    db: DatabaseClient;
    session?: SessionContext;
    services?: Record<string, unknown>;
    logger?: StructuredLogger;
  }): Promise<boolean> {
    const job = await this.claimNextJob();
    if (!job) {
      return false;
    }

    const jobDef = this.registry.get(job.name);
    const attempts = Number(job.attempts) + 1;
    const now = Date.now();

    if (!jobDef) {
      const errorMsg = `Nenhum manipulador registrado para o job: ${job.name}`;
      this.logger.error(errorMsg);
      await this.sendToDlq(job, attempts, errorMsg, now);
      return true;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(job.payload);
    } catch (parseErr: unknown) {
      const errorMsg = `Falha ao desserializar payload JSON do job: ${String(parseErr)}`;
      await this.sendToDlq(job, attempts, errorMsg, now);
      return true;
    }

    const actionCtx = createActionContext({
      db: deps.db,
      session: deps.session || AnonymousSession(),
      services: deps.services || {},
      logger: deps.logger || this.logger,
      enqueue: this.enqueue.bind(this)
    });

    try {
      await jobDef.handler(parsedPayload, actionCtx);
      await this.db.query(
        `UPDATE _synapse_jobs
         SET status = 'completed', attempts = $1, locked_at = NULL, updated_at = $2, last_error = NULL
         WHERE id = $3`,
        [attempts, now, job.id]
      );
      return true;
    } catch (handlerErr: unknown) {
      const errorMsg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
      this.logger.warn(`Job ${job.name} (${job.id}) falhou na tentativa ${attempts}/${job.max_attempts}: ${errorMsg}`);

      if (attempts < Number(job.max_attempts)) {
        // AWS Full Jitter: distributes retries uniformly in [0, baseBackoff] to prevent thundering herd
        const baseBackoffMs = Number(job.backoff_seconds) * 1000 * 2 ** (attempts - 1);
        const jitteredBackoffMs = Math.floor(Math.random() * baseBackoffMs);
        const nextRunAt = now + jitteredBackoffMs;

        await this.db.query(
          `UPDATE _synapse_jobs
           SET status = 'pending', attempts = $1, run_at = $2, locked_at = NULL, updated_at = $3, last_error = $4
           WHERE id = $5`,
          [attempts, nextRunAt, now, errorMsg, job.id]
        );
      } else {
        await this.sendToDlq(job, attempts, `Esgotado limite de tentativas (${job.max_attempts}): ${errorMsg}`, now);
      }
      return true;
    }
  }

  /**
   * Routes exhausted or permanently failed jobs to the Dead Letter Queue (DLQ).
   */
  private async sendToDlq(job: JobRecord, attempts: number, errorMsg: string, now: number): Promise<string> {
    const dlqId = `dlq_${crypto.randomUUID().replace(/-/g, '')}`;

    await this.db.query(
      `INSERT INTO _synapse_jobs_dlq (
        id, job_id, name, payload, attempts, max_attempts, last_error, failed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [dlqId, job.id, job.name, job.payload, attempts, Number(job.max_attempts), errorMsg, now]
    );

    await this.db.query(
      `UPDATE _synapse_jobs
       SET status = 'dlq', attempts = $1, locked_at = NULL, updated_at = $2, last_error = $3
       WHERE id = $4`,
      [attempts, now, errorMsg, job.id]
    );

    this.logger.warn(`[DLQ] Job ${job.name} (${job.id}) movido para Dead Letter Queue: ${dlqId}`);
    return dlqId;
  }

  /**
   * Inspects records currently sitting in the Dead Letter Queue.
   */
  async getDlqJobs(limit = 50): Promise<DlqRecord[]> {
    await this.initSchema();
    return this.db.query<DlqRecord>(`SELECT * FROM _synapse_jobs_dlq ORDER BY failed_at DESC LIMIT $1`, [limit]);
  }

  /**
   * Retries a job from the DLQ by restoring it to pending status with attempts reset.
   */
  async retryDlqJob(dlqId: string): Promise<boolean> {
    await this.initSchema();
    const rows = await this.db.query<DlqRecord>(`SELECT * FROM _synapse_jobs_dlq WHERE id = $1`, [dlqId]);

    if (rows.length === 0) return false;
    const dlq = rows[0];
    const now = Date.now();

    await this.db.query(
      `UPDATE _synapse_jobs
       SET status = 'pending', attempts = 0, run_at = $1, locked_at = NULL, updated_at = $1, last_error = NULL
       WHERE id = $2`,
      [now, dlq.job_id]
    );

    await this.db.query(`DELETE FROM _synapse_jobs_dlq WHERE id = $1`, [dlqId]);
    return true;
  }

  async close(): Promise<void> {
    // No-op for db instance managed externally
  }
}
