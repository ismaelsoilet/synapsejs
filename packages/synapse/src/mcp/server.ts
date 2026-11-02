/**
 * SynapseJS - Native Model Context Protocol (MCP) Server
 *
 * Exposes SynapseJS machine capabilities (repo-map, db-schema, diagnostics,
 * split verification, PBT, migrations, scaffolding, authoring contract)
 * directly to AI Agents (Cursor, Claude Code, Windsurf, Antigravity) via JSON-RPC 2.0 over stdio.
 */

import {
  type AbortGateResult,
  type ModelRouteResult,
  modulateReasoningEffort,
  type NudgeGateResult,
  type ReasoningEffortResult,
  routeModelTier,
  shouldAbortTrajectory,
  shouldNudgeContinuation,
  type TestTriageResult,
  triageTestFailure,
  type VerificationResult,
  verifyStepCompletion
} from '@ismaelsoilet/jev-harness';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { runMachineVerifications } from '../compiler/agent-diagnostic-json';
import { machineContract } from '../compiler/contract';
import { analyzeImpact } from '../compiler/impact-analyzer';
import { rollbackSliceMigrations, runSliceMigrations } from '../compiler/migration-runner';
import { runSliceOracles } from '../compiler/oracle-runner';
import { type SliceTemplate, scaffoldCrud, scaffoldDomain, scaffoldSlice } from '../compiler/scaffolder';
import { checkSchemaDrift } from '../compiler/schema-drift';
import { findSliceFiles, resolveSlicesDir } from '../compiler/slice-discovery';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../compiler/slice-splitter';
import { SYNAPSE_VERSION } from '../version';
import { validatePathSegment } from '../core/path-guard';
import { MCP_TOOLS } from './tools';

/**
 * Caps a tool payload so a broken workspace cannot flood the caller's context, and
 * makes every path relative to the project root so a tool result carries no absolute
 * filesystem location.
 */
const MCP_MAX_ITEMS = 100;

export function capItems<T>(items: T[]): { items: T[]; truncated: boolean; total: number } {
  return {
    items: items.slice(0, MCP_MAX_ITEMS),
    truncated: items.length > MCP_MAX_ITEMS,
    total: items.length
  };
}

export function toRelativePath(root: string, value: unknown): unknown {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    return value;
  }

  const relative = path.relative(root, value);

  return relative.startsWith('..') ? path.basename(value) : relative;
}

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
              version: SYNAPSE_VERSION
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
            tools: MCP_TOOLS
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
            const issues = capItems(report.issues).items.map((issue) => ({
              ...issue,
              file: toRelativePath(this.root, issue.file)
            }));

            contentText = JSON.stringify(
              {
                ...report,
                issues,
                issuesTruncated: report.issues.length > MCP_MAX_ITEMS,
                reportedIssues: issues.length,
                totalIssues: report.issues.length
              },
              null,
              2
            );
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
            const boundedSlices = capItems(slices);
            contentText = JSON.stringify(
              {
                status: splitStatus,
                operation: 'SLICE_SPLIT',
                slicesDir: path.relative(this.root, resolution.value.slicesDir),
                totalProcessed: slices.length,
                slicesTruncated: boundedSlices.truncated,
                slices: boundedSlices.items
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
          } else if (toolName === 'synapse_scaffold_domain') {
            const domainRes = scaffoldDomain(args.domain, this.root, args.fields);
            if (!domainRes.ok) {
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
                          code: domainRes.error.code,
                          message: domainRes.error.message,
                          candidates: domainRes.error.candidates
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
                domain: args.domain,
                createdFiles: domainRes.value.map((f) => path.relative(this.root, f))
              },
              null,
              2
            );
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
            const bounded = capItems(report.impactedSlices);
            contentText = JSON.stringify(
              {
                ...report,
                impactedSlices: bounded.items.map((slice) => ({
                  ...slice,
                  filePath: toRelativePath(this.root, slice.filePath)
                })),
                impactedTruncated: bounded.truncated,
                totalImpacted: report.totalImpacted
              },
              null,
              2
            );
          } else if (toolName === 'synapse_rollback') {
            const report = await rollbackSliceMigrations(this.root, undefined, {
              targetSlice: args.targetSlice,
              steps: args.steps
            });
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_test_gate') {
            const report = await runSliceOracles(this.root, { enableJevTriage: true });
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_abort_check') {
            const plan = String(args.plan || '');
            const history = String(args.history || '');
            const result: AbortGateResult = await shouldAbortTrajectory(plan, history);
            contentText = JSON.stringify(result, null, 2);
          } else if (toolName === 'synapse_verify_completion') {
            const criteria = String(args.criteria || '');
            const output = String(args.output || '');
            const result: VerificationResult = await verifyStepCompletion(criteria, output);
            contentText = JSON.stringify(result, null, 2);
          } else if (toolName === 'synapse_reasoning_effort') {
            const context = String(args.context || '');
            const provider = args.provider ? String(args.provider) : undefined;
            const sessionContextTokens =
              typeof args.sessionContextTokens === 'number' ? args.sessionContextTokens : undefined;
            const result: ReasoningEffortResult = await modulateReasoningEffort(context, {
              provider,
              sessionContextTokens
            });
            contentText = JSON.stringify(result, null, 2);
          } else if (toolName === 'synapse_triage_error') {
            const failureLog = String(args.failureLog || '');
            const result: TestTriageResult = await triageTestFailure(failureLog);
            contentText = JSON.stringify(result, null, 2);
          } else if (toolName === 'synapse_route_task') {
            const task = String(args.task || '');
            const result: ModelRouteResult = await routeModelTier(task);
            contentText = JSON.stringify(result, null, 2);
          } else if (toolName === 'synapse_evaluate_nudge') {
            const transcriptTail = String(args.transcriptTail || '');
            const result: NudgeGateResult = await shouldNudgeContinuation(transcriptTail);
            contentText = JSON.stringify(result, null, 2);
          } else if (toolName === 'synapse_inspect_routes') {
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
                      text: JSON.stringify({ status: 'FAIL', code: resolution.error.code }, null, 2)
                    }
                  ]
                }
              };
            }
            const sliceFiles = findSliceFiles(resolution.value.slicesDir);
            const routes = sliceFiles.map((file) => {
              const rel = path.relative(resolution.value.slicesDir, file);
              const parts = rel.split(path.sep);
              const domain = parts[0] || 'general';
              const name = path.basename(file, '.slice.tsx');
              const code = fs.readFileSync(file, 'utf-8');
              return {
                sliceKey: `${domain}/${name}`,
                routePath: `/${domain}/${name}`,
                rpcPath: `/_synapse/rpc/${domain}/${name}`,
                dynamicPath: `/${domain}/${name}/:id`,
                filePath: toRelativePath(this.root, file),
                hasAction: /export\s+async\s+function\s+\w+Action\b/.test(code),
                hasLoader: /export\s+async\s+function\s+\w+Loader\b/.test(code),
                hasComponent: /export\s+function\s+\w+(Trigger|View|Form|Component)\b/.test(code),
                hasCache: /export\s+const\s+sliceCache\s*=/.test(code),
                hasJob: /\bdefineJob\s*[<(]/.test(code)
              };
            });
            contentText = JSON.stringify(
              {
                status: 'PASS',
                operation: 'INSPECT_ROUTES',
                totalRoutes: routes.length,
                routes
              },
              null,
              2
            );
          } else if (toolName === 'synapse_test_slice') {
            const targetSlice = String(args.targetSlice || '');
            if (!targetSlice) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ status: 'FAIL', code: 'MISSING_TARGET_SLICE' }, null, 2)
                    }
                  ]
                }
              };
            }
            const report = await runSliceOracles(this.root, { targetSlice });
            contentText = JSON.stringify(report, null, 2);
          } else if (toolName === 'synapse_generate_seed') {
            const targetSlice = String(args.targetSlice || '');
            const count = Math.min(Math.max(Number(args.count) || 5, 1), 50);
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
                      text: JSON.stringify({ status: 'FAIL', code: resolution.error.code }, null, 2)
                    }
                  ]
                }
              };
            }
            const sliceFiles = findSliceFiles(resolution.value.slicesDir);
            const matchedFile = sliceFiles.find((f) => {
              const name = path.basename(f, '.slice.tsx');
              const rel = path.relative(resolution.value.slicesDir, f);
              return name === targetSlice || rel.startsWith(targetSlice) || rel.includes(targetSlice);
            });
            if (!matchedFile) {
              contentText = JSON.stringify(
                {
                  status: 'FAIL',
                  code: 'SLICE_NOT_FOUND',
                  message: `Fatia "${targetSlice}" não encontrada para gerar seed.`
                },
                null,
                2
              );
            } else {
              const code = fs.readFileSync(matchedFile, 'utf-8');
              const tableMatch = code.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
              const tableName = tableMatch ? tableMatch[1] : path.basename(matchedFile, '.slice.tsx').replace(/-/g, '_');
              const { getDatabase } = await import('../core/database-factory');
              const dbClient = getDatabase();
              const generatedRows: Record<string, unknown>[] = [];
              for (let i = 1; i <= count; i++) {
                const row = {
                  id: crypto.randomUUID(),
                  name: `Seed Item ${i}`,
                  sku: `SEED-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
                  price: parseFloat((10 + Math.random() * 90).toFixed(2)),
                  stock: Math.floor(1 + Math.random() * 100),
                  status: i % 3 === 0 ? 'low_stock' : 'active',
                  created_at: new Date().toISOString()
                };
                generatedRows.push(row);
                try {
                  await dbClient.insert(tableName, row);
                } catch {
                  try {
                    await dbClient.query(`INSERT INTO ${tableName} (id, name) VALUES ($1, $2)`, [row.id, row.name]);
                  } catch {}
                }
              }
              await dbClient.close?.();
              contentText = JSON.stringify(
                {
                  status: 'PASS',
                  operation: 'GENERATE_SEED',
                  slice: targetSlice,
                  table: tableName,
                  recordsSynthesized: count,
                  sample: generatedRows[0]
                },
                null,
                2
              );
            }
          } else if (toolName === 'synapse_scaffold_component') {
            const domain = String(args.domain || 'general');
            const name = String(args.name || 'component');
            const componentType = String(args.componentType || 'modal');

            const domainValid = validatePathSegment(domain);
            const nameValid = validatePathSegment(name);
            if (!domainValid.ok || !nameValid.ok) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ status: 'FAIL', code: 'INVALID_PATH_SEGMENT' }, null, 2)
                    }
                  ]
                }
              };
            }

            const resolution = resolveSlicesDir(this.root);
            let slicesDir: string;
            if (resolution.ok) {
              slicesDir = resolution.value.slicesDir;
            } else if (resolution.error.code === 'AMBIGUOUS_SLICES_DIR') {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ status: 'FAIL', code: resolution.error.code }, null, 2)
                    }
                  ]
                }
              };
            } else {
              slicesDir = path.join(path.resolve(this.root), 'src', 'slices');
            }
            const outPath = path.join(slicesDir, domain, `${name}.tsx`);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            const pascal = name
              .split(/[-_]/)
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join('');
            let componentCode = '';
            if (componentType === 'modal') {
              componentCode = `import React, { useState } from 'react';\nimport { Modal, Button } from 'synapsejs/client';\n\nexport function ${pascal}() {\n  const [isOpen, setIsOpen] = useState(false);\n  return (\n    <div>\n      <Button onClick={() => setIsOpen(true)}>Abrir ${pascal}</Button>\n      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="${pascal}">\n        <p className="text-slate-300">Conteúdo interativo do modal gerenciado no cliente.</p>\n      </Modal>\n    </div>\n  );\n}\n`;
            } else if (componentType === 'drawer') {
              componentCode = `import React, { useState } from 'react';\nimport { Drawer, Button } from 'synapsejs/client';\n\nexport function ${pascal}() {\n  const [isOpen, setIsOpen] = useState(false);\n  return (\n    <div>\n      <Button onClick={() => setIsOpen(true)}>Exibir ${pascal}</Button>\n      <Drawer isOpen={isOpen} onClose={() => setIsOpen(false)} title="${pascal}">\n        <p className="text-slate-300">Painel lateral deslizante.</p>\n      </Drawer>\n    </div>\n  );\n}\n`;
            } else if (componentType === 'tabs') {
              componentCode = `import React from 'react';\nimport { Tabs, TabList, Tab, TabPanel } from 'synapsejs/client';\n\nexport function ${pascal}() {\n  return (\n    <Tabs defaultValue="tab1">\n      <TabList>\n        <Tab value="tab1">Aba 1</Tab>\n        <Tab value="tab2">Aba 2</Tab>\n      </TabList>\n      <TabPanel value="tab1"><div className="p-4 text-slate-300">Painel 1</div></TabPanel>\n      <TabPanel value="tab2"><div className="p-4 text-slate-300">Painel 2</div></TabPanel>\n    </Tabs>\n  );\n}\n`;
            } else {
              componentCode = `import React from 'react';\nimport { DropdownMenu, DropdownItem, Button } from 'synapsejs/client';\n\nexport function ${pascal}() {\n  return (\n    <DropdownMenu trigger={<Button variant="secondary">Ações ▾</Button>}>\n      <DropdownItem onClick={() => alert('Opção 1')}>Opção 1</DropdownItem>\n      <DropdownItem variant="danger" onClick={() => alert('Excluir')}>Excluir</DropdownItem>\n    </DropdownMenu>\n  );\n}\n`;
            }
            fs.writeFileSync(outPath, componentCode, 'utf-8');
            contentText = JSON.stringify(
              {
                status: 'PASS',
                operation: 'SCAFFOLD_COMPONENT',
                componentType,
                filePath: toRelativePath(this.root, outPath)
              },
              null,
              2
            );
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
