import { describe, expect, it } from 'bun:test';
import {
  modulateReasoningEffort,
  shouldAbortTrajectory,
  triageTestFailure,
  verifyStepCompletion
} from '@ismaelsoilet/jev-harness';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSliceOracles } from '../src/compiler/oracle-runner';
import { SynapseMcpServer } from '../src/mcp/server';

describe('Jev System One Integration with SynapseJS', () => {
  it('triages test failure deterministically when dependencies or environment are missing', async () => {
    const errorTrace = `
      Error: Cannot find module '@types/missing-package'
      at require (internal/modules/cjs/loader.js:882:18)
      at Object.<anonymous> (src/slices/tickets/create.slice.tsx:4:1)
    `;
    const triage = await triageTestFailure(errorTrace);
    expect(triage).toBeDefined();
    expect(triage.category).toBe('env_missing');
    expect(triage.skipLlm).toBe(true);
    expect(triage.actionRecommendation).toContain('Do NOT call LLM');
  });

  it('evaluates abort-check when an agent is stuck in a circular error trajectory', async () => {
    const plan = 'Reescrever completamente o schema de tickets excluindo tabelas existentes';
    const history =
      'Tentativa 1 falhou com Foreign key constraint failed. Tentativa 2 falhou com deadlock timeout. Tentativa 3 falhou com crash de migração.';
    const abortResult = await shouldAbortTrajectory(plan, history);

    expect(abortResult).toBeDefined();
    expect(typeof abortResult.shouldAbort).toBe('boolean');
    expect(typeof abortResult.abortProbability).toBe('number');
    expect(abortResult.abortProbability).toBeGreaterThan(0.5);
  });

  it('verifies acceptance criteria completion with verifyStepCompletion', async () => {
    const criteria = 'Deve retornar status PASS com 5 fatias verificadas e 0 vazamentos';
    const output = 'status: PASS, fatias: 5, vazamentos: 0 detectados. Todos os oráculos PBT passaram.';
    const verification = await verifyStepCompletion(criteria, output);

    expect(verification).toBeDefined();
    expect(typeof verification.isVerified).toBe('boolean');
    expect(typeof verification.confidence).toBe('number');
  });

  it('modulates reasoning effort for mechanical SynapseJS operations (Astra-Jev)', async () => {
    const effortResult = await modulateReasoningEffort('synapse split --all', { provider: 'openai' });
    expect(effortResult).toBeDefined();
    expect(['low', 'medium']).toContain(effortResult.effort);
    expect(effortResult.cacheSafeRecommendation).toBeDefined();
  });

  it('enriches runSliceOracles report with Jev triage on failure', async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-jev-test-'));
    try {
      // Mock runner that simulates a failed test output
      const mockSpawn = async () => ({
        exitCode: 1,
        output: 'TypeError: undefined is not a function at Object.run (test.oracle.test.ts:15:10)'
      });

      const slicesDir = path.join(sandbox, 'src', 'slices', 'demo');
      fs.mkdirSync(slicesDir, { recursive: true });
      fs.writeFileSync(
        path.join(slicesDir, 'sample.slice.tsx'),
        `
        export const sliceTests = {
          cases: [{ name: 'sample case', run: () => { throw new Error('fail'); } }]
        };
        `,
        'utf-8'
      );

      const report = await runSliceOracles(sandbox, {
        spawn: mockSpawn,
        enableJevTriage: true
      });

      expect(report.status).toBe('FAIL');
      expect(report.triage).toBeDefined();
      expect(typeof report.triage?.category).toBe('string');
      expect(typeof report.triage?.confidence).toBe('number');
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('handles SynapseMcpServer Jev tools via JSON-RPC handleRequest', async () => {
    const server = new SynapseMcpServer();

    // 1. synapse_abort_check
    const abortRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'synapse_abort_check',
        arguments: {
          plan: 'Apagar tudo e tentar de novo',
          history: 'Falha 1, Falha 2, Falha 3'
        }
      }
    });
    expect(abortRes.error).toBeUndefined();
    const abortData = JSON.parse(abortRes.result.content[0].text);
    expect(typeof abortData.shouldAbort).toBe('boolean');

    // 2. synapse_verify_completion
    const verifyRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'synapse_verify_completion',
        arguments: {
          criteria: 'Passar em todos os testes',
          output: 'Todos os testes passaram com 100% de sucesso.'
        }
      }
    });
    expect(verifyRes.error).toBeUndefined();
    const verifyData = JSON.parse(verifyRes.result.content[0].text);
    expect(typeof verifyData.isVerified).toBe('boolean');

    // 3. synapse_reasoning_effort
    const effortRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'synapse_reasoning_effort',
        arguments: {
          context: 'synapse skeleton'
        }
      }
    });
    expect(effortRes.error).toBeUndefined();
    const effortData = JSON.parse(effortRes.result.content[0].text);
    expect(['low', 'medium', 'high']).toContain(effortData.effort);
  });
});
