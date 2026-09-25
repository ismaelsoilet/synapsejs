#!/usr/bin/env bun
/**
 * SynapseJS - Machine-Centric Agent CLI v0.3.0
 * 
 * Provides headless, machine-readable interfaces for AI autonomous agents.
 * 
 * Subcommands:
 *   synapse dev        - Start Bun.serve HTTP server with Zero-Wiring Router & Auto-Migrations
 *   synapse check      - Run typechecker (supports --fast for incremental <200ms cache)
 *   synapse migrate    - Run declarative slice schema migrations on active DB
 *   synapse mcp        - Start native Model Context Protocol (MCP) server over stdio
 *   synapse skeleton   - Update AST skeleton map (.codebase/repo-map.d.ts)
 *   synapse split      - Perform isomorphic AST splitting of slices
 *   synapse test       - Run all property-based testing (PBT) oracles
 *   synapse new-slice  - Scaffold a new atomic vertical slice
 *   synapse info       - Machine metadata and framework metrics
 */

import * as path from 'path';
import * as fs from 'fs';
import { runMachineVerifications } from '../src/compiler/agent-diagnostic-json';
import { getFastDiagnostics } from '../src/compiler/fast-diagnostics';
import { compressRepositoryAST } from '../src/compiler/ast-daemon-compressor';
import { splitSlice } from '../src/compiler/slice-splitter';
import { scaffoldSlice } from '../src/compiler/scaffolder';
import { runSliceMigrations } from '../src/compiler/migration-runner';
import { SynapseServer } from '../src/runtime/server';
import { SynapseMcpServer } from '../src/mcp/server';

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
      const isFast = arg1 === '--fast' || process.argv.includes('--fast');
      const targetFile = isFast ? process.argv[4] : arg1;

      const report = isFast
        ? getFastDiagnostics(root, targetFile)
        : runMachineVerifications(root, targetFile);

      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      process.exit(report.status === 'PASS' ? 0 : 1);
      break;
    }

    case 'migrate': {
      const report = await runSliceMigrations(root);
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
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
      process.stdout.write(
        JSON.stringify(
          {
            status: 'PASS',
            operation: 'SKELETON_COMPRESS',
            repoMapPath: '.codebase/repo-map.d.ts',
            totalSlices: stats.totalSlices,
            estimatedTokens: stats.manifestTokensEstimate,
            budgetTokens: 3000,
            budgetAdherencePercent: ((stats.manifestTokensEstimate / 3000) * 100).toFixed(1) + '%'
          },
          null,
          2
        ) + '\n'
      );
      process.exit(0);
      break;
    }

    case 'split': {
      const slicesDir = path.join(root, 'src/slices');
      const distDir = path.join(root, '.synapse/dist');

      const findSlices = (dir: string): string[] => {
        let files: string[] = [];
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) files.push(...findSlices(full));
          else if (item.name.endsWith('.slice.tsx')) files.push(full);
        }
        return files;
      };

      const sliceFiles = findSlices(slicesDir);
      const splitOutputs = [];

      for (const file of sliceFiles) {
        const split = splitSlice(file, root);
        const serverOut = path.join(distDir, 'server', `${split.sliceName}.server.ts`);
        const clientOut = path.join(distDir, 'client', `${split.sliceName}.client.tsx`);

        fs.mkdirSync(path.dirname(serverOut), { recursive: true });
        fs.mkdirSync(path.dirname(clientOut), { recursive: true });

        fs.writeFileSync(serverOut, split.serverCode, 'utf-8');
        fs.writeFileSync(clientOut, split.clientCode, 'utf-8');

        splitOutputs.push({
          slice: split.sliceName,
          serverPath: path.relative(root, serverOut),
          clientPath: path.relative(root, clientOut)
        });
      }

      process.stdout.write(
        JSON.stringify(
          {
            status: 'PASS',
            operation: 'SLICE_SPLIT',
            totalProcessed: splitOutputs.length,
            slices: splitOutputs
          },
          null,
          2
        ) + '\n'
      );
      process.exit(0);
      break;
    }

    case 'new-slice': {
      const domain = process.argv[3];
      const name = process.argv[4];

      if (!domain || !name) {
        process.stderr.write(
          JSON.stringify({
            status: 'ERROR',
            message: 'Parâmetros obrigatórios ausentes. Uso: synapse new-slice <domain> <name>'
          }) + '\n'
        );
        process.exit(1);
      }

      try {
        const createdPath = scaffoldSlice(domain, name, root);
        process.stdout.write(
          JSON.stringify(
            {
              status: 'PASS',
              operation: 'SCAFFOLD_SLICE',
              domain,
              name,
              createdPath: path.relative(root, createdPath)
            },
            null,
            2
          ) + '\n'
        );
        process.exit(0);
      } catch (err: any) {
        process.stderr.write(
          JSON.stringify({
            status: 'ERROR',
            operation: 'SCAFFOLD_SLICE',
            message: err.message
          }) + '\n'
        );
        process.exit(1);
      }
      break;
    }

    case 'test': {
      const slicesDir = path.join(root, 'src/slices');
      const findSliceFiles = (dir: string): string[] => {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) results.push(...findSliceFiles(fullPath));
          else if (entry.name.endsWith('.slice.tsx')) results.push(fullPath);
        }
        return results;
      };

      const sliceFiles = findSliceFiles(slicesDir);
      const testResults = [];
      let allPassed = true;

      for (const slicePath of sliceFiles) {
        const proc = Bun.spawn([process.execPath, 'run', slicePath], {
          cwd: root,
          stdout: 'pipe',
          stderr: 'pipe'
        });
        const [output, errOutput, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited
        ]);

        if (exitCode !== 0) allPassed = false;

        testResults.push({
          slice: path.basename(slicePath, '.slice.tsx'),
          path: path.relative(root, slicePath),
          passed: exitCode === 0,
          output: (output + errOutput).trim()
        });
      }

      process.stdout.write(
        JSON.stringify(
          {
            status: allPassed ? 'PASS' : 'FAIL',
            operation: 'PBT_ORACLE_TEST_SUITE',
            totalSlices: testResults.length,
            passedSlices: testResults.filter((r) => r.passed).length,
            results: testResults
          },
          null,
          2
        ) + '\n'
      );
      process.exit(allPassed ? 0 : 1);
      break;
    }

    case 'new':
    case 'create':
    case 'init': {
      const rawTarget = process.argv[3];
      if (!rawTarget) {
        process.stderr.write(
          JSON.stringify({
            status: 'ERROR',
            message: 'Nome do projeto obrigatório. Uso: synapse new <project-name>'
          }) + '\n'
        );
        process.exit(1);
      }

      const targetDir = path.resolve(root, rawTarget);
      const cleanProjectName = path.basename(targetDir).toLowerCase().replace(/[^a-z0-9-_]/g, '-');

      if (fs.existsSync(targetDir)) {
        process.stderr.write(
          JSON.stringify({
            status: 'ERROR',
            message: `O diretório '${rawTarget}' já existe em ${targetDir}.`
          }) + '\n'
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
          JSON.stringify({
            status: 'ERROR',
            message: 'Template oficial starter não encontrado nos diretórios candidatos.'
          }) + '\n'
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
          const s = path.join(src, entry.name);
          const d = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            copyRecursive(s, d);
          } else {
            let content = fs.readFileSync(s, 'utf-8');
            if (entry.name === 'package.json') {
              content = content.replace('"starter-app"', `"${cleanProjectName}"`);
              content = content.replace(/"synapsejs":\s*"workspace:\*"/g, '"synapsejs": "^0.3.0"');
            }
            fs.writeFileSync(d, content, 'utf-8');
          }
        }
      };

      copyRecursive(templateDir, targetDir);

      process.stdout.write(
        JSON.stringify(
          {
            status: 'PASS',
            operation: 'CREATE_PROJECT',
            projectName: cleanProjectName,
            targetDir,
            message: `Projeto SynapseJS '${cleanProjectName}' criado com sucesso!`
          },
          null,
          2
        ) + '\n'
      );
      process.exit(0);
      break;
    }

    case 'info': {
      process.stdout.write(
        JSON.stringify(
          {
            framework: 'SynapseJS',
            version: '0.3.0',
            paradigm: 'Fullstack AI-Native Machine-Centric OS',
            runtime: 'Bun (WebKit/JavaScriptCore) + Bun.serve',
            database: 'Multi-Engine (Embedded SQLite + PostgreSQL)',
            compiler: 'TypeScript Compiler API + AST Daemon + Incremental Cache',
            protocols: ['REST/HTTP', 'Isomorphic RPC', 'Model Context Protocol (MCP)'],
            principles: [
              'Locality of Behavior (LoB)',
              'Vertical Slices (N = 1)',
              'Zero-Wiring Routing & Auto-Migrations via AST',
              'Explicit SessionContext & RBAC',
              'Result<T, E> Zero-Throw Control Flow',
              'TypeBox JIT Schemas',
              'Fast-Check Property Based Testing',
              'AST Skeletonizer (<3000 tokens)',
              'Machine-Readable JSON Diagnostics (<200ms)'
            ],
            commands: ['new', 'dev', 'check', 'migrate', 'mcp', 'skeleton', 'split', 'test', 'new-slice', 'info']
          },
          null,
          2
        ) + '\n'
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
  process.stderr.write(JSON.stringify({ status: 'ERROR', error: String(err) }) + '\n');
  process.exit(1);
});
