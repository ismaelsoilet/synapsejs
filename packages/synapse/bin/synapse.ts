#!/usr/bin/env bun

/**
 * SynapseJS - Agent CLI v0.6.0
 *
 * Provides headless, machine-readable interfaces for AI autonomous agents.
 *
 * Subcommands:
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
import { runSliceMigrations } from '../src/compiler/migration-runner';
import { runSliceOracles } from '../src/compiler/oracle-runner';
import { scaffoldSlice } from '../src/compiler/scaffolder';
import { findSliceFiles, resolveSlicesDir } from '../src/compiler/slice-discovery';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../src/compiler/slice-splitter';
import { SynapseMcpServer } from '../src/mcp/server';
import { SynapseServer } from '../src/runtime/server';

const command = process.argv[2] || 'check';
const root = process.cwd();

async function main() {
  switch (command) {
    case 'dev': {
      const port = parseInt(process.argv[3] || process.env.PORT || '3000', 10);
      const server = new SynapseServer(root, port);
      await server.discoverSlices();
      await server.start();
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

    case 'mcp': {
      const mcpServer = new SynapseMcpServer(root);
      mcpServer.start();
      break;
    }

    case 'skeleton': {
      const repoMapPath = path.join(root, '.codebase/repo-map.d.ts');
      const graphPath = path.join(root, '.codebase/architecture-graph.json');
      const stats = compressRepositoryAST(root, repoMapPath, graphPath);

      const skeletonStatus = stats.totalModules > 0 ? 'PASS' : 'FAIL';

      process.stdout.write(
        `${JSON.stringify(
          {
            status: skeletonStatus,
            operation: 'SKELETON_COMPRESS',
            repoMapPath: '.codebase/repo-map.d.ts',
            totalModules: stats.totalModules,
            totalSlices: stats.totalSlices,
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

      const created = scaffoldSlice(domain, name, root);

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
              content = content.replace(/"synapsejs":\s*"workspace:\*"/g, '"synapsejs": "^0.6.0"');
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

    case 'info': {
      process.stdout.write(
        `${JSON.stringify(
          {
            framework: 'SynapseJS',
            version: '0.6.0',
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
                feature: 'MCP stdio server (5 tools)',
                status: 'stable',
                evidence: 'bun test packages/synapse/test/mcp-server.test.ts'
              },
              {
                feature: 'AST skeletonizer to .codebase/repo-map.d.ts',
                status: 'stable',
                evidence: 'bun --cwd examples/enterprise-crm skeleton'
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
              }
            ],
            commands: ['new', 'dev', 'check', 'migrate', 'mcp', 'skeleton', 'split', 'test', 'new-slice', 'info']
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
        `Unknown command: ${command}\nAvailable: new, dev, check, migrate, mcp, skeleton, split, test, new-slice, info\n`
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ status: 'ERROR', error: String(err) })}\n`);
  process.exit(1);
});
