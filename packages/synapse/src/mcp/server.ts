/**
 * SynapseJS - Native Model Context Protocol (MCP) Server
 * 
 * Exposes SynapseJS machine capabilities (repo-map, diagnostics, PBT, migrations, scaffolding)
 * directly to AI Agents (Cursor, Claude Code, Windsurf, Antigravity) via JSON-RPC 2.0 over stdio.
 */

import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { runMachineVerifications } from '../compiler/agent-diagnostic-json';
import { scaffoldSlice } from '../compiler/scaffolder';
import { runSliceMigrations } from '../compiler/migration-runner';
import { findSliceFiles, resolveSlicesDir } from '../compiler/slice-discovery';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

export class SynapseMcpServer {
  private root: string;

  constructor(root: string = process.cwd()) {
    this.root = root;
  }

  start() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const request: JsonRpcRequest = JSON.parse(trimmed);
        const response = await this.handleRequest(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err: any) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` }
          }) + '\n'
        );
      }
    });
  }

  private async handleRequest(req: JsonRpcRequest): Promise<any> {
    const { id, method, params } = req;

    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'synapse-mcp',
              version: '0.4.0'
            }
          }
        };
      }

      case 'notifications/initialized': {
        return null;
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'synapse_get_repo_map',
                description: 'Get compressed codebase skeleton map (.codebase/repo-map.d.ts) for AI context (<3000 tokens)',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_check',
                description: 'Run machine-centric compiler diagnostics, returning exact JSON coordinates (file, line, col, message)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    targetFile: { type: 'string', description: 'Optional specific file to check' }
                  }
                }
              },
              {
                name: 'synapse_run_pbt',
                description: 'Execute Fast-Check Property-Based Testing (PBT) invariant test suite across all slices',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_scaffold_slice',
                description: 'Scaffold a new fullstack atomic vertical slice with TypeBox, Result, Action, React UI and PBT',
                inputSchema: {
                  type: 'object',
                  required: ['domain', 'name'],
                  properties: {
                    domain: { type: 'string', description: 'Domain name (e.g. billing, customers, orders)' },
                    name: { type: 'string', description: 'Slice name in kebab-case (e.g. cancel-subscription)' }
                  }
                }
              },
              {
                name: 'synapse_migrate',
                description: 'Auto-discover and apply sliceSchema DDL declarations across slices into the active database',
                inputSchema: { type: 'object', properties: {} }
              }
            ]
          }
        };
      }

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};

        let contentText = '';

        try {
          if (toolName === 'synapse_get_repo_map') {
            const repoMapPath = path.join(this.root, '.codebase/repo-map.d.ts');

            if (!fs.existsSync(repoMapPath)) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          status: 'FAIL',
                          code: 'REPO_MAP_MISSING',
                          message: `repo-map.d.ts não encontrado. Gere com 'synapse skeleton'.`,
                          repoMapPath
                        },
                        null,
                        2
                      )
                    }
                  ]
                }
              };
            }

            const content = fs.readFileSync(repoMapPath, 'utf-8');
            contentText = JSON.stringify(
              { status: 'PASS', repoMapPath: path.relative(this.root, repoMapPath), repoMap: content },
              null,
              2
            );
          } else if (toolName === 'synapse_check') {
            const report = runMachineVerifications(this.root, args.targetFile);
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_run_pbt') {
            const resolution = resolveSlicesDir(this.root);

            if (!resolution.ok) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          status: 'FAIL',
                          code: resolution.error.code,
                          message: resolution.error.message,
                          candidates: resolution.error.candidates
                        },
                        null,
                        2
                      )
                    }
                  ]
                }
              };
            }

            const files = findSliceFiles(resolution.value.slicesDir);
            const results = [];
            for (const f of files) {
              const proc = Bun.spawn([process.execPath, 'run', f], { cwd: this.root, stdout: 'pipe', stderr: 'pipe' });
              const [stdout, stderr, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited
              ]);
              results.push({
                slice: path.basename(f, '.slice.tsx'),
                passed: code === 0,
                output: (stdout + (stderr ? '\n' + stderr : '')).trim()
              });
            }

            const allPassed = results.length > 0 && results.every((r) => r.passed);
            contentText = JSON.stringify(
              {
                status: allPassed ? 'PASS' : 'FAIL',
                totalSlices: results.length,
                passedSlices: results.filter((r) => r.passed).length,
                slicesDir: path.relative(this.root, resolution.value.slicesDir),
                results
              },
              null,
              2
            );
          } else if (toolName === 'synapse_scaffold_slice') {
            const created = scaffoldSlice(args.domain, args.name, this.root);

            if (!created.ok) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          status: 'FAIL',
                          code: created.error.code,
                          message: created.error.message,
                          candidates: created.error.candidates
                        },
                        null,
                        2
                      )
                    }
                  ]
                }
              };
            }

            contentText = JSON.stringify(
              { status: 'PASS', createdPath: path.relative(this.root, created.value) },
              null,
              2
            );
          } else if (toolName === 'synapse_migrate') {
            const report = await runSliceMigrations(this.root);
            contentText = JSON.stringify(report, null, 2);
          } else {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown tool: ${toolName}` }
            };
          }

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: contentText
                }
              ]
            }
          };
        } catch (err: any) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [{ type: 'text', text: `Tool error: ${err.message}` }]
            }
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
      }
    }
  }
}

if (import.meta.main) {
  const server = new SynapseMcpServer();
  server.start();
}
