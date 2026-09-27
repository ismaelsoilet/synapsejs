import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { AnonymousSession, createActionContext, MockDatabaseClient } from '../src/core';
import { LocalStorageAdapter, resetStorageInstance, S3StorageAdapter, sanitizeStorageKey } from '../src/core/storage';

describe('Storage Abstraction - Key Sanitization', () => {
  test('sanitizeStorageKey accepts clean relative paths', () => {
    expect(sanitizeStorageKey('avatar.png')).toBe('avatar.png');
    expect(sanitizeStorageKey('users/123/profile.jpg')).toBe('users/123/profile.jpg');
    expect(sanitizeStorageKey('/leading/slash.pdf')).toBe('leading/slash.pdf');
  });

  test('sanitizeStorageKey rejects directory traversal attempts', () => {
    expect(() => sanitizeStorageKey('../../etc/passwd')).toThrow('Invalid storage key');
    expect(() => sanitizeStorageKey('photos/../../../secret.env')).toThrow('Invalid storage key');
  });
});

describe('Storage Abstraction - LocalStorageAdapter', () => {
  const testUploadDir = path.join(process.cwd(), '.synapse/test-uploads');

  afterEach(() => {
    if (fs.existsSync(testUploadDir)) {
      fs.rmSync(testUploadDir, { recursive: true, force: true });
    }
  });

  test('LocalStorageAdapter uploads, reads and deletes files', async () => {
    const storage = new LocalStorageAdapter({ uploadDir: testUploadDir });

    const content = 'Relatório de Auditoria FiscalizaPlus - 2026';
    const result = await storage.upload('reports/audit-01.txt', content, 'text/plain');

    expect(result.key).toBe('reports/audit-01.txt');
    expect(result.url).toBe('/_synapse/uploads/reports/audit-01.txt');
    expect(result.size).toBe(Buffer.byteLength(content));

    // Verify file written to disk
    const onDisk = fs.readFileSync(path.join(testUploadDir, 'reports/audit-01.txt'), 'utf-8');
    expect(onDisk).toBe(content);

    // Presigned upload URL
    const presigned = await storage.getPresignedUploadUrl('reports/audit-02.txt');
    expect(presigned).toContain('/_synapse/api/upload?key=reports%2Faudit-02.txt');

    // Delete
    const deleted = await storage.delete('reports/audit-01.txt');
    expect(deleted).toBe(true);
    expect(fs.existsSync(path.join(testUploadDir, 'reports/audit-01.txt'))).toBe(false);
  });
});

describe('Storage Abstraction - S3StorageAdapter', () => {
  test('S3StorageAdapter generates URLs and SigV4 Presigned Upload URLs', async () => {
    const s3 = new S3StorageAdapter({
      bucket: 'fiscalizaplus-docs',
      region: 'us-east-1',
      accessKeyId: 'AKIA_TEST_KEY',
      secretAccessKey: 'SECRET_TEST_KEY',
      publicUrlPrefix: 'https://cdn.fiscalizaplus.com.br'
    });

    // Public URL
    const url = s3.getUrl('laudos/laudo-2026.pdf');
    expect(url).toBe('https://cdn.fiscalizaplus.com.br/laudos/laudo-2026.pdf');

    // Presigned upload URL
    const presigned = await s3.getPresignedUploadUrl('laudos/novo-laudo.pdf', 600);
    expect(presigned).toContain('https://fiscalizaplus-docs.s3.us-east-1.amazonaws.com/laudos/novo-laudo.pdf');
    expect(presigned).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(presigned).toContain('X-Amz-Expires=600');
    expect(presigned).toContain('X-Amz-Signature=');

    // Prove it is a genuine 64-character hex SigV4 signature, not a mock string
    const match = presigned.match(/X-Amz-Signature=([0-9a-f]{64})/);
    expect(match).not.toBeNull();
    expect(match?.[1].length).toBe(64);
  });

  test('ActionContext exposes storage client to slice actions', async () => {
    resetStorageInstance();
    const ctx = createActionContext({
      db: new MockDatabaseClient(),
      session: AnonymousSession()
    });

    expect(ctx.storage).toBeDefined();
    expect(typeof ctx.storage.upload).toBe('function');
    expect(typeof ctx.storage.getPresignedUploadUrl).toBe('function');
  });
});
