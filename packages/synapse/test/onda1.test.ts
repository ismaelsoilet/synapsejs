import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildClientBundle,
  buildVendorBundle,
  VENDOR_BUNDLE_NAME,
  VENDOR_BUNDLE_URL
} from '../src/compiler/client-bundler';
import { artifactDirectory, splitSlice, verifySplit, writeSplitArtifacts } from '../src/compiler/slice-splitter';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { SynapseServer } from '../src/runtime/server';

const tempAppDir = path.join(import.meta.dir, 'fixtures', 'onda1-test-app');

describe('Onda 1: Vendor Splitting, Dynamic SEO (sliceMeta) & Hierarchical Layouts', () => {
  let server: SynapseServer;
  let serverPort: number;

  beforeAll(async () => {
    // Create test app structure
    fs.mkdirSync(path.join(tempAppDir, 'src', 'slices', 'marketing'), { recursive: true });
    fs.mkdirSync(path.join(tempAppDir, 'src', 'slices', 'dashboard'), { recursive: true });

    // Root layout: wraps with <div id="root-layout">
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', '_layout.tsx'),
      `import React from 'react';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <div id="root-layout" className="root-wrapper">{children}</div>;
}
`,
      'utf-8'
    );

    // Domain layout for marketing: wraps with <div id="marketing-layout">
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'marketing', '_layout.tsx'),
      `import React from 'react';
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div id="marketing-layout" className="marketing-wrapper">{children}</div>;
}
`,
      'utf-8'
    );

    // Marketing slice with sliceMeta
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'marketing', 'landing.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';

export const LandingInputSchema = Type.Object({ ref: Type.Optional(Type.String()) });
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS page_views (id TEXT PRIMARY KEY);';

export const sliceMeta = (props: { headline?: string }) => ({
  title: 'Página Inicial Revolucionária',
  description: 'A melhor experiência em software distribuído',
  keywords: ['framework', 'bun', 'machine'],
  ogImage: 'https://synapsejs.dev/og-cover.png',
  canonical: 'https://synapsejs.dev/',
  noIndex: false,
  extraTags: [{ name: 'twitter:card', content: 'summary_large_image' }]
});

export async function landingAction(payload: any): Promise<Result<{ ok: boolean }, 'ERROR'>> {
  return Ok({ ok: true });
}

export async function LandingLoader(ctx: any) {
  return { headline: 'Bem-vindo ao Futuro' };
}

export function LandingView(props: { headline?: string }) {
  return <h1>{props.headline || 'Padrão'}</h1>;
}
`,
      'utf-8'
    );

    // Dashboard slice without domain layout
    fs.writeFileSync(
      path.join(tempAppDir, 'src', 'slices', 'dashboard', 'overview.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';

export const OverviewInputSchema = Type.Object({});
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS dash_stats (id TEXT PRIMARY KEY);';

export async function overviewAction(payload: any): Promise<Result<{ ok: boolean }, 'ERROR'>> {
  return Ok({ ok: true });
}

export function OverviewComponent() {
  return <div>Painel de Controle</div>;
}
`,
      'utf-8'
    );

    const testDb = new SqliteDatabaseClient(path.join(tempAppDir, '.synapse', 'test.sqlite'));
    server = new SynapseServer(tempAppDir, 0, testDb);
    await server.discoverSlices();
    await server.start();
    serverPort = server.port;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    fs.rmSync(tempAppDir, { recursive: true, force: true });
  });

  describe('1.1 Vendor Code-Splitting', () => {
    it('builds _vendor.js containing react and synapsejs/client', async () => {
      const vendorResult = await buildVendorBundle(tempAppDir);
      expect(vendorResult.ok).toBe(true);

      const vendorFile = path.join(tempAppDir, '.synapse', 'client', VENDOR_BUNDLE_NAME);
      expect(fs.existsSync(vendorFile)).toBe(true);

      const size = fs.statSync(vendorFile).size;
      expect(size).toBeGreaterThan(15000); // Vendor bundle has React & ReactDOM runtime
    });

    it('builds slice client bundle without inlining React (< 5KB vs 1MB)', async () => {
      const slicePath = path.join(tempAppDir, 'src', 'slices', 'marketing', 'landing.slice.tsx');
      const bundle = await buildClientBundle(
        {
          key: 'marketing/landing',
          name: 'landing',
          domain: 'marketing',
          filePath: slicePath,
          rpcPath: '/_synapse/rpc/marketing/landing',
          vendorSplit: true
        },
        tempAppDir
      );

      expect(bundle.ok).toBe(true);
      if (!bundle.ok) return;

      expect(bundle.value.url).toBe('/_synapse/client/marketing-landing.js');
      // Splitting external dependencies keeps slice bundle tiny (< 5KB, usually < 1KB)
      expect(bundle.value.bytes).toBeLessThan(5000);
      expect(bundle.value.bytes).toBeGreaterThan(50);

      const bundleContent = fs.readFileSync(bundle.value.filePath, 'utf-8');
      // Must not bundle the massive React implementation inside the slice bundle
      expect(bundleContent).not.toContain('ReactCurrentDispatcher');
    });
  });

  describe('1.2 Dynamic Head SEO (sliceMeta)', () => {
    it('splitter preserves sliceMeta on server and emits 0 leaks in client', () => {
      const slicePath = path.join(tempAppDir, 'src', 'slices', 'marketing', 'landing.slice.tsx');
      const split = splitSlice(slicePath, tempAppDir);
      expect(split.ok).toBe(true);
      if (!split.ok) return;

      const outDir = artifactDirectory(tempAppDir, split.value.sliceName);
      writeSplitArtifacts(split.value, outDir);
      const verification = verifySplit(split.value, outDir);
      expect(verification.status).toBe('PASS');
      expect(verification.leaks).toEqual([]);

      const clientArtifact = split.value.artifacts.find((a) => a.kind === 'client');
      expect(clientArtifact).toBeDefined();
      expect(clientArtifact?.code).not.toContain('sliceMeta');

      const serverArtifact = split.value.artifacts.find((a) => a.kind === 'server');
      expect(serverArtifact).toBeDefined();
      expect(serverArtifact?.code).toContain('sliceMeta');
    });

    it('server SSR generates custom <title>, OpenGraph and meta tags from sliceMeta', async () => {
      const res = await fetch(`http://localhost:${serverPort}/marketing/landing`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Title and OpenGraph meta tags
      expect(html).toContain('<title>Página Inicial Revolucionária</title>');
      expect(html).toContain('<meta name="description" content="A melhor experiência em software distribuído">');
      expect(html).toContain('<meta property="og:description" content="A melhor experiência em software distribuído">');
      expect(html).toContain('<meta property="og:title" content="Página Inicial Revolucionária">');
      expect(html).toContain('<meta property="og:image" content="https://synapsejs.dev/og-cover.png">');
      expect(html).toContain('<link rel="canonical" href="https://synapsejs.dev/">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain('<meta name="keywords" content="framework, bun, machine">');

      // Importmap and vendor script
      expect(html).toContain('<script type="importmap">');
      expect(html).toContain('/_synapse/client/_vendor.js');
    });
  });

  describe('1.3 Hierarchical Domain Layouts', () => {
    it('nests domain layout inside root layout for domain slices', async () => {
      const res = await fetch(`http://localhost:${serverPort}/marketing/landing`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Must contain root layout and marketing layout nested
      expect(html).toContain('id="root-layout"');
      expect(html).toContain('id="marketing-layout"');
      expect(html).toContain('Bem-vindo ao Futuro');

      // Verify nesting structure: root-layout contains marketing-layout
      const rootIdx = html.indexOf('id="root-layout"');
      const mktIdx = html.indexOf('id="marketing-layout"');
      const contentIdx = html.indexOf('Bem-vindo ao Futuro');

      expect(rootIdx).toBeGreaterThan(-1);
      expect(mktIdx).toBeGreaterThan(rootIdx);
      expect(contentIdx).toBeGreaterThan(mktIdx);
    });

    it('uses only root layout for slices in domains without domain _layout.tsx', async () => {
      const res = await fetch(`http://localhost:${serverPort}/dashboard/overview`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Must contain root layout but NOT marketing layout
      expect(html).toContain('id="root-layout"');
      expect(html).not.toContain('id="marketing-layout"');
      expect(html).toContain('Painel de Controle');
    });
  });
});
