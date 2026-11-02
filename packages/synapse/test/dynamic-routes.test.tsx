import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { renderToString } from 'react-dom/server';
import { SynapseProvider } from '../src/client/context';
import { useParams, useSearchParams } from '../src/client/hooks';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { SynapseServer } from '../src/runtime/server';

setDefaultTimeout(30_000);

const fixtureDir = path.join(import.meta.dir, 'fixtures', 'dynamic-routes-app');

function TestComponent() {
  const params = useParams<{ id: string; filter?: string }>();
  const [searchParams] = useSearchParams();
  return (
    <div data-testid="params-display">
      <span id="param-id">{params.id}</span>
      <span id="param-filter">{params.filter ?? 'none'}</span>
      <span id="search-query">{searchParams.get('q') ?? 'empty'}</span>
    </div>
  );
}

describe('SynapseJS Dynamic URL Routing & Isomorphic Hooks', () => {
  let server: SynapseServer;
  let testDb: SqliteDatabaseClient;
  let baseUrl = '';

  beforeAll(async () => {
    fs.mkdirSync(path.join(fixtureDir, 'src', 'slices', 'members'), { recursive: true });

    // Create a dynamic member profile slice
    fs.writeFileSync(
      path.join(fixtureDir, 'src', 'slices', 'members', 'profile.slice.tsx'),
      `import React from 'react';
import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';
import { useParams } from 'synapsejs/client';

export const ProfileInputSchema = Type.Object({ id: Type.String() });
export const sliceSchema = 'CREATE TABLE IF NOT EXISTS members_profile (id TEXT PRIMARY KEY, name TEXT);';

export async function profileLoader(ctx: any) {
  return {
    memberId: ctx.params?.id || 'unknown',
    param2: ctx.params?.param2 || null,
    extraQuery: ctx.params?.view || 'default'
  };
}

export async function profileAction(input: any) {
  return Ok({ status: 'updated', id: input.id });
}

export function ProfileView(props: any) {
  const params = useParams<{ id: string }>();
  return (
    <div>
      <h1 id="rendered-title">Perfil do Membro: {props.memberId}</h1>
      <span id="hook-param-id">{params.id}</span>
      <p id="subview">Visualizacao: {props.extraQuery}</p>
      {props.param2 && <p id="extra-param">Parametro2: {props.param2}</p>}
    </div>
  );
}
`
    );

    const dbPath = path.join(fixtureDir, 'test.sqlite');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    testDb = new SqliteDatabaseClient(dbPath);

    server = new SynapseServer(fixtureDir, 0, testDb);
    await server.discoverSlices();
    await server.start();
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.stop(500);
    try {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('resolves useParams and useSearchParams inside React SSR context', () => {
    const html = renderToString(
      <SynapseProvider
        url="http://localhost/members/profile?q=synapse-test"
        props={{
          __synapse_params: { id: 'usr_mem_42', filter: 'active' }
        }}
      >
        <TestComponent />
      </SynapseProvider>
    );

    expect(html).toContain('usr_mem_42');
    expect(html).toContain('active');
    expect(html).toContain('synapse-test');
  });

  it('matches single dynamic segment /:domain/:name/:id in HTTP SSR', async () => {
    const res = await fetch(`${baseUrl}/members/profile/usr_1001`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('usr_1001');
    expect(html).toContain('Perfil do Membro:');
    expect(html).toContain('"id":"usr_1001"');
    expect(html).toContain('globalThis.__SYNAPSE_ROUTE_PARAMS__');
  });

  it('matches multi-segment dynamic URLs /:domain/:name/:id/:sub in HTTP SSR', async () => {
    const res = await fetch(`${baseUrl}/members/profile/usr_1001/history`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('usr_1001');
    expect(html).toContain('history');
    expect(html).toContain('Parametro2:');
  });

  it('passes search parameters alongside route parameters to loader', async () => {
    const res = await fetch(`${baseUrl}/members/profile/usr_2002?view=audit-log`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('usr_2002');
    expect(html).toContain('Visualizacao:');
    expect(html).toContain('audit-log');
  });
});
