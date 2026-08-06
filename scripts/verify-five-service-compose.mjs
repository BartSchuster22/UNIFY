#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const composePath = resolve(root, 'deploy/five-service/compose.yaml');
const jobsPath = resolve(root, 'deploy/five-service/compose.jobs.yaml');
const fixtureEnvironment = {
  ...process.env,
  RELEASE_ID: 'phase-14.2-static',
  HERMES_RUNTIME_IMAGE: 'unify/hermes-runtime:phase-14.1',
  UNIFY_CORE_IMAGE: 'unify-core:phase-14.2',
  CADDY_IMAGE: 'unify-caddy:phase-14.2',
  UNIFY_PUBLIC_ORIGIN: 'https://localhost',
  UNIFY_PUBLIC_HOST: 'localhost',
  ALICA_DATA_PATH: '/tmp/unify-phase14-static/alica',
  HERMAN_DATA_PATH: '/tmp/unify-phase14-static/herman',
  SECRETS_DIR: '/tmp/unify-phase14-static/secrets',
  UNIFY_POSTGRES_VOLUME: 'unify-phase14-static-postgres',
  CADDY_DATA_VOLUME: 'unify-phase14-static-caddy-data',
  CADDY_LOGS_VOLUME: 'unify-phase14-static-caddy-logs',
};

const render = (files) => {
  const args = ['compose'];
  for (const file of files) args.push('-f', file);
  args.push('config', '--format', 'json');
  const result = spawnSync('docker', args, {
    cwd: root,
    env: fixtureEnvironment,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Compose rendering failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  return JSON.parse(result.stdout);
};

const config = render([composePath]);
const expectedServices = ['alica', 'caddy', 'herman', 'unify-core', 'unify-postgres'];
assert.deepEqual(Object.keys(config.services).sort(), expectedServices);

for (const [name, service] of Object.entries(config.services)) {
  assert.equal(service.restart, 'unless-stopped', `${name}: restart policy`);
  assert.equal(service.read_only, true, `${name}: read-only root`);
  assert.ok(service.cap_drop?.includes('ALL'), `${name}: capabilities not dropped`);
  assert.ok(
    service.security_opt?.includes('no-new-privileges:true'),
    `${name}: no-new-privileges missing`,
  );
  assert.ok(Number(service.pids_limit) > 0, `${name}: PID limit missing`);
  assert.ok(Number(service.mem_limit) > 0, `${name}: memory limit missing`);
  assert.ok(Number(service.cpus) > 0, `${name}: CPU limit missing`);
  assert.equal(service.privileged ?? false, false, `${name}: privileged forbidden`);
  const serialized = JSON.stringify(service);
  assert.ok(!serialized.includes('docker.sock'), `${name}: Docker socket forbidden`);
  assert.ok(service.logging?.options?.['max-size'], `${name}: log size limit missing`);
  assert.ok(service.logging?.options?.['max-file'], `${name}: log retention missing`);
  const expectedCapabilities = ['alica', 'herman'].includes(name)
    ? ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID']
    : [];
  assert.deepEqual(
    [...(service.cap_add ?? [])].sort(),
    expectedCapabilities,
    `${name}: unexpected added capability`,
  );
}

const published = Object.entries(config.services).flatMap(([name, service]) =>
  (service.ports ?? []).map((port) => ({ name, ...port })),
);
assert.deepEqual(
  published.map(({ name, published: port, target }) => [name, Number(port), Number(target)]),
  [
    ['caddy', 80, 8080],
    ['caddy', 443, 8443],
  ],
);
assert.equal(config.services.caddy.user, '10000:10000');
assert.equal(config.services['unify-postgres'].user, '70:70');
assert.match(config.services['unify-postgres'].image, /@sha256:[a-f0-9]{64}$/u);
assert.equal(config.services.caddy.image, fixtureEnvironment.CADDY_IMAGE);
const caddyDockerfile = readFileSync(resolve(root, 'Dockerfile.caddy-proxy'), 'utf8');
assert.match(caddyDockerfile, /caddy@sha256:[a-f0-9]{64}/u);
assert.ok(caddyDockerfile.includes('setcap -r /usr/bin/caddy'));
assert.equal(config.services.alica.image, config.services.herman.image);
assert.notEqual(
  config.services.alica.volumes[0].source,
  config.services.herman.volumes[0].source,
  'Alica and Herman data paths must be distinct',
);

const memberships = Object.fromEntries(
  Object.keys(config.networks).map((network) => [
    network,
    Object.entries(config.services)
      .filter(([, service]) => Object.hasOwn(service.networks ?? {}, network))
      .map(([name]) => name)
      .sort(),
  ]),
);
const networkName = (suffix) => Object.keys(config.networks).find((name) => name.endsWith(suffix));
for (const suffix of [
  'unify-ingress',
  'unify-db-private',
  'alica-db-private',
  'herman-db-private',
  'alica-control-private',
  'herman-control-private',
])
  assert.equal(config.networks[networkName(suffix)].internal, true, `${suffix}: must be internal`);
assert.deepEqual(memberships[networkName('alica-control-private')], ['alica', 'unify-core']);
assert.deepEqual(memberships[networkName('herman-control-private')], ['herman', 'unify-core']);
assert.deepEqual(memberships[networkName('unify-db-private')], ['unify-core', 'unify-postgres']);
assert.deepEqual(memberships[networkName('alica-db-private')], ['alica', 'unify-postgres']);
assert.deepEqual(memberships[networkName('herman-db-private')], ['herman', 'unify-postgres']);
assert.ok(
  !Object.values(memberships).some(
    (members) => members.includes('alica') && members.includes('herman'),
  ),
  'Alica and Herman must not share any network namespace',
);
assert.deepEqual(memberships[networkName('alica-egress')], ['alica']);
assert.deepEqual(memberships[networkName('herman-egress')], ['herman']);
assert.deepEqual(memberships[networkName('caddy-egress')], ['caddy']);
for (const network of Object.values(config.networks)) assert.notEqual(network.external, true);

assert.equal(config.services.alica.environment.PORT, '28082');
assert.equal(config.services.herman.environment.PORT, '28082');
assert.equal(config.services.alica.environment.HERMES_ADAPTER_TLS_SERVER_NAME, 'alica');
assert.equal(config.services.herman.environment.HERMES_ADAPTER_TLS_SERVER_NAME, 'herman');
assert.equal(config.services['unify-core'].depends_on.alica.condition, 'service_healthy');
assert.equal(config.services['unify-core'].depends_on.herman.condition, 'service_healthy');
assert.equal(config.services.caddy.depends_on['unify-core'].condition, 'service_healthy');

const jobs = render([composePath, jobsPath]);
const expectedJobs = [
  'bootstrap-admin',
  'migrate',
  'reconcile-database-roles',
  'reconcile-frameworks',
];
assert.deepEqual(Object.keys(jobs.services).sort(), [...expectedServices, ...expectedJobs].sort());
for (const name of expectedJobs) {
  const service = jobs.services[name];
  assert.equal(service.restart, 'no');
  assert.equal(service.read_only, true);
  assert.ok(service.cap_drop.includes('ALL'));
  assert.ok(service.security_opt.includes('no-new-privileges:true'));
}
const reconciliationNetworks = Object.keys(jobs.services['reconcile-frameworks'].networks);
assert.ok(reconciliationNetworks.some((name) => name.endsWith('alica-control-private')));
assert.ok(reconciliationNetworks.some((name) => name.endsWith('herman-control-private')));
assert.ok(reconciliationNetworks.some((name) => name.endsWith('unify-db-private')));
const frameworkDeclaration = JSON.parse(
  readFileSync(resolve(root, 'deploy/five-service/frameworks.json'), 'utf8'),
);
assert.equal(frameworkDeclaration.schemaVersion, 'unify-framework-registrations/v1');
assert.deepEqual(
  frameworkDeclaration.frameworks.map(({ frameworkId, baseUrl, serviceAuthReference }) => ({
    frameworkId,
    baseUrl,
    serviceAuthReference,
  })),
  [
    {
      frameworkId: 'hermes-alica',
      baseUrl: 'https://alica:28082',
      serviceAuthReference: 'env:ALICA_FRAMEWORK_TOKEN',
    },
    {
      frameworkId: 'hermes-herman',
      baseUrl: 'https://herman:28082',
      serviceAuthReference: 'env:HERMAN_FRAMEWORK_TOKEN',
    },
  ],
);
const roleMigration = readFileSync(
  resolve(root, 'apps/gateway/migrations/007_framework_adapter_roles.up.sql'),
  'utf8',
);
const isolationMigration = readFileSync(
  resolve(root, 'apps/gateway/migrations/008_framework_adapter_isolation.up.sql'),
  'utf8',
);
for (const required of [
  'unify_hermes_adapter_runtime',
  'unify_alica_adapter',
  'unify_herman_adapter',
  'hermes_adapter_events',
  'hermes_adapter_idempotency',
  'hermes_adapter_audit',
])
  assert.ok(roleMigration.includes(required), `Role migration is missing ${required}`);
for (const required of [
  'ENABLE ROW LEVEL SECURITY',
  'hermes_adapter_events_tenant',
  'hermes_adapter_idempotency_tenant',
  'hermes_adapter_audit_tenant',
  'hermes_adapter_audit_immutable',
])
  assert.ok(isolationMigration.includes(required), `Isolation migration is missing ${required}`);
const backupScript = readFileSync(resolve(root, 'scripts/backup-gateway.sh'), 'utf8');
assert.ok(backupScript.includes('exec -T unify-postgres'));
assert.ok(backupScript.includes('deploy/five-service/compose.yaml'));

const caddyfile = readFileSync(resolve(root, 'deploy/five-service/Caddyfile'), 'utf8');
for (const required of [
  'http_port 8080',
  'https_port 8443',
  'reverse_proxy unify-core:8080',
  'Strict-Transport-Security',
  '/var/log/caddy/unify-access.log',
])
  assert.ok(caddyfile.includes(required), `Caddyfile is missing ${required}`);
assert.ok(!caddyfile.includes('docker.sock'));

console.log('Five-service Compose static and security contract: PASS');
