/**
 * SynapseJS - Unified Action Context & Service Extensibility
 *
 * Provides a rich, extensible execution context for slices without breaking Locality of Behavior.
 * Combines database access, authenticated session, multi-tenancy, service locator,
 * structured logging, and background job dispatch.
 */

import { getEventHub } from '../runtime/event-hub';
import type { DatabaseClient, QueryOptions, WhereCondition } from './database-client';
import type { SessionContext } from './session-context';
import { getStorage, type StorageClient } from './storage';
import { declaredTopic, scopedTopic } from './topics';

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

export type BroadcastFn = (topic: string, data: unknown) => number;

export interface CookieOptions {
  /**
   * Defaults to true. A cookie written without stating otherwise is not readable by
   * script; pass `false` explicitly to opt out.
   */
  httpOnly?: boolean;
  /**
   * Defaults to true. A cookie written without stating otherwise is not sent over
   * plaintext; pass `false` explicitly to opt out.
   */
  secure?: boolean;
  /**
   * Defaults to `lax`. An explicit `strict` or `none` applies instead — the framework
   * never infers a weaker policy from anything but a deliberate statement.
   */
  sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number;
  path?: string;
  domain?: string;
}

export interface PendingCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Serializes one response cookie. The safe attributes are the **defaults**: a cookie
 * written with no options at all is HttpOnly, Secure and SameSite=Lax, and only an
 * explicit `false` (or a different `sameSite`) changes that. This is a breaking
 * change from the previous opt-in behaviour.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.domain && !/[\r\n;\s]/.test(options.domain)) {
    parts.push(`Domain=${options.domain.trim()}`);
  }
  const cleanPath = options.path && !/[\r\n;\s]/.test(options.path) ? options.path.trim() : '/';
  parts.push(`Path=${cleanPath}`);
  if (options.secure ?? true) {
    parts.push('Secure');
  }
  if (options.httpOnly ?? true) {
    parts.push('HttpOnly');
  }
  const sameSite = options.sameSite ?? 'lax';
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase()}`);
  return parts.join('; ');
}

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

  /** Unified object storage client */
  readonly storage: StorageClient;

  /** Broadcasts a real-time event to SSE subscribers */
  readonly broadcast: BroadcastFn;

  /** Invalidates SSR cache entries by tag or completely */
  readonly invalidateCache: (tags?: string[]) => void;

  /** Sets an HTTP response cookie (e.g. HttpOnly session token) */
  readonly setCookie: (name: string, value: string, options?: CookieOptions) => void;

  /** Internal list of pending cookies to be set on the response */
  readonly _pendingCookies?: PendingCookie[];
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
  storage?: StorageClient;
  broadcast?: BroadcastFn;
  invalidateCache?: (tags?: string[]) => void;
  /**
   * The slice key (`<domain>/<name>`) this context belongs to. Publishing into a
   * declared topic is only allowed for the declaration's owner.
   */
  sliceOwner?: string;
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
    storage = getStorage(),
    invalidateCache = () => {},
    sliceOwner
  } = options;

  /**
   * Publishing is declared, not inferred: the topic must exist in the session's
   * tenant scope and this feature must be its declared owner. Anything else is
   * rejected and notifies nobody.
   */
  const broadcast: BroadcastFn =
    options.broadcast ??
    ((topic: string, data: unknown) => {
      const declaration = declaredTopic(topic, tenantId);

      if (!declaration || (sliceOwner && declaration.owner !== sliceOwner)) {
        logger.warn(
          `Broadcast recusado no tópico "${topic}": não declarado${sliceOwner ? ` por ${sliceOwner}` : ''} (defineTopic).`
        );
        return 0;
      }

      return getEventHub().publish(scopedTopic(topic, tenantId), data);
    });

  const pendingCookies: PendingCookie[] = [];
  const setCookie = (name: string, value: string, options?: CookieOptions) => {
    pendingCookies.push({ name, value, options });
  };

  const context: ActionContext<TServices> = {
    // ActionContext properties
    db,
    session,
    tenantId,
    services,
    logger,
    enqueue,
    storage,
    broadcast,
    invalidateCache,
    setCookie,
    _pendingCookies: pendingCookies,

    // DatabaseClient proxy methods
    query: <T = unknown>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    queryOne: <T = unknown>(sql: string, params?: unknown[]) => db.queryOne<T>(sql, params),
    sql: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => db.sql<T>(strings, ...values),
    sqlOne: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => db.sqlOne<T>(strings, ...values),
    findMany: <T = unknown>(table: string, options?: QueryOptions) => db.findMany<T>(table, options),
    findOne: <T = unknown>(table: string, options?: QueryOptions) => db.findOne<T>(table, options),
    insert: <T = unknown>(table: string, data: Record<string, unknown>) => db.insert<T>(table, data),
    update: <T = unknown>(table: string, data: Record<string, unknown>, where: WhereCondition) =>
      db.update<T>(table, data, where),
    delete: (table: string, where: WhereCondition) => db.delete(table, where),
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
          storage,
          broadcast: options.broadcast,
          sliceOwner
        });
        return operation(txContext);
      });
    },
    close: () => db.close?.()
  };

  return context;
}
