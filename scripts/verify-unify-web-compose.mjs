#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const composePath = resolve(root, 'deploy/unify-web/compose.yaml');
const fixture = {
  ...process.env,
  UNIFY_WEB_IMAGE:
    'registry.example.com/unify/web@sha256:0000000000000000000000000000000000000000000000000000000000000000',
  UNIFY_INGRESS_NETWORK: 'unify_unify-ingress',
  UNIFY_CORE_INTERNAL_URL: 'http://unify-core:8080',
};
const result = spawnSync('docker', ['compose', '-f', composePath, 'config', '--format', 'json'], {
  cwd: root,
  env: fixture,
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
});
if (result.status !== 0)
  throw new Error(
    `UNIFY Web Compose rendering failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
  );
const config = JSON.parse(result.stdout);
assert.deepEqual(Object.keys(config.services), ['unify-web']);
const web = config.services['unify-web'];
assert.match(web.image, /@sha256:[a-f0-9]{64}$/u);
assert.equal(web.user, '65532:65532');
assert.equal(web.restart, 'unless-stopped');
assert.equal(web.read_only, true);
assert.equal(web.init, true);
assert.deepEqual(web.cap_drop, ['ALL']);
assert.ok(web.security_opt.includes('no-new-privileges:true'));
assert.equal(web.privileged ?? false, false);
assert.equal(web.network_mode ?? null, null);
assert.deepEqual(web.ports ?? [], []);
assert.deepEqual(web.volumes ?? [], []);
assert.deepEqual(web.secrets ?? [], []);
assert.ok(!JSON.stringify(web).includes('docker.sock'));
assert.equal(web.environment.GATEWAY_INTERNAL_URL, 'http://unify-core:8080');
assert.equal(web.environment.HOST, '0.0.0.0');
assert.equal(String(web.environment.PORT), '3000');
assert.ok(Number(web.pids_limit) > 0);
assert.ok(Number(web.mem_limit) > 0);
assert.ok(Number(web.cpus) > 0);
assert.ok(web.logging?.options?.['max-size']);
assert.ok(web.logging?.options?.['max-file']);
assert.deepEqual(Object.keys(web.networks), ['unify-ingress']);
assert.ok(web.networks['unify-ingress'].aliases.includes('unify-web'));
const ingress = config.networks['unify-ingress'];
assert.equal(ingress.external, true);
assert.equal(ingress.name, 'unify_unify-ingress');

const dockerfile = readFileSync(resolve(root, 'Dockerfile.uniui'), 'utf8');
for (const required of [
  'node:22.22.2-alpine@sha256:',
  'gcr.io/distroless/nodejs22-debian13:nonroot@sha256:',
  'pnpm install --frozen-lockfile',
  'USER 65532:65532',
  'HEALTHCHECK',
  'STOPSIGNAL SIGTERM',
])
  assert.ok(dockerfile.includes(required), `Dockerfile.uniui is missing ${required}`);

const server = readFileSync(resolve(root, 'apps/uniui/server.mjs'), 'utf8');
for (const required of [
  "req.url === '/healthz'",
  "req.url?.startsWith('/api/')",
  "'set-cookie'",
  "'content-security-policy'",
  'Graceful shutdown complete',
])
  assert.ok(server.includes(required), `UNIFY Web server is missing ${required}`);

console.log('UNIFY Web Compose and image security contract: PASS');
