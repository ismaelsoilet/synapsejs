/**
 * SynapseJS - Path Segment Guard
 *
 * The single rule that decides whether caller-supplied input may become one
 * segment of a filesystem path. Every write surface — slice scaffolding,
 * shared-module scaffolding, application creation and the upload parser —
 * passes its input through this validator before joining, so containment
 * cannot hold on one path and be missing on a sibling.
 *
 * It rejects rather than rewrites: a silently sanitized name turns a traversal
 * into "expected behaviour".
 */

import * as path from 'path';
import { Err, Ok, type Result } from './machine-types';

export const MAX_PATH_SEGMENT_LENGTH = 120;

/** An ordinary name: alphanumeric start, then alphanumerics, dot, underscore or dash. */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The same rule as a pattern source, for schemas that declare the constraint. */
export const PATH_SEGMENT_PATTERN = SEGMENT_PATTERN.source;

export type PathSegmentErrorCode = 'INVALID_PATH_SEGMENT';

/**
 * Accepts a caller-supplied string only when it is one safe path segment.
 *
 * Rejections: separators, parent traversal, absolute prefixes, empty or
 * blank segments, over-length input, and anything outside the plain-name
 * pattern. Every write surface that joins caller input into a filesystem
 * path applies exactly this rule.
 */
export function validatePathSegment(
  raw: string | null | undefined,
  maxLength: number = MAX_PATH_SEGMENT_LENGTH
): Result<string, PathSegmentErrorCode> {
  if (typeof raw !== 'string') {
    return Err('INVALID_PATH_SEGMENT');
  }

  const segment = raw.trim();

  if (!segment || segment.length > maxLength) {
    return Err('INVALID_PATH_SEGMENT');
  }

  if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
    return Err('INVALID_PATH_SEGMENT');
  }

  if (segment.includes('..')) {
    return Err('INVALID_PATH_SEGMENT');
  }

  if (path.isAbsolute(segment) || /^[A-Za-z]:/.test(segment)) {
    return Err('INVALID_PATH_SEGMENT');
  }

  if (!SEGMENT_PATTERN.test(segment)) {
    return Err('INVALID_PATH_SEGMENT');
  }

  return Ok(segment);
}

/**
 * True only when `target` resolves to a location strictly inside `base`.
 *
 * This is the post-join assertion: character validation alone is defeated by
 * a compound path that looks safe segment by segment, so the resolved target
 * is compared against the resolved base before any write.
 */
export function isInsideBase(base: string, target: string): boolean {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBase, resolvedTarget);

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Validates every segment, joins them onto `base` and asserts the resolved
 * target stays inside it. The only way to turn caller input into a write path.
 */
export function resolveWithinBase(base: string, ...segments: string[]): Result<string, PathSegmentErrorCode> {
  const resolvedBase = path.resolve(base);

  for (const segment of segments) {
    const validated = validatePathSegment(segment);

    if (!validated.ok) {
      return validated;
    }
  }

  const target = path.join(resolvedBase, ...segments);

  if (!isInsideBase(resolvedBase, target)) {
    return Err('INVALID_PATH_SEGMENT');
  }

  return Ok(target);
}
