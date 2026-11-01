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
  readonly permissions?: string[];
  readonly isAuthenticated: boolean;
  readonly token?: string;
  readonly metadata?: Record<string, unknown>;
}

export function AnonymousSession(tenantId?: string): SessionContext {
  return {
    roles: [],
    permissions: [],
    isAuthenticated: false,
    tenantId
  };
}

export function createSession(data: {
  userId: string;
  tenantId?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  token?: string;
  metadata?: Record<string, unknown>;
}): SessionContext {
  return {
    userId: data.userId,
    tenantId: data.tenantId,
    email: data.email,
    roles: data.roles || ['user'],
    permissions: data.permissions || [],
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

export function hasPermission(session: SessionContext, permission: string): boolean {
  if (!session.isAuthenticated) return false;

  const adminBypass = process.env.SYNAPSE_RBAC_ADMIN_BYPASS !== 'false';

  if (adminBypass && (session.roles.includes('admin') || session.roles.includes('superadmin'))) {
    return true;
  }

  return Boolean(session.permissions?.includes(permission));
}

export function hasAllPermissions(session: SessionContext, permissions: string[]): boolean {
  return session.isAuthenticated && permissions.every((p) => hasPermission(session, p));
}

export type AuthCheckResult = Result<SessionContext, 'UNAUTHORIZED' | 'FORBIDDEN'>;

export interface AuthRequirements {
  roles?: string[];
  permissions?: string[];
}

export function requireAuth(session?: SessionContext, requirements?: string[] | AuthRequirements): AuthCheckResult {
  if (!session?.isAuthenticated) {
    return Err('UNAUTHORIZED');
  }

  if (!requirements) {
    return Ok(session);
  }

  if (Array.isArray(requirements)) {
    if (requirements.length > 0 && !hasAnyRole(session, requirements)) {
      return Err('FORBIDDEN');
    }
    return Ok(session);
  }

  if (requirements.roles && requirements.roles.length > 0 && !hasAnyRole(session, requirements.roles)) {
    return Err('FORBIDDEN');
  }

  if (
    requirements.permissions &&
    requirements.permissions.length > 0 &&
    !hasAllPermissions(session, requirements.permissions)
  ) {
    return Err('FORBIDDEN');
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
