#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const image = process.env.HERMES_RUNTIME_IMAGE ?? 'unify/hermes-runtime:phase-14.1';
const expectedRelease = process.env.EXPECTED_HERMES_RELEASE ?? '0.20.0';
const expectedCommit =
  process.env.EXPECTED_HERMES_COMMIT ?? 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4';
const expectedBaseImage =
  process.env.EXPECTED_HERMES_BASE_IMAGE ??
  'nousresearch/hermes-agent@sha256:fcbe95482353e41cd30d39ddfc0f57ba3720f6da6969a7a69cdfb0d84b045cb6';
const adapterRelease = process.env.UNIFY_ADAPTER_RELEASE ?? 'phase-14.1';
const suffix = `${process.pid}-${Date.now()}`;
const network = `unify-hermes-runtime-test-${suffix}`;
const postgres = `unify-hermes-runtime-postgres-${suffix}`;
const runtime = `unify-hermes-runtime-${suffix}`;
const volume = `unify-hermes-runtime-data-${suffix}`;
const fixture = mkdtempSync(join(tmpdir(), 'unify-hermes-runtime-'));
const password = randomBytes(24).toString('base64url');
const apiToken = randomBytes(48).toString('base64url');
const adapterToken = randomBytes(48).toString('base64url');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})${detail ? `\n${detail}` : ''}`,
    );
  }
  return result.stdout?.trim() ?? '';
};

const docker = (args, options) => run('docker', args, options);
const inspectHealth = () =>
  docker([
    'inspect',
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
    runtime,
  ]);

const waitFor = async (description, predicate, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`,
  );
};

const cleanup = () => {
  spawnSync('docker', ['rm', '-f', '-v', runtime, postgres], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', '-f', volume], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
  rmSync(fixture, { recursive: true, force: true });
};

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

try {
  if (process.env.HERMES_RUNTIME_SKIP_BUILD !== '1')
    docker([
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '-f',
      'Dockerfile.hermes-runtime',
      '--build-arg',
      `UNIFY_ADAPTER_RELEASE=${adapterRelease}`,
      '-t',
      image,
      '.',
    ]);

  const labels = JSON.parse(
    docker(['image', 'inspect', image, '--format', '{{json .Config.Labels}}']),
  );
  assert.equal(labels['com.aquiero.image.role'], 'hermes-runtime-control-adapter');
  assert.equal(labels['com.aquiero.hermes.release'], expectedRelease);
  assert.equal(labels['com.aquiero.hermes.commit'], expectedCommit);
  assert.equal(labels['org.opencontainers.image.base.name'], expectedBaseImage);
  const imageConfig = JSON.parse(
    docker(['image', 'inspect', image, '--format', '{{json .Config}}']),
  );
  assert.deepEqual(Object.keys(imageConfig.ExposedPorts ?? {}), ['28082/tcp']);
  const configuredEnvironment = new Map(
    imageConfig.Env.map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  for (const secretName of ['API_SERVER_KEY', 'DATABASE_URL', 'HERMES_ADAPTER_TOKEN'])
    assert.equal(
      configuredEnvironment.has(secretName),
      false,
      `${secretName} leaked into image config`,
    );
  assert.equal(configuredEnvironment.get('HERMES_API_HOST'), '127.0.0.1');
  assert.equal(configuredEnvironment.get('HERMES_API_BASE_URL'), 'http://127.0.0.1:8642');

  writeFileSync(join(fixture, 'api-token'), `${apiToken}\n`);
  writeFileSync(
    join(fixture, 'adapter-token-bundle.json'),
    `${JSON.stringify({ active: { version: adapterRelease, token: adapterToken } })}\n`,
  );
  writeFileSync(
    join(fixture, 'cert-extensions.cnf'),
    'subjectAltName=DNS:hermes-runtime\nextendedKeyUsage=serverAuth\n',
  );
  run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=UNIFY Phase 14.1 Test CA',
      '-keyout',
      join(fixture, 'ca-key.pem'),
      '-out',
      join(fixture, 'ca.pem'),
    ],
    { stdio: 'ignore' },
  );
  run(
    'openssl',
    [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=hermes-runtime',
      '-keyout',
      join(fixture, 'tls-key.pem'),
      '-out',
      join(fixture, 'tls.csr'),
    ],
    { stdio: 'ignore' },
  );
  run(
    'openssl',
    [
      'x509',
      '-req',
      '-days',
      '1',
      '-in',
      join(fixture, 'tls.csr'),
      '-CA',
      join(fixture, 'ca.pem'),
      '-CAkey',
      join(fixture, 'ca-key.pem'),
      '-CAcreateserial',
      '-extfile',
      join(fixture, 'cert-extensions.cnf'),
      '-out',
      join(fixture, 'tls-cert.pem'),
    ],
    { stdio: 'ignore' },
  );

  docker(['network', 'create', network]);
  docker(['volume', 'create', volume]);
  docker([
    'run',
    '-d',
    '--name',
    postgres,
    '--network',
    network,
    '--network-alias',
    'postgres',
    '-e',
    'POSTGRES_DB=unify_fixture',
    '-e',
    'POSTGRES_USER=unify_fixture',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    'postgres:16.6-alpine',
  ]);
  await waitFor('fixture PostgreSQL', () => {
    const result = spawnSync('docker', [
      'exec',
      postgres,
      'psql',
      '-U',
      'unify_fixture',
      '-d',
      'unify_fixture',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'SELECT 1',
    ]);
    return result.status === 0;
  });
  const migration = readFileSync(
    join(root, 'apps/gateway/migrations/003_hermes_adapter_foundations.up.sql'),
  );
  docker(
    [
      'exec',
      '-i',
      postgres,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'unify_fixture',
      '-d',
      'unify_fixture',
    ],
    { input: migration },
  );

  writeFileSync(
    join(fixture, 'database-url'),
    `postgresql://unify_fixture:${encodeURIComponent(password)}@postgres:5432/unify_fixture\n`,
  );
  for (const name of [
    'api-token',
    'adapter-token-bundle.json',
    'database-url',
    'ca.pem',
    'tls-key.pem',
    'tls-cert.pem',
  ])
    chmodSync(join(fixture, name), 0o644);

  docker([
    'run',
    '-d',
    '--name',
    runtime,
    '--network',
    network,
    '--network-alias',
    'hermes-runtime',
    '-v',
    `${volume}:/opt/data`,
    '-v',
    `${join(fixture, 'api-token')}:/run/secrets/hermes-api-token:ro`,
    '-v',
    `${join(fixture, 'adapter-token-bundle.json')}:/run/secrets/adapter-token-bundle.json:ro`,
    '-v',
    `${join(fixture, 'database-url')}:/run/secrets/database-url:ro`,
    '-v',
    `${join(fixture, 'ca.pem')}:/run/secrets/adapter-ca.pem:ro`,
    '-v',
    `${join(fixture, 'tls-key.pem')}:/run/secrets/adapter-key.pem:ro`,
    '-v',
    `${join(fixture, 'tls-cert.pem')}:/run/secrets/adapter-cert.pem:ro`,
    '-v',
    `${join(root, 'deploy/hermes-runtime/acceptance-client.mjs')}:/run/acceptance-client.mjs:ro`,
    '-e',
    'DATABASE_URL_FILE=/run/secrets/database-url',
    '-e',
    'HERMES_ADAPTER_TOKEN_BUNDLE_FILE=/run/secrets/adapter-token-bundle.json',
    '-e',
    'HERMES_ADAPTER_TLS_KEY_FILE=/run/secrets/adapter-key.pem',
    '-e',
    'HERMES_ADAPTER_TLS_CERT_FILE=/run/secrets/adapter-cert.pem',
    '-e',
    'HERMES_ADAPTER_TLS_CA_FILE=/run/secrets/adapter-ca.pem',
    '-e',
    'HERMES_ADAPTER_TLS_SERVER_NAME=hermes-runtime',
    '-e',
    'HERMES_FRAMEWORK_ID=hermes-phase-14-1',
    '-e',
    'HERMES_DISPLAY_NAME=Phase 14.1 Fixture',
    '-e',
    'HERMES_INSTANCE_ID=phase-14-1-fixture',
    '-e',
    'HERMES_ADAPTER_SCOPES=control:read,control:execute,control:events',
    '-e',
    `RELEASE_ID=${adapterRelease}`,
    image,
  ]);

  await waitFor('combined runtime health', () => inspectHealth() === 'healthy', 180_000);
  docker(['exec', runtime, '/usr/local/bin/node', '/run/acceptance-client.mjs']);

  for (const service of ['unify-hermes-gateway', 'unify-control-adapter']) {
    const oldPid = docker([
      'exec',
      runtime,
      '/command/s6-svstat',
      '-o',
      'pid',
      `/run/service/${service}`,
    ]);
    docker(['exec', runtime, 'kill', '-TERM', oldPid]);
    await waitFor(`${service} crash recovery`, () => {
      const result = spawnSync(
        'docker',
        ['exec', runtime, '/command/s6-svstat', '-o', 'pid', `/run/service/${service}`],
        { encoding: 'utf8' },
      );
      return result.status === 0 && result.stdout.trim() !== oldPid;
    });
    await waitFor(`${service} recovered health`, () => inspectHealth() === 'healthy', 120_000);

    docker(['exec', runtime, '/command/s6-svc', '-d', `/run/service/${service}`]);
    await waitFor(
      `${service} failure to mark the container unhealthy`,
      () => inspectHealth() === 'unhealthy',
      60_000,
    );
    docker(['exec', runtime, '/command/s6-svc', '-u', `/run/service/${service}`]);
    await waitFor(`${service} health recovery`, () => inspectHealth() === 'healthy', 120_000);
  }

  const running = docker(['inspect', '--format', '{{.State.Running}}', runtime]);
  assert.equal(running, 'true');
  console.log('Hermes combined runtime container acceptance: PASS');
} catch (error) {
  try {
    const logs = docker(['logs', '--tail', '200', runtime]);
    if (logs) console.error(logs);
  } catch {
    // Log collection is best-effort; preserve the original acceptance failure.
  }
  throw error;
} finally {
  cleanup();
}
