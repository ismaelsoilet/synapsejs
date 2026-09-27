/**
 * SynapseJS - Concurrency & Load Stress Benchmark
 *
 * Measures real-world throughput, latency percentiles (p50, p95, p99),
 * and memory overhead under high concurrency.
 *
 * Part of the SureForge Radical Candor protocol: NO fabricated numbers!
 */

import * as path from 'path';
import { SynapseServer } from '../packages/synapse/src/runtime/server';

interface BenchmarkResult {
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

function calculatePercentiles(latencies: number[]): {
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
} {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }

  const p50 = sorted[Math.floor(n * 0.5)] || 0;
  const p95 = sorted[Math.floor(n * 0.95)] || 0;
  const p99 = sorted[Math.floor(n * 0.99)] || 0;

  return {
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    p99Ms: Number(p99.toFixed(2)),
    maxMs: Number(sorted[n - 1].toFixed(2))
  };
}

async function runHttpBenchmark(
  serverUrl: string,
  totalRequests: number,
  concurrency: number
): Promise<BenchmarkResult> {
  const initialMem = process.memoryUsage().rss;
  const latencies: number[] = [];
  let errors = 0;

  const startTime = performance.now();
  let completed = 0;

  async function worker() {
    while (completed < totalRequests) {
      completed++;
      const reqStart = performance.now();
      try {
        const res = await fetch(`${serverUrl}/_synapse/api/health`);
        if (!res.ok) {
          errors++;
        }
        latencies.push(performance.now() - reqStart);
      } catch {
        errors++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = performance.now() - startTime;
  const finalMem = process.memoryUsage().rss;

  return {
    operation: 'HTTP_HEALTH_CONCURRENCY',
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

  await server.start();
  // biome-ignore lint/suspicious/noExplicitAny: internal port
  const port = (server as any).httpServer.port;
  const serverUrl = `http://localhost:${port}`;

  try {
    const totalRequests = 1000;
    const concurrency = 50;

    const result = await runHttpBenchmark(serverUrl, totalRequests, concurrency);

    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'PASS',
          benchmark: 'SYNAPSE_CONCURRENCY_BENCHMARK',
          result
        },
        null,
        2
      )}\n`
    );
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: stop server
    (server as any).httpServer?.stop(true);
  }
}

main().catch((err) => {
  process.stderr.write(`Benchmark failed: ${err.message}\n`);
  process.exit(1);
});
