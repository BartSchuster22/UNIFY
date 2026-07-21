import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Value } from '@sinclair/typebox/value';
import {
  HermesBoardsResponseSchema,
  HermesProfilesResponseSchema,
  HermesProvidersResponseSchema,
  HermesReconcileResultSchema,
  PINNED_HERMES_COMMIT,
} from '../packages/contracts/dist/index.js';
import { buildHermesControlAdapter } from '../apps/hermes-control-adapter/dist/app.js';
import { MemoryAdapterEventStore } from '../apps/hermes-control-adapter/dist/event-store.js';
import { HermesCliRunner, HermesNativeSource } from '../apps/hermes-control-adapter/dist/source.js';

const execFileAsync = promisify(execFile);
const repo = process.env.HERMES_PINNED_REPO;
if (!repo) throw new Error('HERMES_PINNED_REPO is required');
const token = process.env.HERMES_ADAPTER_VERIFY_TOKEN;
if (!token) throw new Error('HERMES_ADAPTER_VERIFY_TOKEN is required');

const before = await trackedState(repo);
if (before.head !== PINNED_HERMES_COMMIT)
  throw new Error(`Pinned Hermes HEAD mismatch: ${before.head}`);
if (before.changed.length)
  throw new Error(`Pinned Hermes tracked tree is dirty: ${before.changed}`);

const source = new HermesNativeSource({
  runner: new HermesCliRunner(process.env.HERMES_BIN ?? 'hermes', process.env.HERMES_HOME),
});
const events = new MemoryAdapterEventStore();
const app = buildHermesControlAdapter({
  frameworkId: 'hermes-live-verify',
  displayName: 'Hermes Live Verification',
  instanceId: 'live-fixture',
  bearerToken: token,
  scopes: ['control:read', 'control:execute', 'control:events'],
  source,
  events,
  pythonVersion: '3',
  releaseId: 'live-verification',
});

try {
  const headers = { authorization: `Bearer ${token}` };
  const probes = [
    ['/control/v1/profiles', HermesProfilesResponseSchema],
    ['/control/v1/providers', HermesProvidersResponseSchema],
    ['/control/v1/work/boards', HermesBoardsResponseSchema],
  ];
  const counts = {};
  for (const [url, schema] of probes) {
    const response = await app.inject({ method: 'GET', url, headers });
    if (response.statusCode !== 200) throw new Error(`${url} returned ${response.statusCode}`);
    const body = response.json();
    if (!Value.Check(schema, body)) throw new Error(`${url} violated its frozen schema`);
    counts[url] = body.data.items.length;
  }
  const providers = await app.inject({ method: 'GET', url: '/control/v1/providers', headers });
  for (const item of providers.json().data.items) {
    if (
      Object.keys(item).some(
        (key) => !['id', 'displayName', 'credentialStatus', 'selected'].includes(key),
      )
    )
      throw new Error('Provider projection exposed an unapproved field');
  }

  const reconcile = await app.inject({
    method: 'POST',
    url: '/control/v1/commands/reconcile',
    headers,
    payload: {
      mode: 'execute',
      idempotencyKey: 'live-foundations-verification',
      requestId: 'live-request',
      correlationId: 'live-correlation',
      actor: { type: 'service', id: 'unify-live-verifier' },
      payload: { families: ['profiles', 'providers', 'work'] },
    },
  });
  if (reconcile.statusCode !== 200 || !Value.Check(HermesReconcileResultSchema, reconcile.json()))
    throw new Error(`Reconcile verification failed: ${reconcile.statusCode}`);
  if (reconcile.json().data.emittedEvents !== 3)
    throw new Error('Reconcile did not emit one event per observed family');

  const after = await trackedState(repo);
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error('Hermes tracked tree changed during adapter verification');
  console.log(
    JSON.stringify({
      verified: true,
      hermesCommit: before.head,
      profileCount: counts['/control/v1/profiles'],
      providerCount: counts['/control/v1/providers'],
      boardCount: counts['/control/v1/work/boards'],
      emittedEvents: 3,
      hermesTrackedChanges: 0,
    }),
  );
} finally {
  await app.close();
}

async function trackedState(path) {
  const [head, unstaged, staged] = await Promise.all([
    runGit(path, ['rev-parse', 'HEAD']),
    runGit(path, ['diff', '--name-only']),
    runGit(path, ['diff', '--cached', '--name-only']),
  ]);
  return {
    head: head.trim(),
    changed: [...new Set([...unstaged.split('\n'), ...staged.split('\n')].filter(Boolean))].sort(),
  };
}

async function runGit(path, args) {
  return (
    await execFileAsync('git', ['-C', path, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout;
}
