import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { createSession } from '../src/core/session-context';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  maxUploadBytes,
  readBodyWithinLimit,
  safeUploadName,
  saveUpload
} from '../src/runtime/uploads';

const sandbox = fs.mkdtempSync(path.join('/tmp', 'synapse-upload-'));
const session = createSession({ userId: 'u1', roles: ['user'] });

function uploadDirectory(): string {
  return path.join(sandbox, '.synapse', 'uploads', 'docs');
}

describe('upload names', () => {
  it('accepts a plain file name', () => {
    const result = safeUploadName('contrato-2026.pdf');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('contrato-2026.pdf');
    }
  });

  it('refuses a name that tries to leave the directory instead of rewriting it', () => {
    for (const name of ['../../etc/passwd', 'sub/dir.txt', '..', '.hidden', '-flag.txt', '', null]) {
      expect(safeUploadName(name).ok).toBe(false);
    }
  });

  it('refuses a name longer than the limit', () => {
    expect(safeUploadName(`${'a'.repeat(121)}.txt`).ok).toBe(false);
  });
});

describe('upload limit', () => {
  it('defaults to 5 MiB and reads SYNAPSE_MAX_UPLOAD_BYTES', () => {
    expect(maxUploadBytes(undefined)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytes('1024')).toBe(1024);
    expect(maxUploadBytes('nonsense')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytes('0')).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('stops reading once the body passes the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      }
    });

    const result = await readBodyWithinLimit(stream, 1000);

    expect(result.ok).toBe(false);
  });
});

describe('saveUpload', () => {
  it('refuses an anonymous caller before touching the disk', async () => {
    const request = new Request('http://localhost/_synapse/files/docs/contrato?name=a.txt', {
      method: 'POST',
      body: 'x'
    });

    const outcome = await saveUpload(request, {
      baseDir: sandbox,
      domain: 'docs',
      session: createSession({ userId: 'nobody' })
    });

    expect(outcome.status).toBe(200);

    const anonymous = await saveUpload(request, {
      baseDir: sandbox,
      domain: 'docs',
      session: { roles: [], isAuthenticated: false }
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toBe('UNAUTHORIZED');
  });

  it('requires a name and refuses a directory in it', async () => {
    const withoutName = await saveUpload(
      new Request('http://localhost/_synapse/files/docs/x', { method: 'POST', body: 'x' }),
      {
        baseDir: sandbox,
        domain: 'docs',
        session
      }
    );

    expect(withoutName.status).toBe(400);
    expect(withoutName.body.error).toBe('INVALID_NAME');

    const withDirectory = await saveUpload(
      new Request('http://localhost/_synapse/files/docs/x?name=../../escape.txt', { method: 'POST', body: 'x' }),
      { baseDir: sandbox, domain: 'docs', session }
    );

    expect(withDirectory.status).toBe(400);
    expect(fs.existsSync(path.join(sandbox, 'escape.txt'))).toBe(false);
  });

  it('answers 413 when the declared size is over the limit, before reading anything', async () => {
    const request = new Request('http://localhost/_synapse/files/docs/x?name=grande.bin', {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024) },
      body: 'x'
    });

    const before = fs.existsSync(uploadDirectory()) ? fs.readdirSync(uploadDirectory()).length : 0;

    const outcome = await saveUpload(request, { baseDir: sandbox, domain: 'docs', session, maxBytes: 1024 });

    expect(outcome.status).toBe(413);
    expect(outcome.body.error).toBe('TOO_LARGE');
    const after = fs.existsSync(uploadDirectory()) ? fs.readdirSync(uploadDirectory()).length : 0;
    expect(after).toBe(before);
  });

  it('answers 422 for an empty body', async () => {
    const outcome = await saveUpload(
      new Request('http://localhost/_synapse/files/docs/x?name=vazio.txt', { method: 'POST', body: '' }),
      { baseDir: sandbox, domain: 'docs', session }
    );

    expect(outcome.status).toBe(422);
    expect(outcome.body.error).toBe('EMPTY_BODY');
  });

  it('stores the bytes inside the upload directory and returns a relative path', async () => {
    const outcome = await saveUpload(
      new Request('http://localhost/_synapse/files/docs/x?name=contrato.txt', {
        method: 'POST',
        body: 'conteudo real'
      }),
      { baseDir: sandbox, domain: 'docs', session }
    );

    expect(outcome.status).toBe(200);
    expect(outcome.body.bytes).toBe(13);

    const stored = String(outcome.body.path);
    expect(stored.startsWith('.synapse/uploads/docs/')).toBe(true);
    expect(stored.endsWith('-contrato.txt')).toBe(true);
    expect(fs.readFileSync(path.join(sandbox, stored), 'utf-8')).toBe('conteudo real');
  });
});
