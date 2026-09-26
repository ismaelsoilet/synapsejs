/**
 * SynapseJS - Uploads
 *
 * The RPC endpoint speaks JSON on purpose — that is what closes CSRF by
 * construction — so files need their own door. This one requires a session,
 * refuses a name that tries to escape the upload directory, and stops reading the
 * moment the body passes the limit instead of buffering it first.
 *
 * The endpoint stores bytes and returns a relative path; what those bytes mean is
 * the slice's business, decided by its own contract.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Err, Ok, type Result } from '../core/machine-types';
import type { SessionContext } from '../core/session-context';

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** No separators, no `..`, no leading dash or dot, and a sane length. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export type UploadErrorCode = 'INVALID_NAME' | 'UNAUTHORIZED' | 'TOO_LARGE' | 'EMPTY_BODY' | 'WRITE_FAILED';

export function maxUploadBytes(raw: string | undefined = process.env.SYNAPSE_MAX_UPLOAD_BYTES): number {
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
}

/**
 * Accepts a plain file name or refuses it — it never silently rewrites one, so a
 * caller sending `../../etc/passwd` gets an error instead of a surprise file.
 */
export function safeUploadName(raw: string | null): Result<string, 'INVALID_NAME'> {
  if (!raw) {
    return Err('INVALID_NAME');
  }

  const trimmed = raw.trim();

  if (path.basename(trimmed) !== trimmed || !NAME_PATTERN.test(trimmed)) {
    return Err('INVALID_NAME');
  }

  return Ok(trimmed);
}

export interface UploadOutcome {
  status: number;
  body: Record<string, unknown>;
}

/** Reads at most `maxBytes`, cancelling the stream instead of buffering a bomb. */
export async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Result<Uint8Array, 'TOO_LARGE'>> {
  if (!body) {
    return Ok(new Uint8Array());
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();
      return Err('TOO_LARGE');
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return Ok(merged);
}

export async function saveUpload(
  request: Request,
  options: { baseDir: string; domain: string; session: SessionContext; maxBytes?: number }
): Promise<UploadOutcome> {
  if (!options.session.isAuthenticated) {
    return { status: 401, body: { ok: false, error: 'UNAUTHORIZED' } };
  }

  const maxBytes = options.maxBytes ?? maxUploadBytes();
  const name = safeUploadName(new URL(request.url).searchParams.get('name'));

  if (!name.ok) {
    return {
      status: 400,
      body: { ok: false, error: 'INVALID_NAME', hint: 'passe ?name=arquivo.pdf, sem diretórios e sem ".."' }
    };
  }

  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { status: 413, body: { ok: false, error: 'TOO_LARGE', maxBytes } };
  }

  const body = await readBodyWithinLimit(request.body, maxBytes);
  if (!body.ok) {
    return { status: 413, body: { ok: false, error: 'TOO_LARGE', maxBytes } };
  }

  if (body.value.byteLength === 0) {
    return { status: 422, body: { ok: false, error: 'EMPTY_BODY' } };
  }

  const directory = path.join(options.baseDir, '.synapse', 'uploads', options.domain);
  const fileName = `${crypto.randomUUID().slice(0, 8)}-${name.value}`;
  const target = path.join(directory, fileName);

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, body.value);
  } catch (err) {
    return { status: 500, body: { ok: false, error: 'WRITE_FAILED', message: (err as Error).message } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      path: path.relative(options.baseDir, target).split(path.sep).join('/'),
      bytes: body.value.byteLength
    }
  };
}
