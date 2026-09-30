/**
 * SynapseJS - Isolated SQLite Queue Engine for Background Jobs
 *
 * Persists and coordinates background jobs inside an isolated SQLite database (.synapse/queue.sqlite),
 * providing atomic claiming (WAL + RETURNING), exponential backoff retries, and dead-letter handling.
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import {
  AnonymousSession,
  createActionContext,
  createDefaultLogger,
  type DatabaseClient,
  type JobDefinition,
  type JobEnqueueOptions,
  type SessionContext,
  type StructuredLogger
} from '../core';

export interface JobRecord {
  id: string;
  name: string;
  payload: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  max_attempts: number;
  backoff_seconds: number;
  run_at: number;
  created_at: number;
  updated_at: number;
  locked_at?: number | null;
  last_error: string | null;
}

export interface QueueEngineOptions {
  /** Path to SQLite database file or ':memory:' */
  dbPath?: string;
  logger?: StructuredLogger;
  /** Inactivity window in ms before a 'running' job without heartbeat is recovered (default: 300_000ms = 5m) */
  visibilityTimeoutMs?: number;
  /** Inactivity window in seconds (alternative to visibilityTimeoutMs) */
  visibilityTimeoutSeconds?: number;
}

export class QueueEngine {
  private db: Database;
  private registry: Map<string, JobDefinition<unknown>> = new Map();
  private logger: StructuredLogger;
  private visibilityTimeoutMs: number;
  /** Set at the start of shutdown: no new claim is taken from that moment on. */
  private claimingStopped = false;

  constructor(options: QueueEngineOptions = {}) {
    this.logger = options.logger || createDefaultLogger('QueueEngine');
    this.visibilityTimeoutMs =
      options.visibilityTimeoutMs ??
      (options.visibilityTimeoutSeconds !== undefined ? options.visibilityTimeoutSeconds * 1000 : 300_000);
    const dbPath = options.dbPath || path.join(process.cwd(), '.synapse/queue.sqlite');

    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA busy_timeout = 5000;');
    this.initSchema();
  }

  get database(): Database {
    return this.db;
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _synapse_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        backoff_seconds INTEGER NOT NULL DEFAULT 5,
        run_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        locked_at INTEGER,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_synapse_jobs_pending 
      ON _synapse_jobs (status, run_at, priority DESC);
    `);
    try {
      this.db.run('ALTER TABLE _synapse_jobs ADD COLUMN locked_at INTEGER;');
    } catch {
      // Column already exists
    }
    try {
      this.db.run('CREATE INDEX IF NOT EXISTS idx_synapse_jobs_stale ON _synapse_jobs (status, locked_at);');
    } catch {
      // Index already exists
    }
  }

  /**
   * Registers a job definition to be processed by this queue engine.
   */
  registerJob<T>(job: JobDefinition<T>): void {
    this.registry.set(job.name, job as JobDefinition<unknown>);
  }

  /**
   * Enqueues a job for background processing.
   */
  async enqueue<TPayload>(
    jobOrName: { name: string; retryLimit?: number; backoffSeconds?: number } | string,
    payload: TPayload,
    options?: JobEnqueueOptions
  ): Promise<string> {
    const id = `job_${crypto.randomUUID().replace(/-/g, '')}`;
    const name = typeof jobOrName === 'string' ? jobOrName : jobOrName.name;
    const maxAttempts = typeof jobOrName === 'object' && jobOrName.retryLimit ? jobOrName.retryLimit : 3;
    const backoffSeconds = typeof jobOrName === 'object' && jobOrName.backoffSeconds ? jobOrName.backoffSeconds : 5;
    const priority = options?.priority ?? 0;
    const delaySeconds = options?.delaySeconds ?? 0;
    const now = Date.now();
    const runAt = now + delaySeconds * 1000;
    const payloadStr = JSON.stringify(payload);

    const stmt = this.db.prepare(`
      INSERT INTO _synapse_jobs (
        id, name, payload, status, priority, attempts, max_attempts, backoff_seconds, run_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'pending', ?4, 0, ?5, ?6, ?7, ?8, ?8)
    `);

    stmt.run(id, name, payloadStr, priority, maxAttempts, backoffSeconds, runAt, now);
    return id;
  }

  /**
   * Stops the engine from claiming any new work. Jobs enqueued by a request that
   * was in flight remain pending for the next process, instead of being claimed
   * during a shutdown that is about to close the database.
   */
  stopClaiming(): void {
    this.claimingStopped = true;
  }

  get isClaimingStopped(): boolean {
    return this.claimingStopped;
  }

  /**
   * Returns every job that is still marked running to the queue. The attempt
   * counter is left exactly as the interrupted claim left it — releasing must not
   * consume a second attempt for one claim — and a job that already reached its
   * maximum is marked failed instead of being handed back for another run.
   */
  interruptRunningJobs(): { requeued: number; failed: number } {
    const now = Date.now();

    const failed = this.db
      .prepare(`
        UPDATE _synapse_jobs
        SET status = 'failed', locked_at = NULL, updated_at = ?1, last_error = 'Interrompido pelo encerramento do processo'
        WHERE status = 'running' AND attempts >= max_attempts
      `)
      .run(now);

    const requeued = this.db
      .prepare(`
        UPDATE _synapse_jobs
        SET status = 'pending', locked_at = NULL, updated_at = ?1, last_error = 'Interrompido pelo encerramento do processo'
        WHERE status = 'running' AND attempts < max_attempts
      `)
      .run(now);

    return { requeued: Number(requeued.changes ?? 0), failed: Number(failed.changes ?? 0) };
  }

  /**
   * Atomically claims the next pending job eligible for execution, or recovers
   * any stale 'running' job whose worker has died (visibility timeout exceeded).
   */
  claimNextJob(visibilityTimeoutMs?: number): JobRecord | null {
    if (this.claimingStopped) {
      return null;
    }

    const now = Date.now();
    const timeout = visibilityTimeoutMs ?? this.visibilityTimeoutMs;
    const staleThreshold = now - timeout;

    // Fail expired zombie jobs that already exhausted max_attempts
    this.db
      .prepare(`
      UPDATE _synapse_jobs
      SET status = 'failed', locked_at = NULL, updated_at = ?1, last_error = 'Visibility timeout exceeded max attempts'
      WHERE status = 'running' AND (locked_at IS NULL OR locked_at < ?2) AND attempts >= max_attempts
    `)
      .run(now, staleThreshold);

    const stmt = this.db.prepare(`
      UPDATE _synapse_jobs
      SET status = 'running', locked_at = ?1, updated_at = ?1, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM _synapse_jobs
        WHERE (status = 'pending' AND run_at <= ?1)
           OR (status = 'running' AND (locked_at IS NULL OR locked_at < ?2) AND attempts < max_attempts)
        ORDER BY priority DESC, run_at ASC, created_at ASC
        LIMIT 1
      )
      RETURNING *;
    `);

    const row = stmt.get(now, staleThreshold) as JobRecord | undefined;
    return row || null;
  }

  /**
   * Processes a single claimed job. Returns true if a job was found and processed, false if queue was empty.
   */
  async processNextJob(deps: {
    db: DatabaseClient;
    session?: SessionContext;
    services?: Record<string, unknown>;
    logger?: StructuredLogger;
  }): Promise<boolean> {
    const job = this.claimNextJob();
    if (!job) {
      return false;
    }

    const jobDef = this.registry.get(job.name);
    const attempts = job.attempts;
    const now = Date.now();

    if (!jobDef) {
      const errorMsg = `Nenhum manipulador registrado para o job: ${job.name}`;
      this.logger.error(errorMsg);
      const updateStmt = this.db.prepare(`
        UPDATE _synapse_jobs
        SET status = 'failed', locked_at = NULL, updated_at = ?1, last_error = ?2
        WHERE id = ?3 AND (locked_at = ?4 OR locked_at IS NULL)
      `);
      updateStmt.run(now, errorMsg, job.id, job.locked_at ?? null);
      return true;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(job.payload);
    } catch (parseErr: unknown) {
      const errorMsg = `Falha ao desserializar payload JSON do job: ${String(parseErr)}`;
      const updateStmt = this.db.prepare(`
        UPDATE _synapse_jobs
        SET status = 'failed', locked_at = NULL, updated_at = ?1, last_error = ?2
        WHERE id = ?3 AND (locked_at = ?4 OR locked_at IS NULL)
      `);
      updateStmt.run(now, errorMsg, job.id, job.locked_at ?? null);
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
      const completeStmt = this.db.prepare(`
        UPDATE _synapse_jobs
        SET status = 'completed', locked_at = NULL, updated_at = ?1, last_error = NULL
        WHERE id = ?2 AND (locked_at = ?3 OR locked_at IS NULL)
      `);
      completeStmt.run(now, job.id, job.locked_at ?? null);
      return true;
    } catch (handlerErr: unknown) {
      const errorMsg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
      this.logger.warn(`Job ${job.name} (${job.id}) falhou na tentativa ${attempts}/${job.max_attempts}: ${errorMsg}`);

      if (attempts < job.max_attempts) {
        // Exponential backoff: backoff_seconds * 2^(attempts-1)
        const backoffMs = job.backoff_seconds * 1000 * 2 ** (attempts - 1);
        const nextRunAt = now + backoffMs;
        const retryStmt = this.db.prepare(`
          UPDATE _synapse_jobs
          SET status = 'pending', locked_at = NULL, run_at = ?1, updated_at = ?2, last_error = ?3
          WHERE id = ?4 AND (locked_at = ?5 OR locked_at IS NULL)
        `);
        retryStmt.run(nextRunAt, now, errorMsg, job.id, job.locked_at ?? null);
      } else {
        const failStmt = this.db.prepare(`
          UPDATE _synapse_jobs
          SET status = 'failed', locked_at = NULL, updated_at = ?1, last_error = ?2
          WHERE id = ?3 AND (locked_at = ?4 OR locked_at IS NULL)
        `);
        failStmt.run(now, errorMsg, job.id, job.locked_at ?? null);
      }
      return true;
    }
  }

  /**
   * Returns a snapshot of job counts by status.
   */
  getStats(): { pending: number; running: number; completed: number; failed: number } {
    const rows = this.db
      .prepare(`
      SELECT status, COUNT(*) as count FROM _synapse_jobs GROUP BY status
    `)
      .all() as Array<{ status: string; count: number }>;

    const stats = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }
    return stats;
  }

  close(): void {
    this.db.close();
  }
}
