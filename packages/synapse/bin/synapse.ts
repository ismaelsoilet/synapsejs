#!/usr/bin/env bun

/**
 * SynapseJS - Agent CLI v1.1.0
 *
 * Provides headless, machine-readable interfaces for AI autonomous agents.
 *
 * Subcommands:
 *   synapse start      - Start production Bun.serve HTTP server with graceful shutdown (SIGTERM/SIGINT)
 *   synapse dev        - Start Bun.serve HTTP server with Zero-Wiring Router & Auto-Migrations
 *   synapse check      - Run the TypeScript typechecker and print JSON diagnostics
 *   synapse migrate    - Run declarative slice schema migrations on active DB
 *   synapse mcp        - Start native Model Context Protocol (MCP) server over stdio
 *   synapse skeleton   - Update AST skeleton map (.codebase/repo-map.d.ts)
 *   synapse split      - Partition slices into shared/server/client modules (gated)
 *   synapse test       - Run all property-based testing (PBT) oracles
 *   synapse new-slice  - Scaffold a new atomic vertical slice
 *   synapse info       - Machine metadata and framework metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import { runMachineVerifications } from '../src/compiler/agent-diagnostic-json';
import { compressRepositoryAST } from '../src/compiler/ast-daemon-compressor';
import { buildAllClientBundles } from '../src/compiler/client-bundler';
import { renderContractJson, renderContractMarkdown } from '../src/compiler/contract';
import { generateDatabaseSchemaCatalog } from '../src/compiler/db-schema-generator';
import { analyzeImpact } from '../src/compiler/impact-analyzer';
import { rollbackSliceMigrations, runSliceMigrations } from '../src/compiler/migration-runner';
import { runSliceOracles } from '../src/compiler/oracle-runner';
import { scaffoldCrud, scaffoldSlice } from '../src/compiler/scaffolder';
import { checkSchemaDrift } from '../src/compiler/schema-drift';
import { findSliceFiles, resolveSlicesDir } from '../src/compiler/slice-discovery';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../src/compiler/slice-splitter';
import { SLICE_TEMPLATES, type SliceTemplate } from '../src/compiler/slice-templates';
import { buildStandalone } from '../src/compiler/standalone-builder';
import { SynapseMcpServer } from '../src/mcp/server';
import { SynapseServer } from '../src/runtime/server';

const command = process.argv[2] || 'check';
const root = process.cwd();

async function main() {
  switch (command) {
    case 'dev': {
      const watch = process.argv.includes('--watch');

      if (watch && !process.env.SYNAPSE_WATCH_CHILD) {
        const child = Bun.spawn(
          [process.execPath, '--watch', ...process.argv.slice(1).filter((arg) => arg !== '--watch')],
          { stdio: ['inherit', 'inherit', 'inherit'], env: { ...process.env, SYNAPSE_WATCH_CHILD: '1' } }
        );
        process.exit(await child.exited);
      }

      const port = parseInt(process.argv[3] || process.env.PORT || '3000', 10);
      const server = new SynapseServer(root, port);
      await server.discoverSlices();
      await server.start();
      break;
    }

    case 'start': {
      const port = parseInt(process.argv[3] || process.env.PORT || '3000', 10);
      const isProduction = process.env.NODE_ENV === 'production';

      if (isProduction && !process.env.SYNAPSE_SESSION_SECRET) {
        console.warn(
          '⚠️  [AVISO DE SEGURANÇA] NODE_ENV=production ativo sem SYNAPSE_SESSION_SECRET configurado!\n' +
            '   Sessões de usuário permanecerão anônimas por padrão.'
        );
      }

      const server = new SynapseServer(root, port);
      await server.discoverSlices();
      await server.start();

      let shuttingDown = false;
      const gracefulShutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n🛑 [SynapseJS] Recebido sinal ${signal}, iniciando encerramento gracioso...`);
        try {
          await server.stop();
          console.log('✅ [SynapseJS] Servidor e conexões de persistência encerrados com sucesso.');
          process.exit(0);
        } catch (err) {
          console.error('❌ [SynapseJS] Erro durante encerramento gracioso:', err);
          process.exit(1);
        }
      };

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      break;
    }

    case 'check': {
      const arg1 = process.argv[3];

      if (arg1?.startsWith('--')) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'FAIL',
              code: 'UNKNOWN_FLAG',
              message: `Flag desconhecida: ${arg1}. Uso: synapse check [arquivo]`
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      const report = runMachineVerifications(root, arg1);

      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'migrate': {
      const report = await runSliceMigrations(root);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'rollback': {
      let targetSlice: string | undefined;
      let steps: number | undefined;

      for (let i = 3; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith('--steps=')) {
          steps = parseInt(arg.replace('--steps=', ''), 10);
        } else if (!arg.startsWith('--')) {
          targetSlice = arg;
        }
      }

      const report = await rollbackSliceMigrations(root, undefined, { targetSlice, steps });
      process.stdout.write(
        `${JSON.stringify(
          {
            operation: 'MIGRATION_ROLLBACK',
            ...report
          },
          null,
          2
        )}\n`
      );
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'mcp': {
      const mcpServer = new SynapseMcpServer(root);
      mcpServer.start();
      break;
    }

    case 'skeleton': {
      const repoMapPath = path.join(root, '.codebase/repo-map.d.ts');
      const graphPath = path.join(root, '.codebase/architecture-graph.json');
      const stats = compressRepositoryAST(root, repoMapPath, graphPath);

      const dbSchemaPath = path.join(root, '.codebase/db-schema.d.ts');
      const dbStats = generateDatabaseSchemaCatalog(root, dbSchemaPath);

      const skeletonStatus = stats.totalModules > 0 ? 'PASS' : 'FAIL';

      process.stdout.write(
        `${JSON.stringify(
          {
            status: skeletonStatus,
            operation: 'SKELETON_COMPRESS',
            repoMapPath: '.codebase/repo-map.d.ts',
            dbSchemaPath: '.codebase/db-schema.d.ts',
            totalModules: stats.totalModules,
            totalSlices: stats.totalSlices,
            totalTables: dbStats.totalTables,
            totalColumns: dbStats.totalColumns,
            estimatedTokens: stats.manifestTokensEstimate,
            budgetTokens: 3000,
            ...(skeletonStatus === 'FAIL'
              ? {
                  code: 'EMPTY_REPO_MAP',
                  message: `O tsconfig em '${root}/tsconfig.json' não inclui nenhum módulo — nada foi mapeado.`
                }
              : {})
          },
          null,
          2
        )}\n`
      );
      process.exit(skeletonStatus === 'PASS' ? 0 : 1);
      break;
    }

    case 'db-schema': {
      const dbSchemaPath = path.join(root, '.codebase/db-schema.d.ts');
      const dbStats = generateDatabaseSchemaCatalog(root, dbSchemaPath);

      process.stdout.write(
        `${JSON.stringify(
          {
            status: 'PASS',
            operation: 'DB_SCHEMA_CATALOG',
            catalogFile: '.codebase/db-schema.d.ts',
            totalTables: dbStats.totalTables,
            totalColumns: dbStats.totalColumns,
            tables: dbStats.tables.map((t) => t.name)
          },
          null,
          2
        )}\n`
      );
      process.exit(0);
      break;
    }

    case 'db-drift': {
      const report = await checkSchemaDrift(root);
      process.stdout.write(
        `${JSON.stringify(
          {
            operation: 'DB_DRIFT_CHECK',
            ...report
          },
          null,
          2
        )}\n`
      );
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'impact': {
      const target = process.argv[3];
      if (!target) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'FAIL',
              operation: 'IMPACT_ANALYSIS',
              code: 'MISSING_TARGET',
              message: 'Especifique o arquivo, fatia ou tabela: synapse impact <target>'
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      const report = analyzeImpact(target, root);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(0);
      break;
    }

    case 'split': {
      const resolution = resolveSlicesDir(root);

      if (!resolution.ok) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'FAIL',
              operation: 'SLICE_SPLIT',
              code: resolution.error.code,
              message: resolution.error.message,
              candidates: resolution.error.candidates
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      const sliceFiles = findSliceFiles(resolution.value.slicesDir);
      const slices = [];
      let failed = false;

      for (const file of sliceFiles) {
        const split = splitSlice(file, root);

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

        const outDir = artifactDirectory(root, split.value.sliceName);
        const written = writeSplitArtifacts(split.value, outDir);
        const verification = verifySplit(split.value, outDir);

        if (verification.status === 'FAIL') {
          failed = true;
        }

        slices.push({
          slice: split.value.sliceName,
          status: verification.status,
          outDir: path.relative(root, outDir),
          artifacts: written.map((target) => path.relative(root, target)),
          diagnostics: verification.diagnostics,
          leaks: verification.leaks
        });
      }

      const splitStatus = failed || slices.length === 0 ? 'FAIL' : 'PASS';

      process.stdout.write(
        `${JSON.stringify(
          {
            status: splitStatus,
            operation: 'SLICE_SPLIT',
            slicesDir: path.relative(root, resolution.value.slicesDir),
            totalProcessed: slices.length,
            slices
          },
          null,
          2
        )}\n`
      );
      process.exit(splitStatus === 'PASS' ? 0 : 1);
      break;
    }

    case 'new-slice': {
      const domain = process.argv[3];
      const name = process.argv[4];

      if (!domain || !name) {
        process.stderr.write(
          `${JSON.stringify({
            status: 'ERROR',
            message: 'Parâmetros obrigatórios ausentes. Uso: synapse new-slice <domain> <name>'
          })}\n`
        );
        process.exit(1);
      }

      const templateArg = process.argv.find((arg) => arg.startsWith('--template='))?.split('=')[1];
      const template = (templateArg ?? 'create') as SliceTemplate | 'crud';
      const fieldsArg = process.argv.find((arg) => arg.startsWith('--fields='))?.slice('--fields='.length);

      if (template !== 'crud' && !SLICE_TEMPLATES.includes(template)) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'ERROR',
              operation: 'SCAFFOLD_SLICE',
              code: 'UNKNOWN_TEMPLATE',
              message: `Template desconhecido: ${template}`,
              templates: [...SLICE_TEMPLATES, 'crud']
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      if (template === 'crud') {
        const crud = scaffoldCrud(domain, name, root, fieldsArg);

        if (!crud.ok) {
          process.stdout.write(
            `${JSON.stringify(
              {
                status: 'ERROR',
                operation: 'SCAFFOLD_CRUD',
                code: crud.error.code,
                message: crud.error.message
              },
              null,
              2
            )}\n`
          );
          process.exit(1);
        }

        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'PASS',
              operation: 'SCAFFOLD_CRUD',
              domain,
              resource: name,
              createdPaths: crud.value.map((file) => path.relative(root, file))
            },
            null,
            2
          )}\n`
        );
        process.exit(0);
      }

      const created = scaffoldSlice(domain, name, root, template, fieldsArg);

      if (!created.ok) {
        process.stderr.write(
          `${JSON.stringify(
            {
              status: 'ERROR',
              operation: 'SCAFFOLD_SLICE',
              code: created.error.code,
              message: created.error.message,
              candidates: created.error.candidates
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      process.stdout.write(
        `${JSON.stringify(
          {
            status: 'PASS',
            operation: 'SCAFFOLD_SLICE',
            domain,
            name,
            createdPath: path.relative(root, created.value)
          },
          null,
          2
        )}\n`
      );
      process.exit(0);
      break;
    }

    case 'build': {
      const isStandalone = process.argv.includes('--standalone');

      if (isStandalone) {
        const report = await buildStandalone(root);

        if (!report.ok) {
          process.stdout.write(
            `${JSON.stringify(
              {
                status: 'FAIL',
                operation: 'BUILD_STANDALONE',
                code: 'code' in report.error ? report.error.code : 'UNKNOWN',
                message: report.error.message
              },
              null,
              2
            )}\n`
          );
          process.exit(1);
        }

        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'PASS',
              operation: 'BUILD_STANDALONE',
              outDir: path.relative(root, report.value.outDir),
              serverEntry: path.relative(root, report.value.serverEntry),
              clientBundlesCount: report.value.clientBundlesCount,
              totalBytes: report.value.totalBytes
            },
            null,
            2
          )}\n`
        );
        process.exit(0);
      }

      // Pre-constroi os bundles de cliente que o runtime faria sob demanda no primeiro request.
      const report = await buildAllClientBundles(root);

      if (!report.ok) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'FAIL',
              operation: 'BUILD_CLIENT_BUNDLES',
              code: report.error.code,
              message: report.error.message,
              candidates: report.error.candidates
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      const failed = report.value.entries.filter((entry) => entry.status === 'FAIL');
      const built = report.value.entries.filter((entry) => entry.status === 'PASS');
      const skipped = report.value.entries.filter((entry) => entry.status === 'SKIP');

      process.stdout.write(
        `${JSON.stringify(
          {
            status: failed.length === 0 ? 'PASS' : 'FAIL',
            operation: 'BUILD_CLIENT_BUNDLES',
            built: built.length,
            skipped: skipped.length,
            failed: failed.length,
            totalBytes: built.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
            manifest: path.relative(root, report.value.manifestFile),
            slices: report.value.entries
          },
          null,
          2
        )}\n`
      );
      process.exit(failed.length === 0 ? 0 : 1);
      break;
    }

    case 'contract': {
      // O framework se descreve numa chamada: e o que o agente le em vez de adivinhar.
      const asMarkdown = process.argv.includes('--markdown');
      process.stdout.write(`${asMarkdown ? renderContractMarkdown() : renderContractJson()}\n`);
      process.exit(0);
      break;
    }

    case 'test': {
      const report = await runSliceOracles(root);

      process.stdout.write(`${JSON.stringify({ operation: 'PBT_ORACLE_TEST_SUITE', ...report }, null, 2)}\n`);
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'new':
    case 'create':
    case 'init': {
      const rawTarget = process.argv[3];
      if (!rawTarget) {
        process.stderr.write(
          `${JSON.stringify({
            status: 'ERROR',
            message: 'Nome do projeto obrigatório. Uso: synapse new <project-name>'
          })}\n`
        );
        process.exit(1);
      }

      const targetDir = path.resolve(root, rawTarget);
      const cleanProjectName = path
        .basename(targetDir)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-');

      if (fs.existsSync(targetDir)) {
        process.stderr.write(
          `${JSON.stringify({
            status: 'ERROR',
            message: `O diretório '${rawTarget}' já existe em ${targetDir}.`
          })}\n`
        );
        process.exit(1);
      }

      // Localiza o template oficial
      const candidates = [
        path.resolve(__dirname, '../templates/starter'),
        path.resolve(__dirname, '../../templates/starter'),
        path.resolve(__dirname, '../../../templates/starter'),
        path.resolve(__dirname, './templates/starter'),
        path.resolve(root, 'templates/starter')
      ];
      const templateDir = candidates.find((dir) => fs.existsSync(dir));

      if (!templateDir) {
        process.stderr.write(
          `${JSON.stringify({
            status: 'ERROR',
            message: 'Template oficial starter não encontrado nos diretórios candidatos.'
          })}\n`
        );
        process.exit(1);
      }

      // Função recursiva de cópia filtrada
      const copyRecursive = (src: string, dest: string) => {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          if (['node_modules', '.git', '.synapse', 'dist', '.cache', '.tsbuildinfo'].includes(entry.name)) {
            continue;
          }
          // O template publica o arquivo como `gitignore` porque empacotadores
          // descartam `.gitignore`; aqui ele volta ao nome que o usuário espera.
          const destinationName = entry.name === 'gitignore' ? '.gitignore' : entry.name;
          const s = path.join(src, entry.name);
          const d = path.join(dest, destinationName);
          if (entry.isDirectory()) {
            copyRecursive(s, d);
          } else {
            let content = fs.readFileSync(s, 'utf-8');
            if (entry.name === 'package.json') {
              content = content.replace('"starter-app"', `"${cleanProjectName}"`);
              content = content.replace(/"(@ismaelsoilet\/)?synapsejs":\s*"[^"]+"/g, '"@ismaelsoilet/synapsejs": "^1.1.0"');
            }
            fs.writeFileSync(d, content, 'utf-8');
          }
        }
      };

      copyRecursive(templateDir, targetDir);

      process.stdout.write(
        `${JSON.stringify(
          {
            status: 'PASS',
            operation: 'CREATE_PROJECT',
            projectName: cleanProjectName,
            targetDir,
            message: `Projeto SynapseJS '${cleanProjectName}' criado com sucesso!`
          },
          null,
          2
        )}\n`
      );
      process.exit(0);
      break;
    }

    case 'worker': {
      const { QueueEngine } = await import('../src/runtime/queue-engine');
      const { getDatabase } = await import('../src/core/database-factory');
      const { loadSynapseConfig } = await import('../src/core/config');
      const { isJob } = await import('../src/runtime/discovery-rules');

      const config = await loadSynapseConfig(root);
      const queue = new QueueEngine();
      const db = getDatabase();

      const resolution = resolveSlicesDir(root);
      if (resolution.ok) {
        const sliceFiles = findSliceFiles(resolution.value.slicesDir);
        for (const file of sliceFiles) {
          try {
            const mod = await import(path.resolve(file));
            for (const [exportKey, exportVal] of Object.entries(mod)) {
              if (
                isJob(exportKey) &&
                exportVal &&
                typeof exportVal === 'object' &&
                'name' in (exportVal as Record<string, unknown>)
              ) {
                queue.registerJob(exportVal as any);
              }
            }
          } catch (err) {
            console.error(`[Worker] Erro ao carregar jobs da fatia ${file}:`, err);
          }
        }
      }

      console.log('⚡ [SynapseJS Worker] Fila de background jobs ativa e processando...');
      let running = true;
      const shutdown = () => {
        running = false;
        console.log('\n🛑 [SynapseJS Worker] Encerrando worker...');
        queue.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      while (running) {
        try {
          const didWork = await queue.processNextJob({
            db,
            services: (config.services as Record<string, unknown>) || {}
          });
          if (!didWork) {
            await new Promise((r) => setTimeout(r, 500));
          }
        } catch (err) {
          console.error('[Worker] Erro no ciclo de execução:', err);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      break;
    }

    case 'info': {
      process.stdout.write(
        `${JSON.stringify(
          {
            framework: 'SynapseJS',
            version: '1.1.0',
            runtime: 'Bun + Bun.serve',
            database: 'Embedded SQLite (WAL) and PostgreSQL, both verified',
            protocols: ['REST/HTTP', 'Isomorphic RPC', 'Model Context Protocol (MCP)'],
            features: [
              {
                feature: 'Vertical slices (N = 1) with Locality of Behavior',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/locality.test.ts'
              },
              {
                feature: 'Result<T, E> control flow (no public throwing helper)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/machine-types.test.ts'
              },
              {
                feature: 'TypeBox JIT input contracts',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/slice-contract.test.ts'
              },
              {
                feature: 'Declarative sliceSchema migrations, applied once per statement',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/migration-runner.test.ts'
              },
              {
                feature: 'Domain errors map to HTTP status (401/403/404/409/422/500)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/runtime-server.test.ts'
              },
              {
                feature: 'React hydration from a client bundle the splitter produces',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/runtime-server.test.ts'
              },
              {
                feature: 'Signed sessions (SYNAPSE_SESSION_SECRET) and static files from public/',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/runtime-server.test.ts'
              },
              {
                feature: 'Login with Bun.password, signed token and cookie session (storeSession/clearSession)',
                status: 'stable',
                evidence:
                  'bun run --cwd apps/crm synapse test (login oracle: the server accepts the issued token) + bun test packages/synapse/test/session-cookie.test.ts'
              },
              {
                feature: 'Cross-slice atomicity through src/shared modules (db.transaction, rollback proven on SQLite)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/shared-modules.test.ts'
              },
              {
                feature: 'Slice boundary: a slice never imports another slice (SLICE_IMPORTS_SLICE)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/slice-splitter.test.ts'
              },
              {
                feature: 'Browser RPC transport that never throws (RPC_MALFORMED/RPC_UNREACHABLE as values)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/rpc-client.test.ts'
              },
              {
                feature: 'Pre-built client bundles with a manifest (synapse build)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/client-bundler.test.ts'
              },
              {
                feature: 'Uploads with session, size limit and traversal guard (/_synapse/files)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/uploads.test.ts'
              },
              {
                feature: 'Embedded SQLite engine (WAL, prepared-statement cache)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/sqlite-client.test.ts'
              },
              {
                feature: 'Zero-wiring routing, SSR shell and RPC dispatcher',
                status: 'stable',
                evidence: 'bun --cwd examples/enterprise-crm test:e2e'
              },
              {
                feature: 'Slice discovery resolution (never reports PASS with zero slices)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/slice-discovery.test.ts'
              },
              {
                feature: 'MCP stdio server (11 tools)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/mcp-server.test.ts'
              },
              {
                feature: 'AST skeletonizer to .codebase/repo-map.d.ts',
                status: 'stable',
                evidence: 'bun --cwd examples/enterprise-crm skeleton'
              },
              {
                feature: 'Centralized Database Schema Catalog (.codebase/db-schema.d.ts)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/db-schema-generator.test.ts'
              },
              {
                feature: 'Unified Object Storage (LocalStorage + AWS S3/R2 with SigV4)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/storage.test.ts'
              },
              {
                feature: 'Distributed PostgreSQL Queue (SKIP LOCKED, Full Jitter, DLQ)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/postgres-queue.test.ts'
              },
              {
                feature: 'Isomorphic slice splitter (shared/server/client modules)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/slice-splitter.test.ts'
              },
              {
                feature: 'Slice invariants executed by bun:test (per-invariant reporting)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/oracle-runner.test.ts'
              },
              {
                feature: 'Incremental diagnostics cache across processes',
                status: 'roadmap',
                evidence: 'removido na 0.4.0: medido mais lento que o check completo (2.5s vs 1.9s)'
              },
              {
                feature: 'PostgreSQL parity (migrations, DDL, action round-trip)',
                status: 'stable',
                evidence: 'bun run test:postgres (CI roda contra um serviço postgres:16)'
              },
              {
                feature: 'Context surface benchmark (files/tokens an agent must read)',
                status: 'stable',
                evidence: 'bun run bench'
              },
              {
                feature: 'Isolated SQLite Queue & Background Jobs (defineJob, exponential backoff)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/jobs-queue.test.ts'
              },
              {
                feature: 'Bidirectional DDL migrations with transactional rollback (synapse rollback)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/onda2.test.ts'
              },
              {
                feature: 'Vendor code-splitting and dynamic metadata (sliceMeta)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/onda1.test.ts'
              },
              {
                feature: 'Hierarchical domain layouts (_layout.tsx)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/onda1.test.ts'
              },
              {
                feature: 'Sliding-window rate limiting & streaming upload guard',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/onda2.test.ts'
              },
              {
                feature: 'Distributed PostgreSQL Event Hub & Isomorphic i18n',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/onda3.test.ts'
              },
              {
                feature: 'Token revocation, TOTP 2FA, image optimization & plugin hooks',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/onda4.test.ts'
              }
            ],
            commands: [
              'new',
              'dev',
              'start',
              'check',
              'migrate',
              'rollback',
              'db-drift',
              'impact',
              'mcp',
              'skeleton',
              'db-schema',
              'split',
              'build',
              'test',
              'worker',
              'new-slice',
              'contract',
              'info'
            ]
          },
          null,
          2
        )}\n`
      );
      process.exit(0);
      break;
    }

    default: {
      process.stderr.write(
        `Unknown command: ${command}\nAvailable: new, dev, check, migrate, rollback, mcp, skeleton, db-schema, split, build, test, worker, new-slice, contract, info\n`
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ status: 'ERROR', error: String(err) })}\n`);
  process.exit(1);
});
