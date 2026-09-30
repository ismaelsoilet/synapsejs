/**
 * SynapseJS - Declared Realtime Topics
 *
 * A topic is a name a slice deliberately declares together with who may read it and
 * which feature may publish into it. Inferring authorization from a naming convention
 * is not a security control, so the event-stream gateway refuses any topic that was
 * never declared — a caller cannot subscribe to a name merely because it can spell it.
 *
 * Topics are namespaced by tenant: two tenants that use the same name are two
 * independent topics that never observe each other's broadcasts.
 */

export interface TopicDeclaration {
  /** The topic name as it appears in the URL. */
  name: string;
  /** The slice key (`<domain>/<name>`) permitted to publish into this topic. */
  owner: string;
  /** When set, the declaration exists only inside that tenant. */
  tenantId?: string;
  /** Roles permitted to subscribe. Empty means "any authenticated session". */
  readRoles?: string[];
  /** A deliberately public topic: reachable without a session. */
  public?: boolean;
}

/**
 * The complete set of realtime rejection codes and the status each is returned with.
 * Both transports draw from this table and the machine contract enumerates it, so a
 * code cannot be invented at a refusal site.
 */
export const REALTIME_REJECTIONS = {
  UNAUTHENTICATED: 401,
  TOPIC_NOT_FOUND: 404,
  TOPIC_FORBIDDEN: 403,
  RATE_LIMIT_EXCEEDED: 429,
  REALTIME_LIMIT_EXCEEDED: 429,
  ORIGIN_NOT_ALLOWED: 403
} as const;

export type RealtimeRejectionCode = keyof typeof REALTIME_REJECTIONS;

const registry = new Map<string, TopicDeclaration>();

function registryKey(name: string, tenantId?: string): string {
  return `${tenantId ?? '*'}:${name}`;
}

/**
 * Declares a topic. Call it at module scope in the slice that owns the topic.
 */
export function defineTopic(declaration: TopicDeclaration): TopicDeclaration {
  registry.set(registryKey(declaration.name, declaration.tenantId), declaration);

  return declaration;
}

/**
 * The declaration that governs `name` for a session in `tenantId`: an exact
 * tenant-scoped declaration wins over a global one. A name declared only for another
 * tenant resolves to nothing here, so the refusal cannot disclose that it exists.
 */
export function declaredTopic(name: string, tenantId?: string): TopicDeclaration | undefined {
  const scoped = registry.get(registryKey(name, tenantId));

  if (scoped) {
    return scoped;
  }

  return registry.get(registryKey(name));
}

export function declaredTopics(): TopicDeclaration[] {
  return Array.from(registry.values());
}

/** The effective, tenant-scoped hub key for a topic. */
export function scopedTopic(name: string, tenantId?: string): string {
  return `${tenantId || 'global'}:${name}`;
}

/** Test helper: drops every declaration. */
export function resetDeclaredTopics(): void {
  registry.clear();
}
