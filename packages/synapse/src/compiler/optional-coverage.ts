/**
 * SynapseJS - Optional Contract Item Coverage
 *
 * The slice authoring contract has optional items — webhook, background job,
 * websocket definition, cache definition, metadata generation, broadcast and
 * subscription. Prose cannot prove they work; a committed slice can. This module
 * reports which optional item each shipped application exercises and which ones
 * nothing exercises, so a capability cannot be advertised on a template assertion.
 */

import * as fs from 'fs';
import * as path from 'path';
import { findSliceFiles, resolveSlicesDir } from './slice-discovery';

export interface OptionalItemCoverage {
  item: string;
  /** The committed slice that exercises it, or null when nothing does. */
  slice: string | null;
}

export interface OptionalItemReport {
  status: 'PASS' | 'FAIL';
  operation: 'OPTIONAL_ITEM_COVERAGE';
  appDir: string;
  totalSlices: number;
  items: OptionalItemCoverage[];
  /** The optional items no committed slice exercises. Empty is the passing state. */
  unexercised: string[];
  /** Present when slice discovery failed. */
  code?: string;
  message?: string;
  candidates?: string[];
}

interface Detector {
  item: string;
  matches: (filePath: string, source: string) => boolean;
}

function exportsName(source: string, suffix: string): boolean {
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class|let|var)\\s+\\w*${suffix}\\b`).test(source);
}

const DETECTORS: Detector[] = [
  {
    item: 'webhook',
    matches: (_file, source) => exportsName(source, 'Webhook')
  },
  {
    item: 'background job',
    matches: (_file, source) => exportsName(source, 'Job') || /\bdefineJob\s*[<(]/.test(source)
  },
  {
    item: 'websocket definition',
    matches: (_file, source) => exportsName(source, 'Socket') || /\bdefineSocket\s*[<(]/.test(source)
  },
  {
    item: 'cache definition',
    matches: (_file, source) => exportsName(source, 'Cache') || /\bdefineCache\s*\(/.test(source)
  },
  {
    item: 'metadata generation',
    matches: (_file, source) => /\bsliceMeta\b/.test(source) || exportsName(source, 'Meta')
  },
  {
    item: 'broadcast',
    matches: (_file, source) => /\.broadcast\s*\(/.test(source)
  },
  {
    item: 'subscription',
    matches: (_file, source) => /\buseSubscription\s*\(/.test(source) || /\bdefineTopic\s*\(/.test(source)
  }
];

export function analyzeOptionalItemCoverage(appDir: string = process.cwd()): OptionalItemReport {
  const resolution = resolveSlicesDir(appDir);

  if (!resolution.ok) {
    return {
      status: 'FAIL',
      operation: 'OPTIONAL_ITEM_COVERAGE',
      appDir,
      totalSlices: 0,
      items: DETECTORS.map((detector) => ({ item: detector.item, slice: null })),
      unexercised: DETECTORS.map((detector) => detector.item),
      code: resolution.error.code,
      message: resolution.error.message,
      candidates: resolution.error.candidates
    };
  }

  const sliceFiles = findSliceFiles(resolution.value.slicesDir);
  const items: OptionalItemCoverage[] = DETECTORS.map((detector) => {
    for (const filePath of sliceFiles) {
      try {
        const source = fs.readFileSync(filePath, 'utf-8');

        if (detector.matches(filePath, source)) {
          return { item: detector.item, slice: path.basename(filePath, '.slice.tsx') };
        }
      } catch {
        // Unreadable slice: it cannot be the evidence, and discovery already reported it.
      }
    }

    return { item: detector.item, slice: null };
  });

  const unexercised = items.filter((entry) => entry.slice === null).map((entry) => entry.item);

  return {
    status: unexercised.length === 0 ? 'PASS' : 'FAIL',
    operation: 'OPTIONAL_ITEM_COVERAGE',
    appDir,
    totalSlices: sliceFiles.length,
    items,
    unexercised
  };
}

/** The union of optional items covered across several shipped applications. */
export function unionCoverage(reports: OptionalItemReport[]): { covered: string[]; unexercised: string[] } {
  const covered = new Set<string>();

  for (const report of reports) {
    for (const entry of report.items) {
      if (entry.slice) {
        covered.add(entry.item);
      }
    }
  }

  return {
    covered: Array.from(covered),
    unexercised: DETECTORS.map((detector) => detector.item).filter((item) => !covered.has(item))
  };
}
