/**
 * SynapseJS - Native Model Context Protocol (MCP) Server
 *
 * Exposes SynapseJS machine capabilities (repo-map, db-schema, diagnostics,
 * split verification, PBT, migrations, scaffolding, authoring contract)
 * directly to AI Agents (Cursor, Claude Code, Windsurf, Antigravity) via JSON-RPC 2.0 over stdio.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { runMachineVerifications } from '../compiler/agent-diagnostic-json';
import { machineContract } from '../compiler/contract';
import { analyzeImpact } from '../compiler/impact-analyzer';
import { rollbackSliceMigrations, runSliceMigrations } from '../compiler/migration-runner';
import { runSliceOracles } from '../compiler/oracle-runner';
import { type SliceTemplate, scaffoldCrud, scaffoldSlice } from '../compiler/scaffolder';
import { checkSchemaDrift } from '../compiler/schema-drift';
import { findSliceFiles, resolveSlicesDir } from '../compiler/slice-discovery';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../compiler/slice-splitter';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC parameter boundary
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
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
        // biome-ignore lint/suspicious/noExplicitAny: error message catch
      } catch (err: any) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` }
          })}\n`
        );
      }
    });
  }

  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC response boundary
  public async handleRequest(req: JsonRpcRequest): Promise<any> {
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
              version: '1.1.0'
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
                description:
                  'Get compressed codebase skeleton map (.codebase/repo-map.d.ts) for AI context (<3000 tokens)',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_get_db_schema',
                description:
                  'Get the centralized database schema catalog (.codebase/db-schema.d.ts) for AI context and type-safe relational queries',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_check',
                description:
                  'Run machine-centric compiler diagnostics, returning exact JSON coordinates (file, line, col, message)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    targetFile: { type: 'string', description: 'Optional specific file to check' }
                  }
                }
              },
              {
                name: 'synapse_split',
                description:
                  'Run slice splitter and leak verification gates to enforce server/client isolation and zero leakage',
                inputSchema: {
                  type: 'object',
                  properties: {
                    targetSlice: { type: 'string', description: 'Optional specific slice name to split' }
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
                description:
                  'Scaffold a new fullstack atomic vertical slice with TypeBox, Result, Action, React UI, and PBT oracles',
                inputSchema: {
                  type: 'object',
                  required: ['domain', 'name'],
                  properties: {
                    domain: { type: 'string', description: 'Domain name (e.g. billing, customers, orders)' },
                    name: { type: 'string', description: 'Slice name in kebab-case (e.g. cancel-subscription)' },
                    template: {
                      type: 'string',
                      enum: ['create', 'list', 'update', 'delete', 'login', 'oauth-github', 'crud'],
                      description: 'Optional slice template shape (default: create)'
                    },
                    fields: {
                      type: 'string',
                      description:
                        'Optional fields grammar, e.g. "name:string,email:string,status:enum(ACTIVE|INACTIVE),price:number"'
                    }
                  }
                }
              },
              {
                name: 'synapse_contract',
                description:
                  'Return the machine contract: slice exports and suffixes, Result and HTTP semantics, session rules, addressing, SSR behavior and the gates to run',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_migrate',
                description:
                  'Auto-discover and apply sliceSchema DDL declarations across slices into the active database',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_check_db_drift',
                description:
                  'Inspects live database catalog against sliceSchema DDL contracts, identifying missing tables, missing columns, and orphan tables',
                inputSchema: { type: 'object', properties: {} }
              },
              {
                name: 'synapse_diff_impact',
                description:
                  'Analyzes cross-slice dependencies (Foreign Keys, shared module imports, and table references) to report all slices impacted by a file or table change',
                inputSchema: {
                  type: 'object',
                  required: ['target'],
                  properties: {
                    target: {
                      type: 'string',
                      description: 'Slice file path, slice name, shared module path, or table name'
                    }
                  }
                }
              },
              {
                name: 'synapse_rollback',
                description: 'Roll back applied sliceSchema migrations by executing their -- down: statements',
                inputSchema: {
                  type: 'object',
                  properties: {
                    targetSlice: { type: 'string', description: 'Optional target slice to rollback' },
                    steps: { type: 'number', description: 'Number of recent migrations to rollback (default: 1)' }
                  }
                }
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
          } else if (toolName === 'synapse_get_db_schema') {
            const schemaPath = path.join(this.root, '.codebase/db-schema.d.ts');

            if (!fs.existsSync(schemaPath)) {
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
                          code: 'DB_SCHEMA_MISSING',
                          message: `db-schema.d.ts não encontrado. Gere com 'synapse skeleton'.`,
                          schemaPath
                        },
                        null,
                        2
                      )
                    }
                  ]
                }
              };
            }

            const content = fs.readFileSync(schemaPath, 'utf-8');
            contentText = JSON.stringify(
              { status: 'PASS', schemaPath: path.relative(this.root, schemaPath), schema: content },
              null,
              2
            );
          } else if (toolName === 'synapse_check') {
            const report = runMachineVerifications(this.root, args.targetFile);
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_split') {
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
                          operation: 'SLICE_SPLIT',
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

            let sliceFiles = findSliceFiles(resolution.value.slicesDir);
            if (args.targetSlice) {
              sliceFiles = sliceFiles.filter((f) => path.basename(f, '.slice.tsx') === args.targetSlice);
            }

            const slices = [];
            let failed = false;

            for (const file of sliceFiles) {
              const split = splitSlice(file, this.root);

              if (!split.ok) {
                failed = true;
                slices.push({
                  slice: path.basename(file, '.slice.tsx'),
                  status: 'FAIL',
                  code: split.error.code,
                  message: split.error.message
                });
                continue;
              }

              const outDir = artifactDirectory(this.root, split.value.sliceName);
              const written = writeSplitArtifacts(split.value, outDir);
              const verification = verifySplit(split.value, outDir);

              if (verification.status === 'FAIL') {
                failed = true;
              }

              slices.push({
                slice: split.value.sliceName,
                status: verification.status,
                outDir: path.relative(this.root, outDir),
                artifacts: written.map((target) => path.relative(this.root, target)),
                diagnostics: verification.diagnostics,
                leaks: verification.leaks
              });
            }

            const splitStatus = failed || slices.length === 0 ? 'FAIL' : 'PASS';
            contentText = JSON.stringify(
              {
                status: splitStatus,
                operation: 'SLICE_SPLIT',
                slicesDir: path.relative(this.root, resolution.value.slicesDir),
                totalProcessed: slices.length,
                slices
              },
              null,
              2
            );
          } else if (toolName === 'synapse_run_pbt') {
            const report = await runSliceOracles(this.root);

            if (
              report.status === 'FAIL' &&
              (report.code === 'NO_SLICES_DIR' || report.code === 'AMBIGUOUS_SLICES_DIR')
            ) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
                }
              };
            }

            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_scaffold_slice') {
            if (args.template === 'crud') {
              const crud = scaffoldCrud(args.domain, args.name, this.root, args.fields);

              if (!crud.ok) {
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
                            code: crud.error.code,
                            message: crud.error.message,
                            candidates: crud.error.candidates
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
                {
                  status: 'PASS',
                  operation: 'SCAFFOLD_CRUD',
                  domain: args.domain,
                  resource: args.name,
                  createdPaths: crud.value.map((file) => path.relative(this.root, file))
                },
                null,
                2
              );
            } else {
              const created = scaffoldSlice(
                args.domain,
                args.name,
                this.root,
                (args.template || 'create') as SliceTemplate,
                args.fields
              );

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
            }
          } else if (toolName === 'synapse_contract') {
            contentText = JSON.stringify(machineContract(), null, 2);
          } else if (toolName === 'synapse_migrate') {
            const report = await runSliceMigrations(this.root);
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_check_db_drift') {
            const report = await checkSchemaDrift(this.root);
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_diff_impact') {
            if (!args.target) {
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
                          code: 'MISSING_TARGET',
                          message: 'Argumento target obrigatório'
                        },
                        null,
                        2
                      )
                    }
                  ]
                }
              };
            }
            const report = analyzeImpact(args.target, this.root);
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_rollback') {
            const report = await rollbackSliceMigrations(this.root, undefined, {
              targetSlice: args.targetSlice,
              steps: args.steps
            });
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
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ status: 'ERROR', error: message }, null, 2)
                }
              ]
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
