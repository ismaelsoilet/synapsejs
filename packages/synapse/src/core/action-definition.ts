/**
 * SynapseJS - Declarative Action Definition Primitive
 *
 * Implements "Secure by Default" (Fail-Closed) semantics and wire-speed automatic
 * TypeBox schema validation. Prevents inadvertent public exposure of RPC endpoints
 * and eliminates repetitive manual `Value.Check` and `requireAuth` boilerplate.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { DatabaseClient } from './database-client';
import { Err, type Result } from './machine-types';
import { requireAuth, type SessionContext } from './session-context';

export type ActionAuthRule = 'public' | string[];

export interface ActionDefinitionConfig<TSchemaInput extends TSchema | undefined, TOutput> {
  /**
   * Optional TypeBox schema for input payload validation.
   * If supplied, incoming requests are automatically validated before the handler runs.
   */
  input?: TSchemaInput;

  /**
   * Authorization rules for this action.
   * - Omitted / undefined: Requires an authenticated user session (Fail-Closed by default).
   * - Array of strings (e.g. ['admin', 'manager']): Requires the session to possess at least one of these roles.
   * - 'public': Explicitly marks the action as accessible to unauthenticated callers.
   */
  auth?: ActionAuthRule;

  /**
   * Handler function executing business logic.
   * Receives strongly-typed validated input, database client and authenticated session context.
   */
  handler: (ctx: {
    input: TSchemaInput extends TSchema ? Static<TSchemaInput> : unknown;
    db?: DatabaseClient;
    session?: SessionContext;
  }) => Promise<TOutput> | TOutput;
}

export type ActionHandlerFn<TSchemaInput extends TSchema | undefined, TOutput> = {
  (
    payload: unknown,
    db?: DatabaseClient,
    session?: SessionContext
  ): Promise<TOutput | Result<never, 'INVALID_SCHEMA' | 'UNAUTHORIZED' | 'FORBIDDEN'>>;
  readonly __isSynapseAction: true;
  readonly config: ActionDefinitionConfig<TSchemaInput, TOutput>;
};

export function defineAction<TSchemaInput extends TSchema | undefined, TOutput>(
  config: ActionDefinitionConfig<TSchemaInput, TOutput>
): ActionHandlerFn<TSchemaInput, TOutput> {
  const actionFn = async (
    payload: unknown,
    db?: DatabaseClient,
    session?: SessionContext
  ): Promise<TOutput | Result<never, 'INVALID_SCHEMA' | 'UNAUTHORIZED' | 'FORBIDDEN'>> => {
    // 1. Fail-Closed Authentication Guard
    if (config.auth !== 'public') {
      const requiredRoles = Array.isArray(config.auth) ? config.auth : undefined;
      const auth = requireAuth(session, requiredRoles);
      if (!auth.ok) {
        return Err(auth.error);
      }
    }

    // 2. Automatic Wire-Speed Schema Validation
    if (config.input) {
      if (!Value.Check(config.input, payload)) {
        return Err('INVALID_SCHEMA');
      }
    }

    // 3. Typed Handler Invocation
    return config.handler({
      input: payload as TSchemaInput extends TSchema ? Static<TSchemaInput> : unknown,
      db,
      session
    });
  };

  Object.defineProperty(actionFn, '__isSynapseAction', { value: true, writable: false });
  Object.defineProperty(actionFn, 'config', { value: config, writable: false });

  return actionFn as ActionHandlerFn<TSchemaInput, TOutput>;
}
