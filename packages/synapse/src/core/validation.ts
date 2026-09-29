/**
 * SynapseJS - Schema Validation Utilities
 *
 * Provides structured, human-readable validation for TypeBox contracts.
 * Rather than returning an opaque 'INVALID_SCHEMA', it extracts the exact
 * paths and failure reasons to provide actionable machine and developer diagnostics.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Err, Ok, type Result } from './machine-types';

export interface ValidationErrorDetail {
  path: string;
  message: string;
  value?: unknown;
}

export interface ValidationFailure {
  code: 'INVALID_SCHEMA';
  message: string;
  errors: ValidationErrorDetail[];
}

/**
 * Validates a payload against a TypeBox schema with detailed error reporting.
 * Returns Ok(validatedValue) or Err with formatted diagnosis.
 */
export function validateSchema<T extends TSchema>(schema: T, payload: unknown): Result<Static<T>, string> {
  if (Value.Check(schema, payload)) {
    return Ok(payload as Static<T>);
  }

  const errors: ValidationErrorDetail[] = [];
  try {
    for (const err of Value.Errors(schema, payload)) {
      errors.push({
        path: err.path || '/',
        message: err.message,
        value: err.value
      });
    }
  } catch {
    // Se a extração de erros falhar, mantém fallback seguro
  }

  if (errors.length === 0) {
    return Err('INVALID_SCHEMA: Falha na validação do contrato de entrada.');
  }

  const formattedDetails = errors
    .slice(0, 3)
    .map((e) => `campo "${e.path}": ${e.message}`)
    .join('; ');

  return Err(`INVALID_SCHEMA: ${formattedDetails}`);
}
