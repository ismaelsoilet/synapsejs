import { describe, expect, test } from 'bun:test';
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

  test('returns 0 impacted slices gracefully when target does not exist', () => {
    const report = analyzeImpact('non-existent-slice', exampleCrmDir);

    expect(report.status).toBe('PASS');
    expect(report.totalImpacted).toBe(0);
    expect(report.impactedSlices).toHaveLength(0);
  });
});
