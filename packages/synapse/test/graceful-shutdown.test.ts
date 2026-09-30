import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteDatabaseClient } from '../src/core/sqlite-client';
import { QueueEngine } from '../src/runtime/queue-engine';
import { SynapseServer } from '../src/runtime/server';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-shutdown-'));
const appDir = path.join(sandbox, 'app');

beforeAll(() => {
  fs.symlinkSync(path.resolve(import.meta.dir, '../../../node_modules'), path.join(sandbox, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(appDir, 'src', 'slices', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'src', 'slices', 'demo', 'slow.slice.tsx'),
    `import { Type } from '@sinclair/typebox';
import { Ok, type Result } from 'synapsejs';

export const SlowInputSchema = Type.Object({ delay: Type.Optional(Type.Number()) });

export async function slowAction(payload: { delay?: number }, db: any): Promise<Result<{ slept: number }, 'ERR'>> {
  const delay = payload?.delay ?? 400;
  await new Promise((resolve) => setTimeout(resolve, delay));
  // Touching the database after the delay is what proves persistence is still open.
  await db.query('SELECT 1;');
  return Ok({ slept: delay });
}
`,
    'utf-8'
  );
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

let boot = 0;

async function bootServer(): Promise<SynapseServer> {
  boot++;
  const db = new SqliteDatabaseClient(path.join(appDir, '.synapse', `shutdown-${boot}.sqlite`));
  const server = new SynapseServer(appDir, 0, db);
  await server.discoverSlices();
  await server.start();

  return server;
}

function callSlow(port: number, delay: number): Promise<Response> {
  return fetch(`http://localhost:${port}/_synapse/rpc/demo/slow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delay })
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('graceful shutdown', () => {
  it('delivers the full response of a request that outlives the old 200 ms wait', async () => {
    const server = await bootServer();
    const port = server.port;

    let responseAt = 0;
    const request = callSlow(port, 500).then((response) => {
      responseAt = performance.now();

      return response;
    });

    await sleep(50);
    const stopStartedAt = performance.now();
    const summary = await server.stop(1500);
    const stopResolvedAt = performance.now();

    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: { slept: 500 } });

    // The shutdown did not resolve before the response was written, and the request
    // that finished in time is reported as drained rather than aborted. The wait is
    // bounded below by the old 200 ms cap — the margin depends on how long the request
    // took to reach the server, so the assertion states the property, not a fixed value.
    expect(responseAt).toBeLessThanOrEqual(stopResolvedAt + 1);
    expect(stopResolvedAt - stopStartedAt).toBeGreaterThan(300);
    expect(summary.drained).toBeGreaterThanOrEqual(1);
    expect(summary.aborted).toBe(0);
  });

  it('keeps the database open until the drain resolves', async () => {
    const server = await bootServer();
    const port = server.port;

    const request = callSlow(port, 500);
    await sleep(60);

    const summary = await server.stop(1500);
    const response = await request;

    // The action queried the database after the old 200 ms close point.
    expect(response.status).toBe(200);
    expect(summary.aborted).toBe(0);
  });

  it('aborts a request that outlives the timeout with a draining code, and reports it', async () => {
    const server = await bootServer();
    const port = server.port;

    const request = callSlow(port, 800);
    await sleep(50);

    const summary = await server.stop(100);
    const response = await request;

    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe('DRAINING');
    expect(summary.aborted).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent: a second stop resolves the same way and closes nothing twice', async () => {
    const server = await bootServer();

    const first = await server.stop(50);
    const second = await server.stop(50);

    expect(second).toEqual(first);
    expect(server.shutdownSummary).toEqual(first);
  });

  it('is a no-op when the server was never started', async () => {
    const db = new SqliteDatabaseClient(path.join(appDir, '.synapse', 'never-started.sqlite'));
    const server = new SynapseServer(appDir, 0, db);

    const summary = await server.stop(50);

    expect(summary.drained).toBe(0);
    expect(summary.aborted).toBe(0);
  });
});

describe('queue shutdown', () => {
  it('stops claiming, requeues an interrupted job once, and fails an exhausted one', async () => {
    const queue = new QueueEngine({ dbPath: ':memory:' });
    queue.registerJob({
      name: 'demo-job',
      retryLimit: 3,
      handler: async () => {}
    });

    const id = await queue.enqueue('demo-job', { value: 1 });
    const claimed = queue.claimNextJob();

    expect(claimed?.id).toBe(id);
    expect(claimed?.attempts).toBe(1);

    const interrupted = queue.interruptRunningJobs();

    expect(interrupted.requeued).toBe(1);

    const rows = queue.database.prepare('SELECT status, attempts FROM _synapse_jobs WHERE id = ?1').get(id) as {
      status: string;
      attempts: number;
    };

    // Back to pending, with exactly the attempt the interrupted claim consumed.
    expect(rows.status).toBe('pending');
    expect(rows.attempts).toBe(1);

    // The next claim counts once, not twice.
    const reclaimed = queue.claimNextJob();
    expect(reclaimed?.attempts).toBe(2);

    // Claiming stops at shutdown: nothing else is handed out.
    queue.stopClaiming();
    expect(queue.isClaimingStopped).toBe(true);
    expect(queue.claimNextJob()).toBeNull();

    // An exhausted job is failed rather than returned.
    queue.database.prepare('UPDATE _synapse_jobs SET attempts = max_attempts WHERE id = ?1').run(id);
    const exhausted = queue.interruptRunningJobs();
    expect(exhausted.failed).toBe(1);
    expect(exhausted.requeued).toBe(0);

    queue.close();
  });
});
