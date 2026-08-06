#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const composeFile = resolve(root, 'deploy/five-service/compose.yaml');
const jobsFile = resolve(root, 'deploy/five-service/compose.jobs.yaml');
const fixture = mkdtempSync(join(tmpdir(), 'unify-five-service-'));
const secrets = join(fixture, 'secrets');
const alicaData = join(fixture, 'alica');
const hermanData = join(fixture, 'herman');
const suffix = `${process.pid}-${Date.now()}`;
const project = `unify-phase143-${suffix}`;
const postgresVolume = `${project}-postgres`;
const caddyDataVolume = `${project}-caddy-data`;
const caddyLogsVolume = `${project}-caddy-logs`;
const hermesImage = process.env.HERMES_RUNTIME_IMAGE ?? 'unify/hermes-runtime:phase-14.1';
const coreImage = process.env.UNIFY_CORE_IMAGE ?? 'unify-core:phase-14.3';
const postgresImage =
  'postgres:16.6-alpine@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef';
const caddyImage = process.env.CADDY_IMAGE ?? 'unify-caddy:phase-14.2';

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

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });

const [httpPort, httpsPort] = await Promise.all([freePort(), freePort()]);
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  RELEASE_ID: 'phase-14.3-fixture',
  HERMES_RUNTIME_IMAGE: hermesImage,
  UNIFY_CORE_IMAGE: coreImage,
  CADDY_IMAGE: caddyImage,
  UNIFY_PUBLIC_HOST: 'localhost',
  UNIFY_PUBLIC_ORIGIN: `https://localhost:${httpsPort}`,
  ALICA_DATA_PATH: alicaData,
  HERMAN_DATA_PATH: hermanData,
  SECRETS_DIR: secrets,
  UNIFY_POSTGRES_VOLUME: postgresVolume,
  CADDY_DATA_VOLUME: caddyDataVolume,
  CADDY_LOGS_VOLUME: caddyLogsVolume,
  CADDY_HTTP_PORT: String(httpPort),
  CADDY_HTTPS_PORT: String(httpsPort),
};

const compose = (args, options = {}) =>
  run('docker', ['compose', '-f', composeFile, ...args], { env: environment, ...options });
const composeJobs = (args, options = {}) =>
  run('docker', ['compose', '-f', composeFile, '-f', jobsFile, ...args], {
    env: environment,
    ...options,
  });

const waitFor = async (description, predicate, timeoutMs = 180_000) => {
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
  spawnSync(
    'docker',
    ['compose', '-f', composeFile, '-f', jobsFile, 'down', '--volumes', '--remove-orphans'],
    { cwd: root, env: environment, stdio: 'ignore' },
  );
  for (const volume of [postgresVolume, caddyDataVolume, caddyLogsVolume])
    spawnSync('docker', ['volume', 'rm', '-f', volume], { stdio: 'ignore' });
  spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      '0:0',
      '-v',
      `${fixture}:/fixture`,
      '--entrypoint',
      '/bin/sh',
      postgresImage,
      '-c',
      'chmod -R a+rwx /fixture 2>/dev/null || true',
    ],
    { stdio: 'ignore' },
  );
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
  mkdirSync(secrets, { recursive: true });
  mkdirSync(alicaData, { recursive: true });
  mkdirSync(hermanData, { recursive: true });
  chmodSync(alicaData, 0o777);
  chmodSync(hermanData, 0o777);

  if (process.env.FIVE_SERVICE_SKIP_CORE_BUILD !== '1')
    docker([
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '-f',
      'Dockerfile.gateway',
      '-t',
      coreImage,
      '.',
    ]);
  if (process.env.FIVE_SERVICE_SKIP_CADDY_BUILD !== '1')
    docker([
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '-f',
      'Dockerfile.caddy-proxy',
      '-t',
      caddyImage,
      '.',
    ]);
  docker(['image', 'inspect', hermesImage]);
  docker(['image', 'inspect', coreImage]);
  docker(['image', 'inspect', caddyImage]);

  const password = randomBytes(24).toString('base64url');
  const authPepper = randomBytes(48).toString('base64url');
  const bootstrapPassword = `P14!${randomBytes(30).toString('base64url')}`;
  const alicaApiToken = randomBytes(48).toString('base64url');
  const hermanApiToken = randomBytes(48).toString('base64url');
  const alicaToken = randomBytes(48).toString('base64url');
  const hermanToken = randomBytes(48).toString('base64url');
  const alicaDatabasePassword = randomBytes(32).toString('base64url');
  const hermanDatabasePassword = randomBytes(32).toString('base64url');
  const databaseUrl = `postgresql://unify:${encodeURIComponent(password)}@unify-postgres:5432/unify`;
  const alicaDatabaseUrl = `postgresql://unify_alica_adapter:${encodeURIComponent(alicaDatabasePassword)}@unify-postgres:5432/unify`;
  const hermanDatabaseUrl = `postgresql://unify_herman_adapter:${encodeURIComponent(hermanDatabasePassword)}@unify-postgres:5432/unify`;
  const values = {
    'postgres-password': password,
    'database-url': databaseUrl,
    'alica-database-url': alicaDatabaseUrl,
    'herman-database-url': hermanDatabaseUrl,
    'auth-pepper': authPepper,
    'bootstrap-admin-password': bootstrapPassword,
    'alica-token': alicaToken,
    'herman-token': hermanToken,
    'alica-api-token': alicaApiToken,
    'herman-api-token': hermanApiToken,
    'alica-token-bundle.json': JSON.stringify({
      active: { version: 'phase-14.3', token: alicaToken },
    }),
    'herman-token-bundle.json': JSON.stringify({
      active: { version: 'phase-14.3', token: hermanToken },
    }),
  };
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(join(secrets, name), `${value}\n`);
    chmodSync(join(secrets, name), 0o644);
  }

  writeFileSync(
    join(fixture, 'cert-extensions.cnf'),
    'subjectAltName=DNS:alica,DNS:herman\nextendedKeyUsage=serverAuth\n',
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
      '/CN=UNIFY Phase 14.2 Test CA',
      '-keyout',
      join(fixture, 'ca-key.pem'),
      '-out',
      join(secrets, 'framework-ca.crt'),
    ],
    { stdio: 'ignore' },
  );
  for (const framework of ['alica', 'herman']) {
    run(
      'openssl',
      [
        'req',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        `/CN=${framework}`,
        '-keyout',
        join(secrets, `${framework}.key`),
        '-out',
        join(fixture, `${framework}.csr`),
      ],
      { stdio: 'ignore' },
    );
    writeFileSync(
      join(fixture, `${framework}-extensions.cnf`),
      `subjectAltName=DNS:${framework}\nextendedKeyUsage=serverAuth\n`,
    );
    run(
      'openssl',
      [
        'x509',
        '-req',
        '-days',
        '1',
        '-in',
        join(fixture, `${framework}.csr`),
        '-CA',
        join(secrets, 'framework-ca.crt'),
        '-CAkey',
        join(fixture, 'ca-key.pem'),
        '-CAcreateserial',
        '-extfile',
        join(fixture, `${framework}-extensions.cnf`),
        '-out',
        join(secrets, `${framework}.crt`),
      ],
      { stdio: 'ignore' },
    );
  }
  for (const name of ['framework-ca.crt', 'alica.key', 'alica.crt', 'herman.key', 'herman.crt'])
    chmodSync(join(secrets, name), 0o644);

  for (const volume of [postgresVolume, caddyDataVolume, caddyLogsVolume])
    docker(['volume', 'create', volume]);
  docker([
    'run',
    '--rm',
    '--user',
    '0:0',
    '-v',
    `${postgresVolume}:/target`,
    '--entrypoint',
    '/bin/sh',
    postgresImage,
    '-c',
    'chown 70:70 /target && chmod 0700 /target',
  ]);
  for (const volume of [caddyDataVolume, caddyLogsVolume])
    docker([
      'run',
      '--rm',
      '--user',
      '0:0',
      '-v',
      `${volume}:/target`,
      '--entrypoint',
      '/bin/sh',
      caddyImage,
      '-c',
      'chown 10000:10000 /target && chmod 0750 /target',
    ]);

  compose(['config', '--quiet']);
  compose(['up', '-d', '--wait', 'unify-postgres']);
  composeJobs(['run', '--rm', '--no-deps', 'migrate']);
  const firstRoleReconciliation = JSON.parse(
    composeJobs(['run', '--rm', '--no-deps', 'reconcile-database-roles']),
  );
  assert.equal(firstRoleReconciliation.changed, 2);
  const roleVerifiersBefore = docker([
    'exec',
    `${project}-unify-postgres-1`,
    'psql',
    '-U',
    'unify',
    '-d',
    'unify',
    '-At',
    '-c',
    "SELECT rolname||'|'||rolpassword FROM pg_authid WHERE rolname IN ('unify_alica_adapter','unify_herman_adapter') ORDER BY rolname",
  ]);
  const secondRoleReconciliation = JSON.parse(
    composeJobs(['run', '--rm', '--no-deps', 'reconcile-database-roles']),
  );
  assert.equal(secondRoleReconciliation.changed, 0);
  assert.equal(
    docker([
      'exec',
      `${project}-unify-postgres-1`,
      'psql',
      '-U',
      'unify',
      '-d',
      'unify',
      '-At',
      '-c',
      "SELECT rolname||'|'||rolpassword FROM pg_authid WHERE rolname IN ('unify_alica_adapter','unify_herman_adapter') ORDER BY rolname",
    ]),
    roleVerifiersBefore,
  );
  composeJobs(['run', '--rm', '--no-deps', 'bootstrap-admin']);
  compose(['up', '-d', '--wait']);
  const firstFrameworkReconciliation = JSON.parse(
    composeJobs(['run', '--rm', '--no-deps', 'reconcile-frameworks']),
  );
  assert.equal(firstFrameworkReconciliation.changed, 2);
  const registrationsBefore = docker([
    'exec',
    `${project}-unify-postgres-1`,
    'psql',
    '-U',
    'unify',
    '-d',
    'unify',
    '-At',
    '-c',
    "SELECT id||'|'||created_at||'|'||updated_at||'|'||verified_at FROM framework_registrations ORDER BY id",
  ]);
  const auditsBefore = docker([
    'exec',
    `${project}-unify-postgres-1`,
    'psql',
    '-U',
    'unify',
    '-d',
    'unify',
    '-At',
    '-c',
    "SELECT count(*) FROM audit_events WHERE event_type='framework.reconcile'",
  ]);
  assert.equal(auditsBefore, '2');
  const secondFrameworkReconciliation = JSON.parse(
    composeJobs(['run', '--rm', '--no-deps', 'reconcile-frameworks']),
  );
  assert.equal(secondFrameworkReconciliation.changed, 0);
  const registrationsAfter = docker([
    'exec',
    `${project}-unify-postgres-1`,
    'psql',
    '-U',
    'unify',
    '-d',
    'unify',
    '-At',
    '-c',
    "SELECT id||'|'||created_at||'|'||updated_at||'|'||verified_at FROM framework_registrations ORDER BY id",
  ]);
  assert.equal(registrationsAfter, registrationsBefore);
  const auditsAfter = docker([
    'exec',
    `${project}-unify-postgres-1`,
    'psql',
    '-U',
    'unify',
    '-d',
    'unify',
    '-At',
    '-c',
    "SELECT count(*) FROM audit_events WHERE event_type='framework.reconcile'",
  ]);
  assert.equal(auditsAfter, auditsBefore);

  const projectContainers = () =>
    docker([
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.ID}}',
    ])
      .split('\n')
      .filter(Boolean);
  assert.equal(projectContainers().length, 5, 'The project must contain exactly five containers');
  assert.deepEqual(compose(['ps', '--services', '--status', 'running']).split('\n').sort(), [
    'alica',
    'caddy',
    'herman',
    'unify-core',
    'unify-postgres',
  ]);

  const ids = compose(['ps', '-q']).split('\n').filter(Boolean);
  assert.equal(ids.length, 5);
  for (const id of ids) {
    const inspection = JSON.parse(docker(['inspect', id]))[0];
    assert.equal(inspection.State.Running, true);
    assert.equal(inspection.State.Health.Status, 'healthy');
    assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
    assert.ok(inspection.HostConfig.CapDrop.includes('ALL'));
    assert.ok(inspection.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    assert.ok(inspection.HostConfig.PidsLimit > 0);
    assert.ok(inspection.HostConfig.Memory > 0);
    assert.ok(inspection.HostConfig.NanoCpus > 0);
    const service = inspection.Config.Labels['com.docker.compose.service'];
    const bindings = inspection.HostConfig.PortBindings ?? {};
    if (service === 'caddy') {
      assert.deepEqual(Object.keys(bindings).sort(), ['8080/tcp', '8443/tcp']);
    } else {
      assert.deepEqual(Object.keys(bindings), [], `${service} unexpectedly publishes a host port`);
    }
  }

  const probe = String.raw`
const fs=require('node:fs');
(async()=>{
 for (const [host,file,id] of [['alica','alica-token','hermes-alica'],['herman','herman-token','hermes-herman']]) {
  const token=fs.readFileSync('/run/secrets/'+file,'utf8').trim();
  const r=await fetch('https://'+host+':28082/control/v1/identity',{headers:{authorization:'Bearer '+token}});
  if(!r.ok) throw new Error(host+' HTTP '+r.status);
  const body=await r.json();
  if(body.frameworkId!==id) throw new Error(host+' identity mismatch');
 }
})().catch(e=>{console.error(e);process.exit(1)});`;
  compose(['exec', '-T', 'unify-core', '/nodejs/bin/node', '-e', probe]);

  const headers = run('curl', [
    '--fail-with-body',
    '--silent',
    '--show-error',
    '--insecure',
    '--dump-header',
    '-',
    '--output',
    '/dev/null',
    `https://localhost:${httpsPort}/healthz`,
  ]);
  assert.match(headers, /^HTTP\/2 200/mu);
  assert.match(headers, /strict-transport-security: max-age=31536000; includeSubDomains/iu);

  compose(['restart']);
  await waitFor('all five services after deterministic restart', () => {
    const running = compose(['ps', '--services', '--status', 'running'])
      .split('\n')
      .filter(Boolean);
    if (running.length !== 5) return false;
    return compose(['ps', '--format', 'json'])
      .split('\n')
      .filter(Boolean)
      .every((line) => JSON.parse(line).Health === 'healthy');
  });
  assert.equal(projectContainers().length, 5);
  assert.equal(
    JSON.parse(composeJobs(['run', '--rm', '--no-deps', 'reconcile-database-roles'])).changed,
    0,
  );
  assert.equal(
    JSON.parse(composeJobs(['run', '--rm', '--no-deps', 'reconcile-frameworks'])).changed,
    0,
  );
  assert.equal(
    docker([
      'exec',
      `${project}-unify-postgres-1`,
      'psql',
      '-U',
      'unify',
      '-d',
      'unify',
      '-At',
      '-c',
      "SELECT rolname||'|'||rolpassword FROM pg_authid WHERE rolname IN ('unify_alica_adapter','unify_herman_adapter') ORDER BY rolname",
    ]),
    roleVerifiersBefore,
  );
  assert.equal(projectContainers().length, 5);

  console.log(
    `Five-service Compose clean-fixture acceptance: PASS project=${project} containers=5 ports=${httpPort},${httpsPort}`,
  );
} catch (error) {
  try {
    const logs = compose(['logs', '--no-color', '--tail', '100']);
    if (logs) console.error(logs);
  } catch {
    // Log collection is best-effort; preserve the original acceptance failure.
  }
  throw error;
} finally {
  cleanup();
}
