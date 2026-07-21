#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import process from 'node:process';

const repo = process.env.HERMES_PINNED_REPO;
const token = process.env.HERMES_FIXTURE_TOKEN;
if (!repo || !token) throw new Error('HERMES_PINNED_REPO and HERMES_FIXTURE_TOKEN are required');
const baseline = JSON.parse(
  await readFile(
    new URL('../fixtures/hermes-control/pinned-baseline.json', import.meta.url),
    'utf8',
  ),
);
const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== baseline.frameworkCommit)
  throw new Error(`Hermes fixture HEAD ${head} does not match pinned ${baseline.frameworkCommit}`);
execFileSync('git', ['-C', repo, 'diff', '--quiet']);
execFileSync('git', ['-C', repo, 'diff', '--cached', '--quiet']);
const observedAt = new Date().toISOString();
const meta = {
  contractVersion: baseline.contractVersion,
  frameworkId: baseline.frameworkId,
  frameworkVersion: baseline.frameworkVersion,
  frameworkCommit: baseline.frameworkCommit,
  sourceVersion: baseline.sourceVersion,
  observedAt,
};
const responses = {
  '/control/v1/identity': {
    ...meta,
    data: {
      runtime: baseline.runtime,
      instanceId: baseline.instanceId,
      displayName: baseline.displayName,
    },
  },
  '/control/v1/version': {
    ...meta,
    data: {
      release: baseline.frameworkVersion,
      commit: baseline.frameworkCommit,
      upstreamBaseCommit: baseline.upstreamBaseCommit,
      dirty: false,
      pythonVersion: execFileSync('python3', ['--version'], { encoding: 'utf8' })
        .trim()
        .replace('Python ', ''),
    },
  },
  '/control/v1/capabilities': { ...meta, data: { capabilities: baseline.capabilities } },
};
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unauthenticated' }));
    return;
  }
  const body = responses[request.url];
  response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body ?? { error: 'not_found' }));
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture failed to bind');
  process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${address.port}`, head })}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close(() => process.exit(0)));
