import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { MCP_TOOL_NAMES } from '../src/mcp/tools';
import { ADOPTION, FEATURE_STATUS, projectStatus } from '../src/project-status';
import { SYNAPSE_VERSION } from '../src/version';

const root = path.resolve(import.meta.dir, '../../..');

function readDocument(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

const ALL_SOURCE_FILES: string[] = [];

function collectFiles(directory: string, sink: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectFiles(full, sink);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      sink.push(full);
    }
  }
}

collectFiles(path.join(root, 'packages/synapse/src'), ALL_SOURCE_FILES);
collectFiles(path.join(root, 'packages/synapse/bin'), ALL_SOURCE_FILES);

describe('version has a single declaration', () => {
  it('reports the manifest version on every machine-readable surface', () => {
    const manifest = JSON.parse(readDocument('packages/synapse/package.json')) as { version: string };

    expect(SYNAPSE_VERSION).toBe(manifest.version);
    expect(projectStatus().version).toBe(manifest.version);
  });

  it('carries no version literal outside the single declaration', () => {
    const offenders = ALL_SOURCE_FILES.filter((file) => {
      if (file.endsWith('version.ts')) {
        return false;
      }

      // A literal that looks like a release version, not a length or an HTTP code.
      return /['"`]\d+\.\d+\.\d+['"`]/.test(fs.readFileSync(file, 'utf-8'));
    }).map((file) => path.relative(root, file));

    expect(offenders).toEqual([]);
  });
});

describe('the tool inventory is derived, not hand-maintained', () => {
  it('reports a count equal to the registered tools', () => {
    const status = projectStatus();

    expect(status.toolCount).toBe(MCP_TOOL_NAMES.length);
    expect(status.tools).toEqual(MCP_TOOL_NAMES);
    expect(MCP_TOOL_NAMES.length).toBeGreaterThan(0);
  });

  it('lists every registered tool name in the agent guide', () => {
    const guide = readDocument('AGENTS.md');

    for (const name of MCP_TOOL_NAMES) {
      expect(guide).toContain(name);
    }
  });
});

describe('feature maturity is evidence-backed', () => {
  it('rates a capability stable only when its evidence exists and can fail', () => {
    for (const entry of FEATURE_STATUS) {
      expect(['stable', 'experimental', 'roadmap']).toContain(entry.status);
      expect(entry.evidence.length).toBeGreaterThan(0);
    }

    const stable = FEATURE_STATUS.filter((entry) => entry.status === 'stable');
    expect(stable.length).toBeGreaterThan(0);

    for (const entry of stable) {
      const referencedTests = Array.from(entry.evidence.matchAll(/([A-Za-z0-9_./-]+\.(?:test\.tsx?))/g)).map(
        (match) => match[1]
      );

      const referencedCommands = Array.from(entry.evidence.matchAll(/(bun\s+[^\s,;)]+)/g)).map((match) => match[1]);

      expect(referencedTests.length + referencedCommands.length).toBeGreaterThan(0);

      for (const reference of referencedTests) {
        expect(fs.existsSync(path.join(root, reference))).toBe(true);
      }

      for (const reference of referencedCommands) {
        const isScript = reference.includes('bun run ') || reference.includes('bun --cwd');

        if (isScript) {
          continue;
        }

        expect(reference.length).toBeGreaterThan(0);
      }
    }
  });

  it('does not advertise a capability whose implementation is absent', () => {
    const names = FEATURE_STATUS.map((entry) => entry.feature.toLowerCase());

    for (const absent of ['drizzle', 'kysely']) {
      expect(names.some((name) => name.includes(absent))).toBe(false);
    }
  });

  it('discloses the adoption basis instead of a blanket stable rating', () => {
    const status = projectStatus();

    expect(status.adoption.externalAdopters).toBe(ADOPTION.externalAdopters);
    expect(status.adoption.basis.length).toBeGreaterThan(20);

    const stable = FEATURE_STATUS.filter((entry) => entry.status === 'stable').length;
    const experimental = FEATURE_STATUS.filter((entry) => entry.status === 'experimental').length;

    // A zero-adoption project that marked everything stable is the defect this guards.
    expect(experimental).toBeGreaterThan(0);
    expect(stable).toBeLessThan(FEATURE_STATUS.length);
  });
});

describe('documentation claims match the implementation', () => {
  it('does not claim compatibility with query builders that have no adapter', () => {
    for (const document of ['README.md', 'README.pt-BR.md', 'packages/synapse/README.md', 'AGENTS.md']) {
      expect(readDocument(document)).not.toMatch(/Compatible with[^.]*Drizzle/i);
    }

    for (const file of ALL_SOURCE_FILES) {
      expect(fs.readFileSync(file, 'utf-8')).not.toMatch(/Compatible with[^.]*Kysely/i);
    }
  });

  it('does not assert that the release automation never ran or that nothing is published', () => {
    const guide = readDocument('AGENTS.md');

    expect(guide).not.toContain('release workflow has never executed');
    expect(guide).not.toContain('nothing has been published');
    expect(guide).not.toContain('no external contract exists');
  });

  it('names only registered MCP tools in the guide and the package readme', () => {
    // Only the lines that actually present the tool inventory: a cookie name or an
    // internal table is not a tool claim.
    const documented = new Set<string>();

    for (const document of ['AGENTS.md', 'packages/synapse/README.md']) {
      for (const line of readDocument(document).split('\n')) {
        const isToolListLine = /tool/i.test(line) || /^\d+\.\s+`?synapse_/.test(line.trim());

        if (!isToolListLine) {
          continue;
        }

        for (const match of line.matchAll(/`?(synapse_[a-z_]+)`?/g)) {
          documented.add(match[1]);
        }
      }
    }

    const unregistered = Array.from(documented).filter((name) => !MCP_TOOL_NAMES.includes(name));
    expect(unregistered).toEqual([]);
  });

  it('resolves every relative link in the readme files', () => {
    const broken: string[] = [];

    for (const document of ['README.md', 'README.pt-BR.md', 'packages/synapse/README.md']) {
      const directory = path.dirname(path.join(root, document));
      const text = readDocument(document);

      for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0].trim();

        if (!target || /^(https?:|mailto:|#)/.test(target)) {
          continue;
        }

        if (!fs.existsSync(path.resolve(directory, target))) {
          broken.push(`${document} -> ${target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('states the per-process scope instead of a cluster-wide claim', () => {
    const guide = readDocument('AGENTS.md');
    const packageReadme = readDocument('packages/synapse/README.md');

    for (const text of [guide, packageReadme]) {
      expect(text).toMatch(/per[- ]instance/);
      expect(text).toMatch(/no shared backend|in the serving process only/);
    }
  });
});
