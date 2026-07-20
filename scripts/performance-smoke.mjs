#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const target = process.env.PERFORMANCE_URL ?? 'http://127.0.0.1:28081/api/v1/health/ready';
const total = Number(process.env.PERFORMANCE_REQUESTS ?? 1000);
const concurrency = Number(process.env.PERFORMANCE_CONCURRENCY ?? 25);
const p95BudgetMs = Number(process.env.PERFORMANCE_P95_MS ?? 250);
if (![total, concurrency, p95BudgetMs].every((value) => Number.isFinite(value) && value > 0))
  throw new Error('Performance parameters must be positive numbers');

const durations = [];
let failures = 0;
let cursor = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= total) return;
    const started = performance.now();
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(5_000) });
      await response.arrayBuffer();
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    } finally {
      durations.push(performance.now() - started);
    }
  }
}
const wallStart = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const wallMs = performance.now() - wallStart;
durations.sort((a, b) => a - b);
const percentile = (fraction) =>
  durations[Math.min(durations.length - 1, Math.ceil(durations.length * fraction) - 1)] ?? 0;
const result = {
  target,
  requests: total,
  concurrency,
  failures,
  p50Ms: Number(percentile(0.5).toFixed(2)),
  p95Ms: Number(percentile(0.95).toFixed(2)),
  p99Ms: Number(percentile(0.99).toFixed(2)),
  requestsPerSecond: Number((total / (wallMs / 1000)).toFixed(2)),
  budgetP95Ms: p95BudgetMs,
};
console.log(JSON.stringify(result));
if (failures || result.p95Ms > p95BudgetMs) process.exitCode = 1;
