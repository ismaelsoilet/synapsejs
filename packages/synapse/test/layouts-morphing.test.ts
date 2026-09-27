import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { SynapseServer } from '../src/runtime/server';

describe('UI Layouts & Turbo SPA Morphing Router (Fase C)', () => {
  test('wraps slice component with root layout when _layout.tsx is present', async () => {
    const fixturesDir = path.join(import.meta.dir, 'fixtures');
    const appDir = fs.mkdtempSync(path.join(fixturesDir, 'tmp-layout-'));
    const slicesDir = path.join(appDir, 'src', 'slices');
    const dashboardDir = path.join(slicesDir, 'dashboard');
    fs.mkdirSync(dashboardDir, { recursive: true });

    // Root layout component
    const layoutPath = path.join(slicesDir, '_layout.tsx');
    fs.writeFileSync(
      layoutPath,
      `
      import React from 'react';
      export default function RootLayout({ children }: { children: React.ReactNode }) {
        return React.createElement(
          'div',
          { 'data-testid': 'root-layout-wrapper' },
          React.createElement('nav', { 'data-testid': 'main-nav' }, 'Global SaaS Navigation'),
          children
        );
      }
      `
    );

    // Slice component
    const slicePath = path.join(dashboardDir, 'overview.slice.tsx');
    fs.writeFileSync(
      slicePath,
      `
      import React from 'react';
      export function OverviewView() {
        return React.createElement('h1', { 'data-testid': 'overview-title' }, 'Dashboard Overview Page');
      }
      `
    );

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    const res = await fetch(`http://localhost:${server.port}/dashboard/overview`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('data-testid="root-layout-wrapper"');
    expect(html).toContain('Global SaaS Navigation');
    expect(html).toContain('Dashboard Overview Page');
    expect(html).toContain('<script type="module" src="/_synapse/turbo-router.js"></script>');

    await server.stop();
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  test('renders slice directly when no root layout is present', async () => {
    const fixturesDir = path.join(import.meta.dir, 'fixtures');
    const appDir = fs.mkdtempSync(path.join(fixturesDir, 'tmp-no-layout-'));
    const slicesDir = path.join(appDir, 'src', 'slices');
    const itemsDir = path.join(slicesDir, 'items');
    fs.mkdirSync(itemsDir, { recursive: true });

    // Slice component
    const slicePath = path.join(itemsDir, 'list.slice.tsx');
    fs.writeFileSync(
      slicePath,
      `
      import React from 'react';
      export function ListView() {
        return React.createElement('h1', null, 'Plain Items List');
      }
      `
    );

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    const res = await fetch(`http://localhost:${server.port}/items/list`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).not.toContain('data-testid="root-layout-wrapper"');
    expect(html).toContain('Plain Items List');

    await server.stop();
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  test('serves the Turbo Morphing script via /_synapse/turbo-router.js', async () => {
    const fixturesDir = path.join(import.meta.dir, 'fixtures');
    const appDir = fs.mkdtempSync(path.join(fixturesDir, 'tmp-turbo-'));
    const slicesDir = path.join(appDir, 'src', 'slices');
    const itemsDir = path.join(slicesDir, 'home');
    fs.mkdirSync(itemsDir, { recursive: true });

    const slicePath = path.join(itemsDir, 'welcome.slice.tsx');
    fs.writeFileSync(
      slicePath,
      `
      import React from 'react';
      export function WelcomeView() {
        return React.createElement('div', null, 'Welcome');
      }
      `
    );

    const server = new SynapseServer(appDir, 0);
    await server.discoverSlices();
    await server.start();

    const res = await fetch(`http://localhost:${server.port}/_synapse/turbo-router.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');

    const script = await res.text();
    expect(script).toContain('__synapseNavInstalled');
    expect(script).toContain('X-Synapse-Morph');
    expect(script).toContain('#synapse-root');

    await server.stop();
    fs.rmSync(appDir, { recursive: true, force: true });
  });
});
