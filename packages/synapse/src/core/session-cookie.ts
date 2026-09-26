/**
 * SynapseJS - Session Cookie (browser side)
 *
 * The server derives the session from the signature; the browser is what carries
 * the token. These are the two calls a login screen needs — store after a
 * successful login, clear to log out.
 *
 * Nothing here touches `process.env`, `Bun.` or the database, so it stays valid
 * inside a client bundle. `document` is reached through `globalThis` on purpose:
 * the framework typechecks without the DOM library, and the splitter would have
 * no reason to keep a DOM-typed module out of the browser anyway.
 */

export const SESSION_COOKIE = 'synapse_token';
export const ROLES_COOKIE = 'synapse_roles';

/** Sessions last half a day unless the slice that signs them says otherwise. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 43_200;

type CookieScope = { document?: { cookie?: string } };

function scope(): CookieScope {
  return globalThis as CookieScope;
}

/**
 * One cookie, in the shape the runtime reads: path-wide, lax (so a cross-site
 * form post does not carry it) and with an explicit lifetime.
 */
export function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

/**
 * Stores the token the login action returned, plus the roles the UI may read
 * without asking the server. The roles cookie is a convenience for rendering —
 * the server ignores it whenever a session secret is configured and always
 * takes the roles from the signed claims.
 */
export function storeSession(
  token: string,
  roles: string[] = [],
  maxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS
): void {
  const target = scope().document;
  if (!target) {
    return;
  }

  target.cookie = sessionCookie(SESSION_COOKIE, token, maxAgeSeconds);
  target.cookie = sessionCookie(ROLES_COOKIE, roles.join(','), maxAgeSeconds);
}

/** Logs out: both cookies expire immediately. The server keeps no session state to clear. */
export function clearSession(): void {
  const target = scope().document;
  if (!target) {
    return;
  }

  target.cookie = sessionCookie(SESSION_COOKIE, '', 0);
  target.cookie = sessionCookie(ROLES_COOKIE, '', 0);
}

/** The roles the current cookie advertises. Rendering aid, never an authorization source. */
export function currentRoles(): string[] {
  const cookie = scope().document?.cookie;
  if (!cookie) {
    return [];
  }

  const entry = cookie.split('; ').find((item) => item.startsWith(`${ROLES_COOKIE}=`));
  if (!entry) {
    return [];
  }

  return decodeURIComponent(entry.slice(ROLES_COOKIE.length + 1))
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}
