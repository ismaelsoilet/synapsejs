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
import { analyzeOptionalItemCoverage, unionCoverage } from '../src/compiler/optional-coverage';
import { runSliceOracles } from '../src/compiler/oracle-runner';
import { scaffoldCrud, scaffoldShared, scaffoldSlice } from '../src/compiler/scaffolder';
import { checkSchemaDrift } from '../src/compiler/schema-drift';
import { findSliceFiles, resolveSlicesDir } from '../src/compiler/slice-discovery';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../src/compiler/slice-splitter';
import { SLICE_TEMPLATES, type SliceTemplate } from '../src/compiler/slice-templates';
import { buildStandalone } from '../src/compiler/standalone-builder';
import { isInsideBase } from '../src/core/path-guard';
import { SynapseMcpServer } from '../src/mcp/server';
import { projectStatus } from '../src/project-status';
import { SynapseServer } from '../src/runtime/server';
import { SYNAPSE_VERSION } from '../src/version';

const command = process.argv[2] || 'check';
const root = process.cwd();

/**
 * The flags each subcommand accepts. An unrecognised flag is refused on every
 * command, with the same machine-readable failure code — a machine consumer must
 * not be told "PASS" for a flag the command silently ignored.
 */
const KNOWN_FLAGS: Record<string, string[]> = {
  dev: ['--watch'],
  start: ['--acknowledge-insecure'],
  check: [],
  migrate: [],
  rollback: ['--steps'],
  mcp: [],
  skeleton: [],
  'db-schema': [],
  'db-drift': [],
  impact: [],
  split: [],
  'new-slice': ['--template', '--fields'],
  'new-shared': [],
  build: ['--standalone'],
  contract: ['--markdown'],
  test: ['--gate'],
  new: [],
  create: [],
  init: [],
  worker: [],
  info: [],
  coverage: []
};

/** Returns the first unrecognised flag, or null when every flag is declared. */
function unknownFlag(argv: string[]): string | null {
  const known = KNOWN_FLAGS[command] ?? [];

  for (const argument of argv.slice(3)) {
    if (!argument.startsWith('--')) {
      continue;
    }

    const name = argument.split('=')[0];

    if (!known.includes(name)) {
      return argument;
    }
  }

  return null;
}

async function main() {
  const offendingFlag = unknownFlag(process.argv);

  if (offendingFlag) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'FAIL',
          code: 'UNKNOWN_FLAG',
          operation: 'FLAG_VALIDATION',
          message: `Flag desconhecida: ${offendingFlag}. Flags aceitas por '${command}': ${(KNOWN_FLAGS[command] ?? []).join(', ') || 'nenhuma'}.`
        },
        null,
        2
      )}\n`
    );
    process.exit(1);
  }

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
      const { isProductionLikeMode } = await import('../src/runtime/server');
      const acknowledged =
        process.argv.includes('--acknowledge-insecure') ||
        process.env.SYNAPSE_ACKNOWLEDGE_INSECURE === 'true' ||
        process.env.SYNAPSE_DEV_HEADERS === 'true';

      if (isProductionLikeMode() && !process.env.SYNAPSE_SESSION_SECRET && !acknowledged) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'FAIL',
              operation: 'START',
              code: 'MISSING_SESSION_SECRET',
              message:
                'Modo de produção sem SYNAPSE_SESSION_SECRET: toda requisição resolveria para anônimo. Configure o segredo ou passe --acknowledge-insecure para assumir o risco explicitamente.'
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      if (!process.env.SYNAPSE_SESSION_SECRET && acknowledged) {
        console.warn(
          '⚠️  [AVISO DE SEGURANÇA] Iniciando sem SYNAPSE_SESSION_SECRET: identidade e papéis vindos de headers do chamador (x-user-id, x-user-roles) NÃO serão confiados; requisições permanecem anônimas.'
        );
      }

      const server = new SynapseServer(root, port);
      await server.discoverSlices();
      await server.start();

      let shuttingDown = false;
      const gracefulShutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
          const summary = await server.stop();
          process.stdout.write(
            `${JSON.stringify({
              status: 'PASS',
              operation: 'GRACEFUL_SHUTDOWN',
              signal,
              drainedRequests: summary.drained,
              abortedRequests: summary.aborted,
              jobsRequeued: summary.jobsRequeued,
              jobsFailed: summary.jobsFailed
            })}\n`
          );
          process.exit(0);
        } catch (err) {
          process.stderr.write(
            `${JSON.stringify({ status: 'ERROR', operation: 'GRACEFUL_SHUTDOWN', error: String(err) })}\n`
          );
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
      // A target that does not exist is a failure; a valid target with no
      // dependents is not.
      process.exit(report.status === 'PASS' ? 0 : 1);
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
        process.stdout.write(
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
        process.stdout.write(
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

    case 'new-shared': {
      const name = process.argv[3];
      if (!name) {
        process.stdout.write(
          `${JSON.stringify({
            status: 'ERROR',
            message: 'Nome do módulo compartilhado ausente. Uso: synapse new-shared <nome>'
          })}\n`
        );
        process.exit(1);
      }

      const root = process.env.SYNAPSE_ROOT || process.cwd();
      const created = scaffoldShared(name, root);

      if (!created.ok) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'ERROR',
              operation: 'SCAFFOLD_SHARED',
              code: created.error.code,
              message: created.error.message
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
            operation: 'SCAFFOLD_SHARED',
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

    case 'coverage': {
      // Which optional contract items the committed slices exercise — across every
      // shipped application, so the report covers the union.
      const targets = [
        root,
        ...(fs.existsSync(path.join(root, 'examples'))
          ? fs
              .readdirSync(path.join(root, 'examples'), { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => path.join(root, 'examples', entry.name))
          : [])
      ];

      const reports = targets.map((target) => analyzeOptionalItemCoverage(target));
      const resolvable = reports.filter((report) => report.status !== 'FAIL' || report.totalSlices > 0);

      if (resolvable.length === 0) {
        process.stdout.write(
          `${JSON.stringify(reports[0] ?? { status: 'FAIL', operation: 'OPTIONAL_ITEM_COVERAGE' }, null, 2)}\n`
        );
        process.exit(1);
      }

      const union = unionCoverage(resolvable);

      process.stdout.write(
        `${JSON.stringify(
          {
            status: union.unexercised.length === 0 ? 'PASS' : 'FAIL',
            operation: 'OPTIONAL_ITEM_COVERAGE',
            applications: resolvable.map((report) => ({
              appDir: report.appDir,
              totalSlices: report.totalSlices,
              items: report.items
            })),
            covered: union.covered,
            unexercised: union.unexercised
          },
          null,
          2
        )}\n`
      );
      process.exit(union.unexercised.length === 0 ? 0 : 1);
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
      const enableGate =
        process.argv.includes('--gate') ||
        fs.existsSync(path.join(root, '.jev.json')) ||
        Boolean(process.env.JEV_ACTIVE || process.env.JEV_PROVIDER || process.env.TYPESAFE_API_KEY);
      const report = await runSliceOracles(root, { enableJevTriage: enableGate });

      process.stdout.write(`${JSON.stringify({ operation: 'PBT_ORACLE_TEST_SUITE', ...report }, null, 2)}\n`);
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'new':
    case 'create':
    case 'init': {
      const rawTarget = process.argv[3];
      if (!rawTarget) {
        process.stdout.write(
          `${JSON.stringify({
            status: 'ERROR',
            message: 'Nome do projeto obrigatório. Uso: synapse new <project-name>'
          })}\n`
        );
        process.exit(1);
      }

      const targetDir = path.resolve(root, rawTarget);

      if (!isInsideBase(root, targetDir)) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: 'ERROR',
              operation: 'CREATE_PROJECT',
              code: 'INVALID_PATH_SEGMENT',
              message: `O caminho '${rawTarget}' resolve para fora do diretório atual (${root}). Um projeto novo é criado dentro dele; use um nome simples ou um subdiretório.`
            },
            null,
            2
          )}\n`
        );
        process.exit(1);
      }

      const cleanProjectName = path
        .basename(targetDir)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-');

      if (fs.existsSync(targetDir)) {
        process.stdout.write(
          `${JSON.stringify({
            status: 'ERROR',
            operation: 'CREATE_PROJECT',
            code: 'TARGET_EXISTS',
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
        process.stdout.write(
          `${JSON.stringify({
            status: 'ERROR',
            operation: 'CREATE_PROJECT',
            code: 'TEMPLATE_NOT_FOUND',
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
              // The scaffold depends on the version this CLI ships, never on a frozen
              // older pin: a new project must receive every fix since then.
              content = content.replace(
                /"(@ismaelsoilet\/)?synapsejs":\s*"[^"]+"/g,
                `"@ismaelsoilet/synapsejs": "^${SYNAPSE_VERSION}"`
              );
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
                // biome-ignore lint/suspicious/noExplicitAny: slice export boundary, validated by the shape check above
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
        if (!running) return;
        running = false;
        // Stop claiming first, then return whatever was running to the queue with its
        // attempt counter already advanced by the interrupted claim.
        queue.stopClaiming();
        const interrupted = queue.interruptRunningJobs();
        queue.close();
        process.stdout.write(
          `${JSON.stringify({
            status: 'PASS',
            operation: 'WORKER_SHUTDOWN',
            jobsRequeued: interrupted.requeued,
            jobsFailed: interrupted.failed
          })}\n`
        );
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
      // One machine-readable source: version, adoption, tool inventory and feature
      // status all come from the same module the docs gate reads.
      process.stdout.write(`${JSON.stringify(projectStatus(), null, 2)}\n`);
      process.exit(0);
      break;
    }

    default: {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: 'FAIL',
            code: 'UNKNOWN_COMMAND',
            operation: 'COMMAND_VALIDATION',
            message: `Comando desconhecido: ${command}.`,
            commands: Object.keys(KNOWN_FLAGS)
          },
          null,
          2
        )}\n`
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ status: 'ERROR', error: String(err) })}\n`);
  process.exit(1);
});
