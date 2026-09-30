/**
 * SynapseJS - Uploads
 *
 * The RPC endpoint speaks JSON on purpose — that is what closes CSRF by
 * construction — so files need their own door. This one requires a session,
 * refuses a name that tries to escape the upload directory, stops reading the
 * moment the body passes the limit instead of buffering it first, and never
 * accepts a file type on the client's declared extension alone.
 *
 * The endpoint stores bytes and returns a relative path; what those bytes mean is
 * the slice's business, decided by its own contract. The framework does not serve
 * the upload directory — serving it is the application's responsibility.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Err, Ok, type Result } from '../core/machine-types';
import { validatePathSegment } from '../core/path-guard';
import type { SessionContext } from '../core/session-context';

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Accepted by default; a configured policy replaces this list entirely. */
export const DEFAULT_ALLOWED_UPLOAD_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'csv',
  'json',
  'md'
];

export type UploadErrorCode =
  | 'INVALID_NAME'
  | 'UNAUTHORIZED'
  | 'TOO_LARGE'
  | 'EMPTY_BODY'
  | 'WRITE_FAILED'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'INVALID_MULTIPART_BODY'
  | 'NO_FILE_IN_FORM_DATA';

export function maxUploadBytes(raw: string | undefined = process.env.SYNAPSE_MAX_UPLOAD_BYTES): number {
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_UPLOAD_BYTES;
}

/** Reads SYNAPSE_UPLOAD_ALLOWED_TYPES (comma separated extensions) or the default policy. */
export function allowedUploadExtensions(raw: string | undefined = process.env.SYNAPSE_UPLOAD_ALLOWED_TYPES): string[] {
  const configured = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

  return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_UPLOAD_EXTENSIONS];
}

/**
 * Accepts a plain file name or refuses it — it never silently rewrites one, so a
 * caller sending `../../etc/passwd` gets an error instead of a surprise file.
 * The path-segment rule itself lives in core/path-guard, shared with every other
 * write surface.
 */
export function safeUploadName(raw: string | null): Result<string, 'INVALID_NAME'> {
  const validated = validatePathSegment(raw);

  return validated.ok ? Ok(validated.value) : Err('INVALID_NAME');
}

type DetectedKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'text' | 'binary';

/** The extensions each detected content kind is allowed to be stored under. */
const KIND_EXTENSIONS: Record<DetectedKind, string[]> = {
  png: ['png'],
  jpeg: ['jpg', 'jpeg'],
  gif: ['gif'],
  webp: ['webp'],
  pdf: ['pdf'],
  text: ['txt', 'csv', 'json', 'md'],
  binary: []
};

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  let out = '';

  for (let index = start; index < end && index < bytes.length; index++) {
    out += String.fromCharCode(bytes[index]);
  }

  return out;
}

/** Inspects magic bytes; anything unrecognised is text unless it contains NULs. */
export function detectFileKind(bytes: Uint8Array): DetectedKind {
  if (bytes.length >= 8 && bytes[0] === 0x89 && asciiAt(bytes, 1, 4) === 'PNG') {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 6 && (asciiAt(bytes, 0, 6) === 'GIF87a' || asciiAt(bytes, 0, 6) === 'GIF89a')) {
    return 'gif';
  }
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 5 && asciiAt(bytes, 0, 5) === '%PDF-') {
    return 'pdf';
  }

  const window = bytes.subarray(0, Math.min(bytes.length, 8192));

  return window.includes(0) ? 'binary' : 'text';
}

/** The lowercased extension a name carries, or an empty string. */
export function uploadExtension(name: string): string {
  const dot = name.lastIndexOf('.');

  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }

  return name.slice(dot + 1).toLowerCase();
}

/**
 * The accept policy: the declared extension must be within the policy *and*
 * consistent with the bytes actually received, so a client cannot choose the
 * extension a file is served under.
 */
export function acceptUploadType(
  name: string,
  bytes: Uint8Array,
  allowed: string[] = allowedUploadExtensions()
): Result<string, 'UNSUPPORTED_FILE_TYPE'> {
  const extension = uploadExtension(name);

  if (!extension || !allowed.includes(extension)) {
    return Err('UNSUPPORTED_FILE_TYPE');
  }

  const kind = detectFileKind(bytes);

  return KIND_EXTENSIONS[kind].includes(extension) ? Ok(extension) : Err('UNSUPPORTED_FILE_TYPE');
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

/** Thrown inside the guarded stream so a consumer can tell an oversize body apart. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('BODY_TOO_LARGE');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * The streaming half of the size defence: wraps a body so it errors the moment more
 * than `maxBytes` arrive. The consumer (Bun's form parser) is therefore never handed
 * an unbounded body, and the whole body is never buffered to discover the violation.
 */
export function boundBodyStream(body: ReadableStream<Uint8Array> | null, maxBytes: number): ReadableStream<Uint8Array> {
  if (!body) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });
  }

  let total = 0;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;

        if (total > maxBytes) {
          controller.error(new BodyTooLargeError());
          return;
        }

        controller.enqueue(chunk);
      }
    })
  );
}

export async function saveUpload(
  request: Request,
  options: { baseDir: string; domain: string; session: SessionContext; maxBytes?: number }
): Promise<UploadOutcome> {
  if (!options.session.isAuthenticated) {
    return { status: 401, body: { ok: false, error: 'UNAUTHORIZED' } };
  }

  const maxBytes = options.maxBytes ?? maxUploadBytes();

  // An absent or unparsable content-length means "unknown", not zero: the declared
  // pre-check is skipped and the streaming guard below is what bounds the body.
  const declaredHeader = request.headers.get('content-length');
  const declared = declaredHeader ? parseInt(declaredHeader, 10) : NaN;
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { status: 413, body: { ok: false, error: 'TOO_LARGE', maxBytes } };
  }

  const contentType = request.headers.get('content-type') || '';
  let fileBytes: Uint8Array;
  let targetFileName: string;

  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try {
      // The form parser receives a stream that errors at the ceiling, so an oversized
      // multipart body is refused mid-transfer instead of being buffered whole.
      formData = await new Response(boundBodyStream(request.body, maxBytes), {
        headers: { 'content-type': contentType }
      }).formData();
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return { status: 413, body: { ok: false, error: 'TOO_LARGE', maxBytes } };
      }
      return { status: 400, body: { ok: false, error: 'INVALID_MULTIPART_BODY' } };
    }
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return {
        status: 422,
        body: { ok: false, error: 'NO_FILE_IN_FORM_DATA', hint: 'envie o arquivo no campo "file"' }
      };
    }
    const uploadedFile = file as File;
    if (uploadedFile.size > maxBytes) {
      return { status: 413, body: { ok: false, error: 'TOO_LARGE', maxBytes } };
    }
    if (uploadedFile.size === 0) {
      return { status: 422, body: { ok: false, error: 'EMPTY_BODY' } };
    }

    const rawName = uploadedFile.name || new URL(request.url).searchParams.get('name');
    const name = safeUploadName(rawName);
    if (!name.ok) {
      return {
        status: 400,
        body: { ok: false, error: 'INVALID_NAME', hint: 'nome do arquivo inválido' }
      };
    }

    fileBytes = new Uint8Array(await uploadedFile.arrayBuffer());

    const accepted = acceptUploadType(name.value, fileBytes);
    if (!accepted.ok) {
      return {
        status: 415,
        body: {
          ok: false,
          error: 'UNSUPPORTED_FILE_TYPE',
          hint: `tipos aceitos: ${allowedUploadExtensions().join(', ')}`
        }
      };
    }

    targetFileName = name.value;
  } else {
    const name = safeUploadName(new URL(request.url).searchParams.get('name'));

    if (!name.ok) {
      return {
        status: 400,
        body: { ok: false, error: 'INVALID_NAME', hint: 'passe ?name=arquivo.pdf, sem diretórios e sem ".."' }
      };
    }

    const body = await readBodyWithinLimit(request.body, maxBytes);
    if (!body.ok) {
      return { status: 413, body: { ok: false, error: 'TOO_LARGE', maxBytes } };
    }

    if (body.value.byteLength === 0) {
      return { status: 422, body: { ok: false, error: 'EMPTY_BODY' } };
    }

    const accepted = acceptUploadType(name.value, body.value);
    if (!accepted.ok) {
      return {
        status: 415,
        body: {
          ok: false,
          error: 'UNSUPPORTED_FILE_TYPE',
          hint: `tipos aceitos: ${allowedUploadExtensions().join(', ')}`
        }
      };
    }

    targetFileName = name.value;
    fileBytes = body.value;
  }

  const directory = path.join(options.baseDir, '.synapse', 'uploads', options.domain);
  const fileName = `${crypto.randomUUID().slice(0, 8)}-${targetFileName}`;
  const target = path.join(directory, fileName);

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, fileBytes);
  } catch {
    return { status: 500, body: { ok: false, error: 'WRITE_FAILED' } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      path: path.relative(options.baseDir, target).split(path.sep).join('/'),
      bytes: fileBytes.byteLength
    }
  };
}
