import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(import.meta.dir, '../bin/synapse.ts');

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-mcp-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

interface McpResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string };
}

async function runMcp(requests: unknown[], cwd: string = sandbox): Promise<{ responses: McpResponse[]; exitCode: number }> {
  const env = { ...process.env } as Record<string, string>;
  delete env.SYNAPSE_ROOT;

  const proc = Bun.spawn([process.execPath, 'run', CLI, 'mcp'], {
    cwd,
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe'
  });

  proc.stdin.write(requests.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  const responses = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as McpResponse);

  return { responses, exitCode };
}

describe('SynapseMcpServer over stdio', () => {
  it('completes the JSON-RPC handshake and lists its five tools', async () => {
    const { responses } = await runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    ]);

    expect(responses.length).toBe(2);

    const init = responses.find((r) => r.id === 1);
    expect(init?.error).toBeUndefined();
    expect(init?.result.serverInfo.name).toBe('synapse-mcp');
    expect(typeof init?.result.protocolVersion).toBe('string');

    const list = responses.find((r) => r.id === 2);
    const toolNames = list?.result.tools.map((t: { name: string }) => t.name).sort();
    expect(toolNames).toEqual([
      'synapse_check',
      'synapse_get_repo_map',
      'synapse_migrate',
      'synapse_run_pbt',
      'synapse_scaffold_slice'
    ]);
    expect(list?.result.tools.every((t: { description?: string }) => Boolean(t.description))).toBe(true);
  });

  it('rejects unknown methods and unknown tools with JSON-RPC errors', async () => {
    const { responses } = await runMcp([
      { jsonrpc: '2.0', id: 1, method: 'does/not/exist' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } }
    ]);

    expect(responses.find((r) => r.id === 1)?.error?.code).toBe(-32601);
    expect(responses.find((r) => r.id === 2)?.error?.code).toBe(-32601);
  });

  it('does not generate the repo map as a side effect of reading it', async () => {
    const { responses } = await runMcp([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'synapse_get_repo_map', arguments: {} } }
    ]);

    const payload = JSON.parse(responses[0].result.content[0].text);
    expect(payload.code).toBe('REPO_MAP_MISSING');
    expect(responses[0].result.isError).toBe(true);
    expect(fs.existsSync(path.join(sandbox, '.codebase'))).toBe(false);
  });

  it('fails instead of reporting a green PBT run when no slices exist', async () => {
    const { responses } = await runMcp([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'synapse_run_pbt', arguments: {} } }
    ]);

    const payload = JSON.parse(responses[0].result.content[0].text);
    expect(responses[0].result.isError).toBe(true);
    expect(payload.status).toBe('FAIL');
    expect(payload.code).toBe('NO_SLICES_DIR');
  });

  it('scaffolds a slice that resolves against the package entry', async () => {
    const { responses } = await runMcp([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'synapse_scaffold_slice', arguments: { domain: 'orders', name: 'process-checkout' } }
      }
    ]);

    const payload = JSON.parse(responses[0].result.content[0].text);
    expect(payload.status).toBe('PASS');
    expect(payload.createdPath).toBe(path.join('src', 'slices', 'orders', 'process-checkout.slice.tsx'));
    expect(fs.readFileSync(path.join(sandbox, payload.createdPath), 'utf-8')).toContain(`from 'synapsejs'`);
  });
});
