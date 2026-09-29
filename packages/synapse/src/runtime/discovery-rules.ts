/**
 * SynapseJS - Discovery Rules
 *
 * What a slice exports, and which suffix means what, is decided here and nowhere
 * else. The runtime, the splitter and the machine contract all read these
 * constants, so the contract an agent reads cannot drift from the behavior that
 * enforces it — and a suffix is never guessed in two places.
 */

export const ACTION_SUFFIX = 'Action';
export const JOB_SUFFIX = 'Job';
export const WEBHOOK_SUFFIX = 'Webhook';
export const LOADER_SUFFIX = 'Loader';
export const SCHEMA_SUFFIX = 'Schema';
export const META_SUFFIX = 'Meta';
export const CACHE_SUFFIX = 'Cache';
export const SOCKET_SUFFIX = 'Socket';
export const SLICE_META_EXPORT = 'sliceMeta';
export const SLICE_CACHE_EXPORT = 'sliceCache';
export const SLICE_SOCKET_EXPORT = 'sliceSocket';
export const SLICE_DDL_EXPORT = 'sliceSchema';
export const SLICE_ORACLE_EXPORT = 'sliceTests';

/** React UI exports. */
export const COMPONENT_SUFFIXES = ['Trigger', 'View', 'Form', 'Component'] as const;

/** Everything the server side of a slice is built from. */
export const SERVER_ROOT_SUFFIXES = [
  ACTION_SUFFIX,
  JOB_SUFFIX,
  WEBHOOK_SUFFIX,
  META_SUFFIX,
  CACHE_SUFFIX,
  SOCKET_SUFFIX
] as const;

/** Test-only exports, dropped from both runtime bundles. */
export const TEST_ONLY_EXPORTS = [SLICE_ORACLE_EXPORT] as const;

export function hasSuffix(name: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => name.endsWith(suffix));
}

export function isLoader(name: string): boolean {
  return name.endsWith(LOADER_SUFFIX);
}

export function isAction(name: string): boolean {
  return name.endsWith(ACTION_SUFFIX);
}

export function isJob(name: string): boolean {
  return name.endsWith(JOB_SUFFIX);
}

export function isWebhook(name: string): boolean {
  return name.endsWith(WEBHOOK_SUFFIX);
}

export function isComponent(name: string): boolean {
  return hasSuffix(name, COMPONENT_SUFFIXES);
}

export function isSchema(name: string): boolean {
  return name.endsWith(SCHEMA_SUFFIX);
}

export function isMeta(name: string): boolean {
  return name === SLICE_META_EXPORT || name.endsWith(META_SUFFIX);
}

export function isCache(name: string): boolean {
  return name === SLICE_CACHE_EXPORT || name.endsWith(CACHE_SUFFIX);
}

export function isSocket(name: string): boolean {
  return name === SLICE_SOCKET_EXPORT || name.endsWith(SOCKET_SUFFIX);
}

export function isTestOnly(name: string): boolean {
  return hasSuffix(name, TEST_ONLY_EXPORTS);
}
