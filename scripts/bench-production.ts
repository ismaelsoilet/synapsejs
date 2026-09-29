/**
 * SynapseJS - Production Ground-Truth Benchmark
 *
 * Measures REAL-WORLD throughput and latency percentiles (p50, p95, p99)
 * for:
 * 1. Full SSR HTML Render: React 19 SSR, Dynamic Meta, Layouts
 * 2. Full Database RPC Mutation: TypeBox JIT validation + SQLite SELECT + SQLite INSERT
 *
 * Implemented as part of the SureForge Radical Candor engineering protocol:
 * Ground-truth evidence replacing synthetic health-check metrics.
 */

import * as path from 'path';
import { SynapseServer } from '../packages/synapse/src/runtime/server';

interface BenchmarkMetrics {
  operation: string;
  totalRequests: number;
  concurrency: number;
  durationMs: number;
  requestsPerSecond: number;
  latencies: {
    minMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  errors: number;
  memoryDeltaMb: number;
}

function calculatePercentiles(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }

  return {
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number((sorted[Math.floor(n * 0.5)] || 0).toFixed(2)),
    p95Ms: Number((sorted[Math.floor(n * 0.95)] || 0).toFixed(2)),
    p99Ms: Number((sorted[Math.floor(n * 0.99)] || 0).toFixed(2)),
    maxMs: Number(sorted[n - 1].toFixed(2))
  };
}

async function runBenchmark(
  name: string,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    bodyFactory?: (idx: number) => string;
  },
  totalRequests: number,
  concurrency: number
): Promise<BenchmarkMetrics> {
  const initialMem = process.memoryUsage().rss;
  const latencies: number[] = [];
  let errors = 0;
  let completed = 0;
  const startTime = performance.now();

  async function worker() {
    while (completed < totalRequests) {
      const idx = completed++;
      const reqStart = performance.now();
      try {
        const body = options.bodyFactory ? options.bodyFactory(idx) : undefined;
        const res = await fetch(url, {
          method: options.method || 'GET',
          headers: options.headers,
          body
        });
        if (!res.ok) {
          errors++;
        }
        latencies.push(performance.now() - reqStart);
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const durationMs = performance.now() - startTime;
  const finalMem = process.memoryUsage().rss;

  return {
    operation: name,
    totalRequests,
    concurrency,
    durationMs: Number(durationMs.toFixed(2)),
    requestsPerSecond: Number(((totalRequests / durationMs) * 1000).toFixed(2)),
    latencies: calculatePercentiles(latencies),
    errors,
    memoryDeltaMb: Number(((finalMem - initialMem) / 1024 / 1024).toFixed(2))
  };
}

async function main() {
  const crmDir = path.resolve(__dirname, '../examples/enterprise-crm');
  const server = new SynapseServer(crmDir, 0);

  await server.discoverSlices();
  await server.start();
  // biome-ignore lint/suspicious/noExplicitAny: internal port
  const port = (server as any).httpServer.port;
  const serverUrl = `http://localhost:${port}`;

  process.stdout.write(`\n⚡ SynapseJS Production Benchmark running on ${serverUrl}\n`);
  process.stdout.write(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    const totalRequests = 100;
    const concurrency = 10;

    // 1. SSR HTML Rendering Benchmark
    process.stdout.write(`1. Running SSR Route Benchmark (React 19 SSR + Layouts)...\n`);
    const ssrResult = await runBenchmark(
      'SSR_REACT_19_RENDER',
      `${serverUrl}/customers/create-customer`,
      { method: 'GET' },
      totalRequests,
      concurrency
    );

    // 2. Real Database Mutation Benchmark (RPC with TypeBox + SQLite Queries)
    process.stdout.write(`2. Running RPC Database Mutation Benchmark (TypeBox + SQLite)...\n`);
    const rpcResult = await runBenchmark(
      'RPC_DB_MUTATION',
      `${serverUrl}/_synapse/rpc/customers/create-customer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyFactory: (idx) =>
          JSON.stringify({
            name: `Empresa Benchmark ${idx}`,
            email: `bench_${Date.now()}_${idx}@empresa.com`,
            taxId: `TAX_${Date.now()}_${idx}`
          })
      },
      totalRequests,
      concurrency
    );

    const report = {
      timestamp: new Date().toISOString(),
      platform: {
        runtime: `Bun ${Bun.version}`,
        os: process.platform,
        arch: process.arch
      },
      benchmarks: [ssrResult, rpcResult]
    };

    process.stdout.write(`\n📊 Ground-Truth Production Benchmark Results:\n`);
    process.stdout.write(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    for (const b of report.benchmarks) {
      process.stdout.write(`🔹 [${b.operation}]\n`);
      process.stdout.write(`   Throughput:  ${b.requestsPerSecond.toLocaleString()} req/s\n`);
      process.stdout.write(`   Latency p50: ${b.latencies.p50Ms} ms\n`);
      process.stdout.write(`   Latency p95: ${b.latencies.p95Ms} ms\n`);
      process.stdout.write(`   Latency p99: ${b.latencies.p99Ms} ms\n`);
      process.stdout.write(`   Errors:      ${b.errors} / ${b.totalRequests}\n`);
      process.stdout.write(`   Memory Δ:    ${b.memoryDeltaMb} MB\n\n`);
    }

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: stop server
    (server as any).httpServer?.stop(true);
  }
}

main().catch((err) => {
  process.stderr.write(`Benchmark error: ${err.message}\n`);
  process.exit(1);
});
