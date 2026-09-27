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
export const SLICE_DDL_EXPORT = 'sliceSchema';
export const SLICE_ORACLE_EXPORT = 'sliceTests';

/** React UI exports. */
export const COMPONENT_SUFFIXES = ['Trigger', 'View', 'Form', 'Component'] as const;

/** Everything the server side of a slice is built from. */
export const SERVER_ROOT_SUFFIXES = [ACTION_SUFFIX, JOB_SUFFIX, WEBHOOK_SUFFIX] as const;

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

export function isTestOnly(name: string): boolean {
  return hasSuffix(name, TEST_ONLY_EXPORTS);
}
