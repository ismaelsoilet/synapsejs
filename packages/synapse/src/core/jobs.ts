/**
 * SynapseJS - Type-Safe Background Jobs Contract
 *
 * Jobs can be defined inside slices or shared modules without breaking Locality of Behavior:
 * export const sendWelcomeEmailJob = defineJob({
 *   name: 'send-welcome-email',
 *   handler: async (payload: { email: string }, ctx) => { ... }
 * });
 */

import { Value } from '@sinclair/typebox/value';
import type { ActionContext } from './action-context';

export type JobHandlerFn<TPayload = unknown> = (payload: TPayload, ctx: ActionContext) => Promise<void>;

export type JobScheduleErrorCode = 'CRON_UNSUPPORTED_ENGINE' | 'CONFLICTING_SCHEDULE' | 'INVALID_CRON_PAYLOAD';

export class JobScheduleError extends Error {
  readonly code: JobScheduleErrorCode;

  constructor(code: JobScheduleErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'JobScheduleError';
    this.code = code;
  }
}

export function jobPayloadMatchesSchema(schema: unknown, payload: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return true;
  }

  try {
    return Value.Check(schema as never, payload);
  } catch {
    return true;
  }
}

export interface JobDefinition<TPayload = unknown> {
  /** Unique name identifier for the job */
  readonly name: string;
  /** Async execution handler receiving the typed payload and ActionContext */
  readonly handler: JobHandlerFn<TPayload>;
  /** Maximum retry attempts before marking the job as permanently failed (default: 3) */
  readonly retryLimit?: number;
  /** Initial backoff in seconds for exponential backoff retries (default: 5) */
  readonly backoffSeconds?: number;
  /** Optional recurring cron expression (e.g. '0 0 * * *' or hourly/daily) */
  readonly cron?: string;
  /** Optional payload factory used for the first run and each recurrence. */
  readonly cronPayload?: () => TPayload;
  /** Optional future execution timestamp in milliseconds */
  readonly runAt?: number;
  /** Optional schema validator (e.g. TypeBox schema) */
  readonly schema?: unknown;
}

export interface JobOptions<TPayload = unknown> {
  name: string;
  handler?: JobHandlerFn<TPayload>;
  perform?: JobHandlerFn<TPayload>;
  retryLimit?: number;
  backoffSeconds?: number;
  cron?: string;
  cronPayload?: () => TPayload;
  runAt?: number;
  schema?: unknown;
}

/**
 * Declares a background job definition with type safety.
 */
export function defineJob<TPayload = unknown>(options: JobOptions<TPayload>): JobDefinition<TPayload> {
  const handler = options.handler || options.perform;
  if (!handler) {
    throw new Error(`Job "${options.name}" must specify either a handler or perform function.`);
  }

  return Object.freeze({
    name: options.name,
    handler,
    retryLimit: options.retryLimit ?? 3,
    backoffSeconds: options.backoffSeconds ?? 5,
    cron: options.cron,
    cronPayload: options.cronPayload,
    runAt: options.runAt,
    schema: options.schema
  });
}
