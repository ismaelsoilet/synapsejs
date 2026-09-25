import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compressRepositoryAST } from '../src/compiler/ast-daemon-compressor';

const exampleApp = path.resolve(import.meta.dir, '../../../examples/enterprise-crm');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-repomap-'));
const repoMapPath = path.join(outputDir, 'repo-map.d.ts');
const graphPath = path.join(outputDir, 'architecture-graph.json');

const stats = compressRepositoryAST(exampleApp, repoMapPath, graphPath);
const manifest = fs.readFileSync(repoMapPath, 'utf-8');

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('compressRepositoryAST', () => {
  it('maps every slice of the example app', () => {
    expect(stats.totalSlices).toBe(3);
  });

  it('never degrades a schema contract to any', () => {
    expect(manifest).not.toContain(': any');
  });

  it('emits the real inferred contract for each schema', () => {
    expect(manifest).toContain('export declare const InvoiceInputSchema');
    expect(manifest).toContain('customerId: string');
    expect(manifest).toContain('amountCents: number');
    expect(manifest).toContain('taxRate: number');
    expect(manifest).toContain('idempotencyToken: string');
  });

  it('keeps the manifest inside the advertised token budget', () => {
    expect(stats.manifestTokensEstimate).toBeLessThan(3000);
  });

  it('records slices with their exported actions in the architecture graph', () => {
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    const invoice = graph.find((entry: { slicePath: string }) => entry.slicePath.includes('generate-invoice'));

    expect(invoice).toBeDefined();
    expect(invoice.exportedFunctions).toContain('createInvoiceAction');
    expect(invoice.hasUI).toBe(true);
    expect(invoice.hasPBT).toBe(true);
  });
});
