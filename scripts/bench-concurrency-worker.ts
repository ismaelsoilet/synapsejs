#!/usr/bin/env bun
/**
 * SynapseJS - Load Generator (separate process)
 *
 * The concurrency benchmark's load generator runs here, in its own process, so the
 * client's event loop and the server under test never share one — a shared process
 * measures the benchmark against itself.
 *
 * Usage: bun scripts/bench-concurrency-worker.ts '<json config>'
 */

export {};

interface WorkerConfig {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  requests: number;
  concurrency: number;
}

const config = JSON.parse(process.argv[2] ?? '{}') as WorkerConfig;

if (!config.url || !config.requests || !config.concurrency) {
  process.stderr.write('bench-concurrency-worker: url, requests and concurrency are required\n');
  process.exit(2);
}

const latencies: number[] = [];
let dispatched = 0;
let errors = 0;

const startedAt = performance.now();

async function worker(): Promise<void> {
  for (;;) {
    const index = dispatched++;

    if (index >= config.requests) {
      return;
    }

    const requestStartedAt = performance.now();

    try {
      // `{{i}}` makes each request a distinct payload: a benchmark that reuses one
      // e-mail would measure duplicate rejections after the first iteration.
      const body = config.body?.replace(/\{\{i\}\}/g, String(index));

      const response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body
      });

      await response.arrayBuffer();

      if (!response.ok) {
        errors++;
      }
    } catch {
      errors++;
    }

    latencies.push(performance.now() - requestStartedAt);
  }
}

await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

const durationMs = performance.now() - startedAt;
const sorted = [...latencies].sort((left, right) => left - right);
const percentile = (fraction: number) =>
  Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0).toFixed(2));

process.stdout.write(
  `${JSON.stringify({
    requests: latencies.length,
    errors,
    concurrency: config.concurrency,
    durationMs: Number(durationMs.toFixed(2)),
    requestsPerSecond: Number(((latencies.length / durationMs) * 1000).toFixed(2)),
    latencyMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2))
    }
  })}\n`
);
