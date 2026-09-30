#!/usr/bin/env bun
/**
 * SynapseJS - Concurrency Benchmark
 *
 * Boots the reference application with its slices actually discovered, then measures
 * three arms with a load generator that runs in a **separate process** so the client
 * cannot be measured against its own event loop:
 *
 *   1. `baseline-static-json` — a bare `Bun.serve` returning a fixed JSON payload.
 *      This is the floor, and it is **not comparable** to the framework arms: it
 *      renders nothing and touches no database.
 *   2. `ssr-render` — a real server-rendered slice page (loader + component + shell).
 *   3. `rpc-persisted-write` — a real RPC action that writes a row through SQLite.
 *
 * Every number this script prints is produced by this run, on this machine. It is a
 * measurement, not a claim: throughput depends on the host, the SQLite file and the
 * concurrency configured below. What it does *not* measure: multi-instance behaviour,
 * PostgreSQL, or any network beyond loopback.
 *
 * Usage: bun run bench:concurrency [--json]
 */

import * as path from 'path';
import { SynapseServer } from '../packages/synapse/src/runtime/server';

interface ArmResult {
  arm: string;
  url: string;
  requests: number;
  concurrency: number;
  requestsPerSecond: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  errors: number;
}

const REQUESTS = Number(process.env.SYNAPSE_BENCH_REQUESTS ?? 300);
const CONCURRENCY = Number(process.env.SYNAPSE_BENCH_CONCURRENCY ?? 20);

async function runArm(config: {
  arm: string;
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}): Promise<ArmResult> {
  const worker = Bun.spawn(
    [
      process.execPath,
      path.resolve(import.meta.dir, 'bench-concurrency-worker.ts'),
      JSON.stringify({
        url: config.url,
        method: config.method,
        body: config.body,
        headers: config.headers,
        requests: REQUESTS,
        concurrency: CONCURRENCY
      })
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(worker.stdout).text(),
    new Response(worker.stderr).text(),
    worker.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(`load generator failed for ${config.arm}: ${stderr || stdout}`);
  }

  const measured = JSON.parse(stdout.trim()) as Omit<ArmResult, 'arm' | 'url' | 'concurrency'>;

  return { arm: config.arm, url: config.url, concurrency: CONCURRENCY, ...measured };
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const appDir = path.resolve(import.meta.dir, '../examples/enterprise-crm');

  // The development header opt-in is what the reference application's own e2e suite uses.
  process.env.SYNAPSE_DEV_HEADERS = 'true';

  const baseline = Bun.serve({
    port: 0,
    fetch: () => Response.json({ status: 'OK' })
  });

  // The limiter is widened so this measures rendering and persistence rather than the
  // allowance: the limiter's own behaviour is covered by the abuse-resistance suite.
  const server = new SynapseServer(appDir, 0, undefined, {
    rateLimit: { capacity: 1_000_000, refillRate: 1_000_000 }
  });

  // The server's startup chatter goes to stdout; a machine consumer of this script
  // gets exactly one JSON document, so it is silenced for the bootstrap only.
  const startupLog = console.log;
  console.log = () => {};
  try {
    await server.discoverSlices();
    await server.start();
  } finally {
    console.log = startupLog;
  }

  const slicesLoaded = server.loadedSliceCount;

  if (slicesLoaded === 0) {
    throw new Error('the benchmark server discovered zero slices: it would measure nothing');
  }

  const base = `http://localhost:${server.port}`;
  const sessionHeaders = { 'x-user-id': 'bench', 'x-user-roles': 'sales' } as Record<string, string>;
  // The write arm persists rows, so each run gets its own identity prefix: a repeated
  // run must measure a write, not a duplicate rejection.
  const runId = crypto.randomUUID().slice(0, 8);

  try {
    const arms: ArmResult[] = [];

    arms.push(
      await runArm({
        arm: 'baseline-static-json (not comparable: no render, no database)',
        url: `http://localhost:${baseline.port}/_synapse/api/health`,
        method: 'GET'
      })
    );

    arms.push(
      await runArm({
        arm: 'ssr-render (loader + component + shell)',
        url: `${base}/customers/create-customer`,
        method: 'GET',
        headers: sessionHeaders
      })
    );

    arms.push(
      await runArm({
        arm: 'rpc-persisted-write (action + SQLite write)',
        url: `${base}/_synapse/rpc/customers/create-customer`,
        method: 'POST',
        headers: { ...sessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cliente Benchmark',
          email: `bench-${runId}-{{i}}@example.com`,
          taxId: `TAX-${runId}-{{i}}`
        })
      })
    );

    const report = {
      status: 'PASS',
      benchmark: 'SYNAPSE_CONCURRENCY_BENCHMARK',
      application: path.relative(path.resolve(import.meta.dir, '..'), appDir),
      slicesLoaded,
      requestsPerArm: REQUESTS,
      concurrency: CONCURRENCY,
      loadGeneratorProcess: 'separate',
      measures: 'loopback throughput and latency on this host, one process, one SQLite file',
      doesNotMeasure: 'multi-instance behaviour, PostgreSQL, real network latency',
      arms
    };

    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const lines = [
        `SYNAPSE_CONCURRENCY_BENCHMARK — ${report.application}, ${slicesLoaded} slices, ${REQUESTS} requests/arm at concurrency ${CONCURRENCY}`,
        ''
      ];

      for (const arm of arms) {
        lines.push(
          `${arm.arm}\n  throughput ${arm.requestsPerSecond} req/s · p50 ${arm.latencyMs.p50} ms · p95 ${arm.latencyMs.p95} ms · p99 ${arm.latencyMs.p99} ms · errors ${arm.errors}`
        );
      }

      lines.push('', `Does not measure: ${report.doesNotMeasure}.`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
  } finally {
    await server.stop(1000);
    baseline.stop(true);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`bench-concurrency failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
