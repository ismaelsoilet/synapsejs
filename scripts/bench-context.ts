/**
 * Runs the context-surface benchmark over the two help-desk apps, which
 * implement the same two features with and without the slice convention.
 *
 * Usage: bun run bench [--json]
 */

import * as path from 'path';
import { measureAppSurface, renderSurfaceReport } from '../packages/synapse/src/compiler/context-bench';

const repoRoot = path.resolve(import.meta.dir, '..');

const apps = [
  path.join(repoRoot, 'examples', 'helpdesk-slices'),
  path.join(repoRoot, 'examples', 'helpdesk-conventional')
];

const surfaces = apps.map((app) => measureAppSurface(app));

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ surfaces }, null, 2)}\n`);
} else {
  process.stdout.write(`${renderSurfaceReport(surfaces)}\n`);
}
