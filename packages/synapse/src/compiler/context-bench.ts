/**
 * SynapseJS - Context Surface Benchmark
 *
 * Measures what an agent must read to change one feature: the transitive import
 * closure of that feature's entry point.
 *
 * Two numbers are reported per feature, because the boundary changes the answer:
 *
 * - `appFiles`   — closure restricted to the app's own source. This is "how much
 *                  app code an agent has to hold to make the change".
 * - `totalFiles` — closure including sources reached through the project's own
 *                  `paths` mapping (e.g. a framework resolved to its source
 *                  directory). This is the framework cost, and it is paid once
 *                  and shared across every feature.
 *
 * node_modules and `.d.ts` files are excluded from both: a published dependency
 * is not app context, and counting it on one side only would rig the comparison.
 *
 * This measures context surface, not agent success rate.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export const TOKENS_PER_BYTE_ESTIMATE = 0.25;

export interface FeatureSurface {
  feature: string;
  entries: string[];
  appFiles: string[];
  appBytes: number;
  appTokensEstimate: number;
  totalFiles: number;
  totalBytes: number;
  totalTokensEstimate: number;
}

export interface AppSurface {
  app: string;
  root: string;
  features: FeatureSurface[];
}

interface Project {
  program: ts.Program;
  options: ts.CompilerOptions;
}

function loadProject(appRoot: string): Project {
  const configPath = path.join(appRoot, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, appRoot);

  return {
    program: ts.createProgram(parsed.fileNames, parsed.options),
    options: parsed.options
  };
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers;
}

function isCountableSource(fileName: string): boolean {
  if (fileName.endsWith('.d.ts')) {
    return false;
  }
  if (fileName.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }
  return /\.(ts|tsx|mts|cts)$/.test(fileName);
}

export function measureFeature(appRoot: string, feature: string, entries: string[], project?: Project): FeatureSurface {
  const { program, options } = project ?? loadProject(appRoot);
  const normalizedRoot = path.resolve(appRoot);
  const appFiles = new Set<string>();
  const allFiles = new Set<string>();
  const queue = entries.map((entry) => path.resolve(appRoot, entry));

  while (queue.length > 0) {
    const file = path.normalize(queue.pop() as string);
    if (allFiles.has(file)) {
      continue;
    }

    allFiles.add(file);
    const insideApp = file.startsWith(`${normalizedRoot}${path.sep}`);
    if (insideApp) {
      appFiles.add(file);
    }

    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) {
      continue;
    }

    for (const specifier of moduleSpecifiers(sourceFile)) {
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) {
        continue;
      }

      const normalized = path.normalize(resolved);
      if (isCountableSource(normalized) && !allFiles.has(normalized)) {
        queue.push(normalized);
      }
    }
  }

  const bytesOf = (files: Set<string>): number => {
    let total = 0;
    for (const file of files) {
      total += fs.statSync(file).size;
    }
    return total;
  };

  const appBytes = bytesOf(appFiles);
  const totalBytes = bytesOf(allFiles);

  return {
    feature,
    entries,
    appFiles: [...appFiles].map((file) => path.relative(appRoot, file)).sort(),
    appBytes,
    appTokensEstimate: Math.round(appBytes * TOKENS_PER_BYTE_ESTIMATE),
    totalFiles: allFiles.size,
    totalBytes,
    totalTokensEstimate: Math.round(totalBytes * TOKENS_PER_BYTE_ESTIMATE)
  };
}

interface BenchConfig {
  features: Record<string, string[]>;
}

export function measureAppSurface(appRoot: string): AppSurface {
  const configPath = path.join(appRoot, 'bench.config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`bench.config.json ausente em ${appRoot}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as BenchConfig;
  const project = loadProject(appRoot);

  return {
    app: path.basename(appRoot),
    root: path.relative(process.cwd(), appRoot) || '.',
    features: Object.entries(config.features).map(([feature, entries]) =>
      measureFeature(appRoot, feature, entries, project)
    )
  };
}

export function renderSurfaceReport(surfaces: AppSurface[]): string {
  const lines = [
    '| app | feature | arquivos (app) | tokens (app, est.) | arquivos (total) | tokens (total, est.) |',
    '|---|---|---|---|---|---|'
  ];

  for (const surface of surfaces) {
    for (const feature of surface.features) {
      lines.push(
        `| ${surface.app} | ${feature.feature} | ${feature.appFiles.length} | ${feature.appTokensEstimate} | ` +
          `${feature.totalFiles} | ${feature.totalTokensEstimate} |`
      );
    }
  }

  return lines.join('\n');
}
