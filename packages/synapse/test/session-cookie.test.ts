import { afterEach, describe, expect, it } from 'bun:test';
import {
  clearSession,
  currentRoles,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  ROLES_COOKIE,
  SESSION_COOKIE,
  sessionCookie,
  storeSession
} from '../src/core/session-cookie';

interface FakeDocument {
  cookie: string;
}

const original = (globalThis as { document?: FakeDocument }).document;

afterEach(() => {
  if (original === undefined) {
    delete (globalThis as { document?: FakeDocument }).document;
  } else {
    (globalThis as { document?: FakeDocument }).document = original;
  }
});

function withFakeDocument(): string[] {
  const written: string[] = [];
  (globalThis as { document?: FakeDocument }).document = {
    get cookie() {
      return written.join('; ');
    },
    set cookie(value: string) {
      written.push(value);
    }
  };

  return written;
}

describe('session cookie', () => {
  it('builds a cookie the runtime can read back, scoped and time-limited', () => {
    const cookie = sessionCookie(SESSION_COOKIE, 'abc.def', 600);

    expect(cookie).toBe('synapse_token=abc.def; Path=/; Max-Age=600; SameSite=Lax');
  });

  it('encodes what a raw token would break', () => {
    expect(sessionCookie(SESSION_COOKIE, 'a b;c', 1)).toContain('a%20b%3Bc');
  });

  it('stores the token and the roles the UI may render', () => {
    const written = withFakeDocument();

    storeSession('token-123', ['admin', 'billing']);

    expect(written[0]).toContain('synapse_token=token-123');
    expect(written[1]).toContain(`Max-Age=${DEFAULT_SESSION_MAX_AGE_SECONDS}`);
    expect(currentRoles()).toEqual(['admin', 'billing']);
  });

  it('logs out by expiring both cookies', () => {
    const written = withFakeDocument();

    clearSession();

    expect(written).toEqual([
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
      `${ROLES_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    ]);
  });

  it('does nothing without a document, so importing it on the server is harmless', () => {
    delete (globalThis as { document?: FakeDocument }).document;

    expect(() => storeSession('token', ['user'])).not.toThrow();
    expect(() => clearSession()).not.toThrow();
    expect(currentRoles()).toEqual([]);
  });
});
