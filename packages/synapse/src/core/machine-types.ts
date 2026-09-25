/**
 * SynapseJS - Machine-Centric Types & Deterministic Error Modeling
 * 
 * Eradicates hidden control flow and 'throw new Error' side effects.
 * Forces both LLMs and compilers to explicitly map success and failure
 * execution paths via discriminated unions.
 */
import { FormatRegistry } from '@sinclair/typebox';

// Register standard formats out-of-the-box for AI agents
if (!FormatRegistry.Has('email')) {
  FormatRegistry.Set('email', (val) => typeof val === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val));
}
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
}

export type Ok<T> = {
  readonly ok: true;
  readonly value: T;
};

export type Err<E> = {
  readonly ok: false;
  readonly error: E;
};

export type Result<T, E> = Ok<T> | Err<E>;

export function Ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function Err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function map<T, E, U>(result: Result<T, E>, fn: (val: T) => U): Result<U, E> {
  if (result.ok) {
    return Ok(fn(result.value));
  }
  return result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (err: E) => F): Result<T, F> {
  if (!result.ok) {
    return Err(fn(result.error));
  }
  return result;
}

export type Option<T> =
  | { readonly hasValue: true; readonly value: T }
  | { readonly hasValue: false };

export function Some<T>(value: T): Option<T> {
  return { hasValue: true, value };
}

export function None<T = never>(): Option<T> {
  return { hasValue: false };
}
