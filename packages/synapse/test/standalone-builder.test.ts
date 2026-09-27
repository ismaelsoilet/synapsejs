import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildStandalone } from '../src/compiler/standalone-builder';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-standalone-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('buildStandalone', () => {
  it('fails with NO_SLICES_DIR when no slices exist in app', async () => {
    const report = await buildStandalone(sandbox);
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect('code' in report.error ? report.error.code : '').toBe('NO_SLICES_DIR');
    }
  });

  it('builds standalone distribution with client bundles and server bootstrap', async () => {
    const slicesDir = path.join(sandbox, 'src', 'slices', 'billing');
    fs.mkdirSync(slicesDir, { recursive: true });

    // Slice with Component
    const sliceContent = `
import React from 'react';
import { Type, Static } from '@sinclair/typebox';
import { type DatabaseClient, Ok, Err, type Result } from 'synapsejs';

export const InvoiceInputSchema = Type.Object({ id: Type.String() });
export type InvoiceInput = Static<typeof InvoiceInputSchema>;
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY);';
export type InvoiceOutput = Result<{ id: string }, 'ERROR'>;

export async function invoiceAction(payload: unknown, db?: DatabaseClient): Promise<InvoiceOutput> {
  return Ok({ id: '123' });
}

export function InvoiceTrigger() {
  return <div>Invoice Test</div>;
}
`;
    fs.writeFileSync(path.join(slicesDir, 'invoice.slice.tsx'), sliceContent, 'utf-8');

    // Create a mock tsconfig.json so client bundle can resolve
    fs.writeFileSync(
      path.join(sandbox, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          jsx: 'react-jsx',
          moduleResolution: 'bundler',
          paths: {
            synapsejs: [path.resolve(import.meta.dir, '../src/index.ts')]
          }
        }
      }),
      'utf-8'
    );

    const report = await buildStandalone(sandbox);
    expect(report.ok).toBe(true);

    if (report.ok) {
      expect(report.value.status).toBe('PASS');
      const standalone = path.join(sandbox, '.synapse', 'standalone');
      expect(fs.existsSync(standalone)).toBe(true);
      expect(fs.existsSync(path.join(standalone, 'server.ts'))).toBe(true);
      expect(fs.existsSync(path.join(standalone, 'src', 'slices', 'billing', 'invoice.slice.tsx'))).toBe(true);
      const serverCode = fs.readFileSync(path.join(standalone, 'server.ts'), 'utf-8');
      expect(serverCode).toContain('SynapseServer');
      expect(serverCode).toContain('new SynapseServer(import.meta.dir, port)');
      expect(serverCode).toContain('await server.discoverSlices()');
      expect(serverCode).toContain('await server.start()');
    }
  });
});
