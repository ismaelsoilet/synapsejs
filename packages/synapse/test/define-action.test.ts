import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { defineAction } from '../src/core/action-definition';
import { Ok } from '../src/core/machine-types';
import { AnonymousSession, createSession } from '../src/core/session-context';

describe('defineAction (Fail-Closed & Auto-Validation)', () => {
  const SampleInputSchema = Type.Object({
    title: Type.String({ minLength: 3 }),
    priority: Type.Integer({ minimum: 1, maximum: 5 })
  });

  it('enforces fail-closed authentication by default when auth is omitted', async () => {
    let handlerExecuted = false;

    const action = defineAction({
      input: SampleInputSchema,
      handler: async ({ input }) => {
        handlerExecuted = true;
        return Ok({ processedTitle: input.title });
      }
    });

    expect(action.__isSynapseAction).toBe(true);

    // 1. Anonymous session -> UNAUTHORIZED
    const anonRes = await action({ title: 'Bug report', priority: 2 }, undefined, AnonymousSession());
    expect(anonRes.ok).toBe(false);
    if (!anonRes.ok) {
      expect(anonRes.error).toBe('UNAUTHORIZED');
    }
    expect(handlerExecuted).toBe(false);

    // 2. Undefined session -> UNAUTHORIZED
    const undefRes = await action({ title: 'Bug report', priority: 2 }, undefined, undefined);
    expect(undefRes.ok).toBe(false);
    if (!undefRes.ok) {
      expect(undefRes.error).toBe('UNAUTHORIZED');
    }
    expect(handlerExecuted).toBe(false);

    // 3. Authenticated session -> Ok
    const authSession = createSession({ userId: 'u1', roles: ['user'] });
    const successRes = await action({ title: 'Bug report', priority: 2 }, undefined, authSession);
    expect(successRes.ok).toBe(true);
    if (successRes.ok) {
      expect((successRes.value as { processedTitle: string }).processedTitle).toBe('Bug report');
    }
    expect(handlerExecuted).toBe(true);
  });

  it('enforces specific role requirements when configured', async () => {
    const adminAction = defineAction({
      auth: ['admin', 'security'],
      handler: async () => Ok('ACCESS_GRANTED')
    });

    const userSession = createSession({ userId: 'u1', roles: ['user', 'support'] });
    const resForbidden = await adminAction({}, undefined, userSession);
    expect(resForbidden.ok).toBe(false);
    if (!resForbidden.ok) {
      expect(resForbidden.error).toBe('FORBIDDEN');
    }

    const adminSession = createSession({ userId: 'u2', roles: ['admin'] });
    const resAllowed = await adminAction({}, undefined, adminSession);
    expect(resAllowed.ok).toBe(true);
    if (resAllowed.ok) {
      expect(resAllowed.value).toBe('ACCESS_GRANTED');
    }
  });

  it('allows unauthenticated access when auth is explicitly marked as public', async () => {
    const publicAction = defineAction({
      auth: 'public',
      input: SampleInputSchema,
      handler: async ({ input }) => Ok(`Hello, ${input.title}`)
    });

    const res = await publicAction({ title: 'Public Page', priority: 1 }, undefined, AnonymousSession());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('Hello, Public Page');
    }
  });

  it('automatically validates input schema and rejects invalid payloads before handler runs', async () => {
    let handlerRan = false;

    const action = defineAction({
      auth: 'public',
      input: SampleInputSchema,
      handler: async ({ input }) => {
        handlerRan = true;
        return Ok(input.priority * 10);
      }
    });

    // Invalid payload: title too short (<3) and priority out of bounds (>5)
    const invalidRes = await action({ title: 'ab', priority: 10 });
    expect(invalidRes.ok).toBe(false);
    if (!invalidRes.ok) {
      expect(invalidRes.error).toBe('INVALID_SCHEMA');
    }
    expect(handlerRan).toBe(false);

    // Valid payload
    const validRes = await action({ title: 'Valid Title', priority: 3 });
    expect(validRes.ok).toBe(true);
    if (validRes.ok) {
      expect(validRes.value).toBe(30);
    }
    expect(handlerRan).toBe(true);
  });
});
