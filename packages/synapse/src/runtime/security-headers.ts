/**
 * SynapseJS - HTTP Security Headers & Status Mapping Utilities
 */

export const ERROR_STATUS: Array<{ pattern: RegExp; status: number }> = [
  { pattern: /^UNAUTHORIZED$/, status: 401 },
  { pattern: /^FORBIDDEN$/, status: 403 },
  { pattern: /_NOT_FOUND$/, status: 404 },
  { pattern: /^(DUPLICATE_|ALREADY_|CONFLICT)/, status: 409 },
  { pattern: /^(INVALID_|MALFORMED)/, status: 422 },
  { pattern: /^(NO_DATABASE|PERSISTENCE_FAILED)/, status: 500 },
  { pattern: /_FAILED$/, status: 500 }
];

export function httpStatusForError(error: unknown): number {
  const code = typeof error === 'string' ? error : '';

  for (const entry of ERROR_STATUS) {
    if (entry.pattern.test(code)) {
      return entry.status;
    }
  }

  return 400;
}

/** Escapes special HTML characters to prevent Reflected/Stored XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
