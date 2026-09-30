#!/usr/bin/env bun
/**
 * SynapseJS - Documentation Drift Gate
 *
 * The project's own rule is "no claim without a green test". This gate makes the
 * numbers the documentation quotes checkable: it runs the framework suite, reads the
 * totals from the JUnit report, and compares them — together with the version and the
 * model-context-protocol tool count — against every number stated in the agent guide
 * and the readme files. A mismatch fails the gate and names the document.
 *
 * Usage: bun run scripts/docs-check.ts [--json]
 */

import * as fs from 'fs';
import * as path from 'path';

const root = process.cwd();
const DOCUMENTS = [
  'AGENTS.md',
  'README.md',
  'README.pt-BR.md',
  'packages/synapse/README.md',
  'docs/migration-1.9.md',
  'docs/migracao-1.9.pt-BR.md',
  'docs/releases/1.9.0.md'
];
const JUNIT_PATH = path.join(root, '.synapse', 'junit-docs-check.xml');

interface DocNumber {
  document: string;
  line: number;
  text: string;
  tests?: number;
  files?: number;
  toolCount?: number;
  version?: string;
  lintWarnings?: number;
  stableFeatures?: number;
  experimentalFeatures?: number;
  roadmapFeatures?: number;
}

async function runSuiteCounts(): Promise<{ tests: number; files: number }> {
  fs.mkdirSync(path.dirname(JUNIT_PATH), { recursive: true });

  const proc = Bun.spawn(
    [process.execPath, 'test', 'packages/synapse/test', '--reporter=junit', `--reporter-outfile=${JUNIT_PATH}`],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' }
    }
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    process.stderr.write(`[docs-check] suite exited ${exitCode}\n${stdout.slice(-2000)}\n${stderr.slice(-2000)}\n`);

    return { tests: -1, files: -1 };
  }

  if (!fs.existsSync(JUNIT_PATH)) {
    process.stderr.write(`[docs-check] JUnit report not produced.\n${stdout}\n${stderr}\n`);

    return { tests: -1, files: -1 };
  }

  const xml = fs.readFileSync(JUNIT_PATH, 'utf-8');
  const tests = Number(xml.match(/<testsuites[^>]*tests="(\d+)"/)?.[1] ?? -1);
  // One `<testsuite file="...">` per test file, plus nested suites that repeat the
  // same file attribute: the file count is the number of distinct paths.
  const files = new Set(Array.from(xml.matchAll(/file="([^"]+)"/g)).map((match) => match[1])).size;

  return { tests, files };
}

function collectDocumentedNumbers(): DocNumber[] {
  const found: DocNumber[] = [];

  for (const document of DOCUMENTS) {
    const file = path.join(root, document);

    if (!fs.existsSync(file)) {
      continue;
    }

    const lines = fs.readFileSync(file, 'utf-8').split('\n');

    lines.forEach((line, index) => {
      const entry: DocNumber = { document, line: index + 1, text: line.trim() };

      // "N tests across M files" / "N testes em M arquivos" / "Ran N tests across M files"
      const testsAcrossFiles = line.match(/(\d+)\s+(?:tests?|testes?)\D{1,40}?(\d+)\s+(?:files?|arquivos?)/i);
      if (testsAcrossFiles) {
        entry.tests = Number(testsAcrossFiles[1]);
        entry.files = Number(testsAcrossFiles[2]);
      }

      // A bare "N pass" line, or a badge reading "Tests-N Passing", is the same claim
      // about the suite total.
      const passing = line.match(/^(\d+)\s+pass\b/i) ?? line.match(/(?:Tests|Testes)-(\d+)(?:%20|\s)/i);
      if (passing) {
        entry.tests = Number(passing[1]);
      }

      // "N warnings are accepted" / "N avisos aceitos"
      const warnings = line.match(/(\d+)\s+(?:warnings?|avisos?)/i);
      if (warnings) {
        entry.lintWarnings = Number(warnings[1]);
      }

      // The feature table counts: "44 stable, 5 experimental, 1 roadmap".
      const features = line.match(
        /(\d+)\s+`?stable`?[^\d]{1,20}(\d+)\s+`?experimental`?[^\d]{1,20}(\d+)\s+`?roadmap`?/i
      );
      if (features) {
        entry.stableFeatures = Number(features[1]);
        entry.experimentalFeatures = Number(features[2]);
        entry.roadmapFeatures = Number(features[3]);
      }

      // "18 tools" / "18 ferramentas" / "18 native AI tools"
      const tools = line.match(/\b(\d+)\s+(?:[a-z-]+\s+){0,3}(?:tools?|ferramentas?)\b/i);
      if (tools) {
        entry.toolCount = Number(tools[1]);
      }

      // Current-version statements only: "SynapseJS v1.8.0", `version: 1.8.0`,
      // `"version": "1.8.0"`. A historical mention ("Resilience (v1.6.0)") is not a
      // claim about the current release and must not be flagged.
      const version =
        line.match(/SynapseJS\s+v?(\d+\.\d+\.\d+)/i) ??
        line.match(/version\s+is\s+`?(\d+\.\d+\.\d+)/i) ??
        line.match(/version["']?\s*[:=]\s*["']?(\d+\.\d+\.\d+)/i) ??
        line.match(/["']version["']\s*:\s*["'](\d+\.\d+\.\d+)["']/i);
      if (version) {
        entry.version = version[1];
      }

      if (
        entry.tests !== undefined ||
        entry.toolCount !== undefined ||
        entry.version !== undefined ||
        entry.lintWarnings !== undefined ||
        entry.stableFeatures !== undefined
      ) {
        found.push(entry);
      }
    });
  }

  return found;
}

/**
 * Runs the linter with the display limit lifted, so the count is the real total and
 * not the truncated one.
 */
async function runLintCounts(): Promise<{ warnings: number; errors: number }> {
  const proc = Bun.spawn(['bunx', '@biomejs/biome@2.5.14', 'check', '.', '--max-diagnostics=1000'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;

  const output = `${stdout}\n${stderr}`;

  const warnings = output.match(/Found (\d+) warnings?/)?.[1];
  // Biome omits the error line entirely when there are none.
  const errors = output.match(/Found (\d+) errors?/)?.[1] ?? (warnings !== undefined ? '0' : undefined);

  return {
    warnings: Number(warnings ?? -1),
    errors: Number(errors ?? -1)
  };
}

const failures: string[] = [];
const asJson = process.argv.includes('--json');
const suite = await runSuiteCounts();
const lint = await runLintCounts();
const documented = collectDocumentedNumbers();

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/synapse/package.json'), 'utf-8')) as {
  version: string;
};
const versionModule = await import(path.join(root, 'packages/synapse/src/project-status.ts'));
const machine = versionModule.projectStatus() as {
  version: string;
  toolCount: number;
  features: Array<{ status: string }>;
};
const machineFeatureCounts = {
  stable: machine.features.filter((feature) => feature.status === 'stable').length,
  experimental: machine.features.filter((feature) => feature.status === 'experimental').length,
  roadmap: machine.features.filter((feature) => feature.status === 'roadmap').length
};

if (suite.tests < 0) {
  failures.push('the framework suite did not complete, so its counts cannot be verified');
}

for (const entry of documented) {
  if (entry.tests !== undefined && suite.tests >= 0 && entry.tests !== suite.tests) {
    failures.push(`${entry.document}:${entry.line} states ${entry.tests} tests, the suite ran ${suite.tests}`);
  }

  if (entry.files !== undefined && suite.files >= 0 && entry.files !== suite.files) {
    failures.push(`${entry.document}:${entry.line} states ${entry.files} files, the suite ran ${suite.files}`);
  }

  if (entry.toolCount !== undefined && entry.toolCount !== machine.toolCount) {
    failures.push(
      `${entry.document}:${entry.line} states ${entry.toolCount} tools, ${machine.toolCount} are registered`
    );
  }

  if (entry.lintWarnings !== undefined && lint.warnings >= 0 && entry.lintWarnings !== lint.warnings) {
    failures.push(
      `${entry.document}:${entry.line} states ${entry.lintWarnings} accepted lint warnings, the linter reports ${lint.warnings}`
    );
  }

  if (
    entry.stableFeatures !== undefined &&
    (entry.stableFeatures !== machineFeatureCounts.stable ||
      entry.experimentalFeatures !== machineFeatureCounts.experimental ||
      entry.roadmapFeatures !== machineFeatureCounts.roadmap)
  ) {
    failures.push(
      `${entry.document}:${entry.line} states ${entry.stableFeatures}/${entry.experimentalFeatures}/${entry.roadmapFeatures} stable/experimental/roadmap, the source reports ${machineFeatureCounts.stable}/${machineFeatureCounts.experimental}/${machineFeatureCounts.roadmap}`
    );
  }

  if (entry.version !== undefined && entry.version !== manifest.version) {
    failures.push(
      `${entry.document}:${entry.line} states version ${entry.version}, the manifest declares ${manifest.version}`
    );
  }
}

if (lint.errors !== 0) {
  failures.push(`the linter reports ${lint.errors} errors (the documented result is 0)`);
}

if (machine.version !== manifest.version) {
  failures.push(`the project status reports ${machine.version}, the manifest declares ${manifest.version}`);
}

const report = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  operation: 'DOCS_DRIFT_CHECK',
  suiteTests: suite.tests,
  suiteFiles: suite.files,
  toolCount: machine.toolCount,
  version: machine.version,
  featureCounts: machineFeatureCounts,
  lintWarnings: lint.warnings,
  lintErrors: lint.errors,
  documentsChecked: DOCUMENTS,
  drift: failures
};

const fix = process.argv.includes('--fix');

if (fix && failures.length > 0) {
  // Derive the documented numbers from the machine values instead of hand-editing:
  // each mismatch is a number on a line, and only that number is replaced.
  const rewritten: string[] = [];

  for (const entry of documented) {
    const file = path.join(root, entry.document);
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    let line = lines[entry.line - 1];
    let changed = false;

    if (entry.tests !== undefined && suite.tests >= 0 && entry.tests !== suite.tests) {
      line = line.replace(new RegExp(`\\b${entry.tests}\\b`, 'g'), String(suite.tests));
      changed = true;
    }

    if (entry.files !== undefined && suite.files >= 0 && entry.files !== suite.files) {
      line = line.replace(new RegExp(`\\b${entry.files}\\b`, 'g'), String(suite.files));
      changed = true;
    }

    if (entry.toolCount !== undefined && entry.toolCount !== machine.toolCount) {
      line = line.replace(new RegExp(`\\b${entry.toolCount}\\b`, 'g'), String(machine.toolCount));
      changed = true;
    }

    if (entry.lintWarnings !== undefined && lint.warnings >= 0 && entry.lintWarnings !== lint.warnings) {
      line = line.replace(new RegExp(`\\b${entry.lintWarnings}\\b`, 'g'), String(lint.warnings));
      changed = true;
    }

    if (entry.stableFeatures !== undefined) {
      if (entry.stableFeatures !== machineFeatureCounts.stable) {
        line = line.replace(new RegExp(`\\b${entry.stableFeatures}\\b`, 'g'), String(machineFeatureCounts.stable));
        changed = true;
      }

      if (
        entry.experimentalFeatures !== undefined &&
        entry.experimentalFeatures !== machineFeatureCounts.experimental
      ) {
        line = line.replace(
          new RegExp(`\\b${entry.experimentalFeatures}\\b`, 'g'),
          String(machineFeatureCounts.experimental)
        );
        changed = true;
      }

      if (entry.roadmapFeatures !== undefined && entry.roadmapFeatures !== machineFeatureCounts.roadmap) {
        line = line.replace(new RegExp(`\\b${entry.roadmapFeatures}\\b`, 'g'), String(machineFeatureCounts.roadmap));
        changed = true;
      }
    }

    if (changed) {
      lines[entry.line - 1] = line;
      fs.writeFileSync(file, lines.join('\n'), 'utf-8');
      rewritten.push(`${entry.document}:${entry.line}`);
    }
  }

  process.stdout.write(`FIXED ${rewritten.length} line(s): ${rewritten.join(', ')}\n`);
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (failures.length === 0) {
  process.stdout.write(
    `PASS DOCS_DRIFT_CHECK: ${suite.tests} tests across ${suite.files} files, ${machine.toolCount} tools, v${machine.version} — every documented number agrees.\n`
  );
} else {
  process.stdout.write(`FAIL DOCS_DRIFT_CHECK\n${failures.map((line) => `  - ${line}`).join('\n')}\n`);
}

process.exit(failures.length === 0 ? 0 : 1);
