/**
 * SynapseJS - Type-Safe Background Jobs Contract
 *
 * Jobs can be defined inside slices or shared modules without breaking Locality of Behavior:
 * export const sendWelcomeEmailJob = defineJob({
 *   name: 'send-welcome-email',
 *   handler: async (payload: { email: string }, ctx) => { ... }
 * });
 */

import type { ActionContext } from './action-context';

export interface JobDefinition<TPayload = unknown> {
  /** Unique name identifier for the job */
  readonly name: string;
  /** Async execution handler receiving the typed payload and ActionContext */
  readonly handler: (payload: TPayload, ctx: ActionContext) => Promise<void>;
  /** Maximum retry attempts before marking the job as permanently failed (default: 3) */
  readonly retryLimit?: number;
  /** Initial backoff in seconds for exponential backoff retries (default: 5) */
  readonly backoffSeconds?: number;
  /** Optional schema validator (e.g. TypeBox schema) */
  readonly schema?: unknown;
}

/**
 * Declares a background job definition with type safety.
 */
export function defineJob<TPayload = unknown>(options: JobDefinition<TPayload>): JobDefinition<TPayload> {
  return Object.freeze({
    name: options.name,
    handler: options.handler,
    retryLimit: options.retryLimit ?? 3,
    backoffSeconds: options.backoffSeconds ?? 5,
    schema: options.schema
  });
}
