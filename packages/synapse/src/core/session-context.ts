/**
 * SynapseJS - Session & Role-Based Access Control (RBAC) Context
 *
 * Provides explicit, deterministic security contracts for slices.
 * Eliminates implicit global auth states by injecting SessionContext directly
 * into server actions without throws or hidden reflection.
 */

import { Err, Ok, type Result } from './machine-types';

export interface SessionContext {
  readonly userId?: string;
  readonly tenantId?: string;
  readonly email?: string;
  readonly roles: string[];
  readonly isAuthenticated: boolean;
  readonly token?: string;
  readonly metadata?: Record<string, unknown>;
}

export function AnonymousSession(tenantId?: string): SessionContext {
  return {
    roles: [],
    isAuthenticated: false,
    tenantId
  };
}

export function createSession(data: {
  userId: string;
  tenantId?: string;
  email?: string;
  roles?: string[];
  token?: string;
  metadata?: Record<string, unknown>;
}): SessionContext {
  return {
    userId: data.userId,
    tenantId: data.tenantId,
    email: data.email,
    roles: data.roles || ['user'],
    isAuthenticated: true,
    token: data.token,
    metadata: data.metadata || {}
  };
}

export function hasRole(session: SessionContext, role: string): boolean {
  return session.isAuthenticated && session.roles.includes(role);
}

export function hasAnyRole(session: SessionContext, roles: string[]): boolean {
  return session.isAuthenticated && roles.some((r) => session.roles.includes(r));
}

export type AuthCheckResult = Result<SessionContext, 'UNAUTHORIZED' | 'FORBIDDEN'>;

export function requireAuth(session?: SessionContext, requiredRoles?: string[]): AuthCheckResult {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const authorized = hasAnyRole(session, requiredRoles);
    if (!authorized) {
      return Err('FORBIDDEN');
    }
  }

  return Ok(session);
}

/**
 * Asserts that the session is authenticated and associated with the expected tenant ID,
 * returning Err('FORBIDDEN') to protect against IDOR (Insecure Direct Object Reference) violations.
 */
export function requireTenant(session?: SessionContext, expectedTenantId?: string): AuthCheckResult {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (expectedTenantId && session.tenantId !== expectedTenantId) {
    return Err('FORBIDDEN');
  }

  return Ok(session);
}
