/**
 * SynapseJS - Unified Action Context & Service Extensibility
 *
 * Provides a rich, extensible execution context for slices without breaking Locality of Behavior.
 * Combines database access, authenticated session, multi-tenancy, service locator,
 * structured logging, and background job dispatch.
 */

import type { DatabaseClient } from './database-client';
import type { SessionContext } from './session-context';

export interface StructuredLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface JobEnqueueOptions {
  delaySeconds?: number;
  priority?: number;
}

export type EnqueueFn = <TPayload>(
  jobOrName: { name: string } | string,
  payload: TPayload,
  options?: JobEnqueueOptions
) => Promise<string>;

export interface ActionContext<TServices = Record<string, unknown>> extends DatabaseClient {
  /** Underlying Database Client */
  readonly db: DatabaseClient;

  /** Authenticated or anonymous session context */
  readonly session: SessionContext;

  /** Multi-tenant identifier (if resolved from subdomain/header/token) */
  readonly tenantId?: string;

  /** Registered enterprise/SaaS services (e.g. mailer, stripe, s3) */
  readonly services: TServices;

  /** Structured logger */
  readonly logger: StructuredLogger;

  /** Enqueues a background job for asynchronous processing */
  readonly enqueue: EnqueueFn;

  /** Lazy adapter for Kysely (if configured or requested) */
  readonly kysely?: unknown;
}

export function createDefaultLogger(sliceName?: string): StructuredLogger {
  const prefix = sliceName ? `[${sliceName}]` : '[SynapseJS]';
  return {
    info: (msg, ctx) => console.log(`${prefix} INFO: ${msg}`, ctx ? JSON.stringify(ctx) : ''),
    warn: (msg, ctx) => console.warn(`${prefix} WARN: ${msg}`, ctx ? JSON.stringify(ctx) : ''),
    error: (msg, err, ctx) => console.error(`${prefix} ERROR: ${msg}`, err, ctx ? JSON.stringify(ctx) : ''),
    debug: (msg, ctx) => {
      if (process.env.DEBUG) {
        console.debug(`${prefix} DEBUG: ${msg}`, ctx ? JSON.stringify(ctx) : '');
      }
    }
  };
}

export interface ActionContextOptions<TServices = Record<string, unknown>> {
  db: DatabaseClient;
  session: SessionContext;
  tenantId?: string;
  services?: TServices;
  logger?: StructuredLogger;
  enqueue?: EnqueueFn;
  kysely?: unknown;
}

/**
 * Creates an ActionContext that is also a fully functional DatabaseClient,
 * providing 100% backward and forward compatibility.
 */
export function createActionContext<TServices = Record<string, unknown>>(
  options: ActionContextOptions<TServices>
): ActionContext<TServices> {
  const {
    db,
    session,
    tenantId = session.tenantId,
    services = {} as TServices,
    logger = createDefaultLogger(),
    enqueue = async () => 'job_noop',
    kysely
  } = options;

  const context: ActionContext<TServices> = {
    // ActionContext properties
    db,
    session,
    tenantId,
    services,
    logger,
    enqueue,
    kysely,

    // DatabaseClient proxy methods
    query: <T = unknown>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    queryOne: <T = unknown>(sql: string, params?: unknown[]) => db.queryOne<T>(sql, params),
    sql: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => db.sql<T>(strings, ...values),
    sqlOne: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => db.sqlOne<T>(strings, ...values),
    transaction: async <T>(operation: (tx: DatabaseClient) => Promise<T>): Promise<T> => {
      return db.transaction(async (txDb) => {
        // Create transactional ActionContext preserving services and context
        const txContext = createActionContext({
          db: txDb,
          session,
          tenantId,
          services,
          logger,
          enqueue,
          kysely: txDb
        });
        return operation(txContext);
      });
    },
    close: () => db.close?.()
  };

  return context;
}
