#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const dockerfile = read('Dockerfile.hermes-runtime');

for (const expected of [
  'nousresearch/hermes-agent@sha256:fcbe95482353e41cd30d39ddfc0f57ba3720f6da6969a7a69cdfb0d84b045cb6',
  'node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e',
  'ARG HERMES_RELEASE=0.20.0',
  'ARG HERMES_COMMIT=b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
  'HERMES_API_BASE_URL=http://127.0.0.1:8642',
  'HERMES_API_HOST=127.0.0.1',
  'PORT=28082',
  'EXPOSE 28082',
  'HERMES_REPO=/opt/hermes',
  'com.aquiero.image.role="hermes-runtime-control-adapter"',
  'HEALTHCHECK',
])
  assert.ok(dockerfile.includes(expected), `Dockerfile.hermes-runtime is missing ${expected}`);

assert.ok(
  !/^FROM\s+[^\s@]+:[^\s@]+\s/mu.test(dockerfile),
  'Every base image must be digest pinned',
);
assert.ok(
  !dockerfile.includes('docker.sock'),
  'The combined image must not depend on the Docker socket',
);
assert.ok(
  dockerfile.includes('rm -f /etc/s6-overlay/s6-rc.d/user/contents.d/main-hermes'),
  'The upstream no-op main service must be removed from the s6 user bundle',
);

const gatewayRun = read(
  'deploy/hermes-runtime/rootfs/etc/s6-overlay/s6-rc.d/unify-hermes-gateway/run',
);
const adapterRun = read(
  'deploy/hermes-runtime/rootfs/etc/s6-overlay/s6-rc.d/unify-control-adapter/run',
);
const init = read('deploy/hermes-runtime/rootfs/etc/cont-init.d/10-hermes-api-secret');
const health = read('deploy/hermes-runtime/healthcheck.mjs');

assert.ok(gatewayRun.includes('/command/s6-setuidgid hermes'));
assert.ok(gatewayRun.includes('/opt/hermes/bin/hermes gateway run'));
assert.ok(gatewayRun.includes('API_SERVER_HOST="${HERMES_API_HOST:-127.0.0.1}"'));
assert.ok(adapterRun.includes('/command/s6-setuidgid hermes'));
assert.ok(adapterRun.includes('/opt/unify-adapter/dist/server.js'));
assert.ok(adapterRun.includes('http://127.0.0.1:${HERMES_API_PORT:-8642}'));
assert.ok(init.includes('/var/run/s6/container_environment/API_SERVER_KEY'));
assert.ok(!init.includes('set -x'));
for (const service of ['unify-hermes-gateway', 'unify-control-adapter']) {
  assert.ok(health.includes(`assertServiceUp('${service}')`));
  assert.equal(
    read(`deploy/hermes-runtime/rootfs/etc/s6-overlay/s6-rc.d/${service}/type`).trim(),
    'longrun',
  );
  assert.ok(
    statSync(
      resolve(
        root,
        `deploy/hermes-runtime/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/${service}`,
      ),
    ).isFile(),
  );
}
assert.ok(health.includes("['-o', 'up', `/run/service/${name}`]"));
assert.ok(health.includes("getJson('/control/v1/health'"));
assert.ok(health.includes("getJson('/control/v1/version'"));
assert.ok(health.includes("required('HERMES_ADAPTER_TLS_CA_FILE')"));
assert.ok(health.includes("required('EXPECTED_HERMES_COMMIT')"));
assert.ok(!health.includes('rejectUnauthorized: false'));

console.log('Hermes combined image static contract: PASS');
