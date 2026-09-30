import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeImpact } from '../src/compiler/impact-analyzer';

describe('AST Diff & Cross-Slice Impact Analyzer', () => {
  const exampleCrmDir = path.resolve(__dirname, '../../../examples/enterprise-crm');

  test('analyzes impact when target is a slice owning a referenced table', () => {
    const report = analyzeImpact('create-customer', exampleCrmDir);

    expect(report.status).toBe('PASS');
    expect(report.targetType).toBe('slice');
    expect(report.totalImpacted).toBeGreaterThanOrEqual(2);

    // create-customer should be DIRECT
    const direct = report.impactedSlices.find((s) => s.sliceName === 'create-customer');
    expect(direct).toBeDefined();
    expect(direct?.reason).toBe('DIRECT');

    // generate-invoice has FOREIGN KEY (customer_id) REFERENCES customers(id)
    const fkDep = report.impactedSlices.find((s) => s.sliceName === 'generate-invoice');
    expect(fkDep).toBeDefined();
    expect(fkDep?.reason).toBe('FOREIGN_KEY_DEPENDENCY');

    expect(report.recommendedCommands).toContain('synapse check');
    expect(report.recommendedCommands).toContain('synapse split');
    expect(report.recommendedCommands).toContain('synapse test');
  });

  test('analyzes impact when target is a database table', () => {
    const report = analyzeImpact('customers', exampleCrmDir);

    expect(report.status).toBe('PASS');
    expect(report.targetType).toBe('table');

    const createCustomer = report.impactedSlices.find((s) => s.sliceName === 'create-customer');
    expect(createCustomer).toBeDefined();
    expect(createCustomer?.reason).toBe('DIRECT');

    const generateInvoice = report.impactedSlices.find((s) => s.sliceName === 'generate-invoice');
    expect(generateInvoice).toBeDefined();
    expect(generateInvoice?.reason).toBe('FOREIGN_KEY_DEPENDENCY');

    expect(report.recommendedCommands).toContain('synapse db-drift');
  });

  test('fails for a target that does not exist instead of reporting an empty success', () => {
    const report = analyzeImpact('non-existent-slice', exampleCrmDir);

    expect(report.status).toBe('FAIL');
    expect(report.code).toBe('TARGET_NOT_RESOLVED');
    expect(report.message).toContain('non-existent-slice');
    expect(report.totalImpacted).toBe(0);
  });

  test('succeeds with zero dependents for a target that does exist', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-impact-'));
    fs.mkdirSync(path.join(sandbox, 'src', 'slices', 'solo'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'src', 'shared'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'src', 'slices', 'solo', 'only.slice.tsx'),
      `export const OnlyInputSchema = {};
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS only_table (id TEXT PRIMARY KEY);';
export async function onlyAction() { return { ok: true }; }
`,
      'utf-8'
    );
    fs.writeFileSync(path.join(sandbox, 'src', 'shared', 'unused.ts'), 'export const unused = 1;\n', 'utf-8');

    try {
      const slice = analyzeImpact('only', sandbox);
      expect(slice.status).toBe('PASS');
      expect(slice.totalImpacted).toBe(1);
      expect(slice.code).toBeUndefined();

      // A module that exists but no slice imports is valid with zero dependents.
      const orphan = analyzeImpact('src/shared/unused.ts', sandbox);
      expect(orphan.status).toBe('PASS');
      expect(orphan.totalImpacted).toBe(0);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
