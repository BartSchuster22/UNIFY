#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
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

const publicRequest = (method, path, { body, cookie, csrf, headers = {} } = {}) =>
  new Promise((resolveRequest, rejectRequest) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const connection = request(
      {
        hostname: 'localhost',
        port: httpsPort,
        path,
        method,
        rejectUnauthorized: false,
        timeout: 15_000,
        headers: {
          accept: 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': String(payload.length) }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolveRequest({ status: response.statusCode, headers: response.headers, body: parsed });
        });
      },
    );
    connection.once('timeout', () => connection.destroy(new Error(`${method} ${path} timed out`)));
    connection.once('error', rejectRequest);
    if (payload) connection.write(payload);
    connection.end();
  });

const rolePsql = (role, password, sql, expectedStatus = 0) => {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      `${project}-unify-postgres-1`,
      '/bin/sh',
      '-ceu',
      `IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -h 127.0.0.1 -U ${role} -d unify -At -v ON_ERROR_STOP=1 -c "$1"`,
      'phase-14.5-psql',
      sql,
    ],
    { cwd: root, encoding: 'utf8', input: `${password}\n`, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(
    result.status,
    expectedStatus,
    `Role-scoped SQL for ${role} returned ${result.status}: ${result.stderr?.trim() ?? ''}`,
  );
  return result.stdout?.trim() ?? '';
};

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
  const backupEncryptionKey = randomBytes(48).toString('base64url');
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
    'backup-encryption-key': backupEncryptionKey,
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
  chmodSync(join(secrets, 'backup-encryption-key'), 0o600);

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
        `/CN=${framework}-adapter`,
        '-keyout',
        join(secrets, `${framework}.key`),
        '-out',
        join(fixture, `${framework}.csr`),
      ],
      { stdio: 'ignore' },
    );
    writeFileSync(
      join(fixture, `${framework}-extensions.cnf`),
      `subjectAltName=DNS:${framework}-adapter\nextendedKeyUsage=serverAuth\n`,
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
 for (const [host,file,id] of [['alica-adapter','alica-token','hermes-alica'],['herman-adapter','herman-token','hermes-herman']]) {
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

  const readiness = await publicRequest('GET', '/api/v1/health/ready');
  assert.equal(readiness.status, 200);
  const login = await publicRequest('POST', '/api/v1/auth/login', {
    body: { username: 'herman', password: bootstrapPassword, deviceLabel: 'phase-14.5-live' },
  });
  assert.equal(login.status, 200);
  const setCookies = Array.isArray(login.headers['set-cookie'])
    ? login.headers['set-cookie']
    : [login.headers['set-cookie']].filter(Boolean);
  const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ');
  const csrf = login.headers['x-csrf-token'];
  assert.ok(cookie.includes('aquiero_session='));
  assert.equal(typeof csrf, 'string');
  assert.equal((await publicRequest('GET', '/api/v1/auth/me', { cookie })).status, 200);
  const frameworkList = await publicRequest('GET', '/api/v1/frameworks', { cookie });
  assert.equal(frameworkList.status, 200);
  assert.deepEqual(frameworkList.body.items.map((item) => item.frameworkId).sort(), [
    'hermes-alica',
    'hermes-herman',
  ]);

  const mutation = (body, idempotencyKey) =>
    publicRequest('POST', '/api/v1/mutations', {
      body,
      cookie,
      csrf,
      headers: { 'idempotency-key': idempotencyKey },
    });
  const workProjectIds = {};
  const workProjectNames = {};
  for (const frameworkId of ['hermes-alica', 'hermes-herman']) {
    const projectId = `phase-14-5-${frameworkId}`;
    const projectName = `Phase 14.5 ${frameworkId}`;
    workProjectIds[frameworkId] = projectId;
    workProjectNames[frameworkId] = projectName;
    const body = {
      operationType: 'work.project.create',
      target: { owner: 'hermes', kind: 'project', nativeId: projectId, frameworkId },
      payload: { name: projectName },
      mode: 'execute',
      confirmed: false,
    };
    const firstMutation = await mutation(body, `phase-14-5-work-${frameworkId}`);
    assert.equal(firstMutation.status, 201);
    assert.equal(firstMutation.body.replayed, false);
    const replay = await mutation(body, `phase-14-5-work-${frameworkId}`);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.operation.id, firstMutation.body.operation.id);
  }

  const concurrentProjectId = 'phase-14-5-concurrent-project';
  const concurrentBody = {
    operationType: 'work.project.create',
    target: {
      owner: 'hermes',
      kind: 'project',
      nativeId: concurrentProjectId,
      frameworkId: 'hermes-alica',
    },
    payload: { name: 'Phase 14.5 concurrent idempotency' },
    mode: 'execute',
    confirmed: false,
  };
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () => mutation(concurrentBody, 'phase-14-5-concurrent-key')),
  );
  assert.equal(concurrent.filter((response) => response.status === 201).length, 1);
  assert.equal(concurrent.filter((response) => response.status === 200).length, 7);
  assert.equal(new Set(concurrent.map((response) => response.body.operation.id)).size, 1);

  for (const frameworkId of ['hermes-alica', 'hermes-herman']) {
    const projects = await publicRequest(
      'GET',
      `/api/v1/frameworks/${frameworkId}/work/projects?limit=500`,
      { cookie },
    );
    assert.equal(projects.status, 200);
    const names = projects.body.items.map((item) => item.name);
    assert.ok(
      names.includes(workProjectNames[frameworkId]),
      `${frameworkId} work projection mismatch: ${JSON.stringify(projects.body.items)}`,
    );
    const other = frameworkId === 'hermes-alica' ? 'hermes-herman' : 'hermes-alica';
    assert.ok(!names.includes(workProjectNames[other]), `${frameworkId} leaked ${other} work data`);
  }

  const conversationTitles = {};
  for (const frameworkId of ['hermes-alica', 'hermes-herman']) {
    const targetId = `phase-14-5-session-${frameworkId}`;
    const title = `Phase 14.5 conversation ${frameworkId}`;
    conversationTitles[frameworkId] = title;
    const created = await mutation(
      {
        operationType: 'conversation.session.create',
        target: { owner: 'hermes', kind: 'session', nativeId: targetId, frameworkId },
        payload: { title },
        mode: 'execute',
        confirmed: false,
      },
      `phase-14-5-session-${frameworkId}`,
    );
    assert.equal(created.status, 201);
    const sessions = await publicRequest(
      'GET',
      `/api/v1/frameworks/${frameworkId}/conversations/sessions?limit=500`,
      { cookie },
    );
    assert.equal(sessions.status, 200);
    const session = sessions.body.items.find((item) => item.title === title);
    assert.ok(session, `${frameworkId} did not return its created conversation`);
    const sent = await mutation(
      {
        operationType: 'conversation.message.send',
        target: { owner: 'hermes', kind: 'session', nativeId: session.id, frameworkId },
        payload: { message: `Phase 14.5 message for ${frameworkId}` },
        mode: 'execute',
        confirmed: false,
      },
      `phase-14-5-message-${frameworkId}`,
    );
    assert.equal(sent.status, 201);
    assert.equal(sent.body.operation.state, 'verified');
    assert.equal(typeof sent.body.result.data.result.message.content, 'string');
    const messages = await publicRequest(
      'GET',
      `/api/v1/frameworks/${frameworkId}/conversations/sessions/${encodeURIComponent(session.id)}/messages?limit=500`,
      { cookie },
    );
    assert.equal(messages.status, 200);
    const otherFramework = frameworkId === 'hermes-alica' ? 'hermes-herman' : 'hermes-alica';
    assert.ok(
      messages.body.items.every((item) => !JSON.stringify(item).includes(otherFramework)),
      `${frameworkId} leaked ${otherFramework} conversation data`,
    );
  }

  const tenantHashes = {
    alica: randomBytes(32).toString('hex'),
    herman: randomBytes(32).toString('hex'),
  };
  rolePsql(
    'unify_alica_adapter',
    alicaDatabasePassword,
    `INSERT INTO hermes_adapter_audit(framework_id,event_type,outcome,request_id,correlation_id,event_hash) VALUES('hermes-alica','phase14.5','success','alica-request','alica-correlation','${tenantHashes.alica}')`,
  );
  rolePsql(
    'unify_herman_adapter',
    hermanDatabasePassword,
    `INSERT INTO hermes_adapter_audit(framework_id,event_type,outcome,request_id,correlation_id,event_hash) VALUES('hermes-herman','phase14.5','success','herman-request','herman-correlation','${tenantHashes.herman}')`,
  );
  assert.equal(
    rolePsql(
      'unify_alica_adapter',
      alicaDatabasePassword,
      "SELECT string_agg(DISTINCT framework_id,',') FROM hermes_adapter_audit",
    ),
    'hermes-alica',
  );
  assert.equal(
    rolePsql(
      'unify_herman_adapter',
      hermanDatabasePassword,
      "SELECT string_agg(DISTINCT framework_id,',') FROM hermes_adapter_audit",
    ),
    'hermes-herman',
  );
  rolePsql(
    'unify_alica_adapter',
    alicaDatabasePassword,
    `INSERT INTO hermes_adapter_audit(framework_id,event_type,outcome,request_id,correlation_id,event_hash) VALUES('hermes-herman','phase14.5','failure','cross-request','cross-correlation','${randomBytes(32).toString('hex')}')`,
    1,
  );
  rolePsql(
    'unify_alica_adapter',
    alicaDatabasePassword,
    "UPDATE hermes_adapter_audit SET outcome='failure' WHERE framework_id='hermes-alica'",
    1,
  );

  const negativeNetworkProbe = String.raw`
const fs=require('node:fs'),https=require('node:https'),net=require('node:net');
const ca=fs.readFileSync('/run/secrets/framework-ca-cert');
const token=fs.readFileSync('/run/secrets/alica-token','utf8').trim();
const call=(authorization,servername='alica-adapter')=>new Promise((resolve,reject)=>{
 const q=https.request({host:'alica-adapter',port:28082,path:'/control/v1/identity',ca,servername,headers:{authorization}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode))});
 q.on('error',reject);q.end();
});
(async()=>{
 if(await call('Bearer wrong')!==401) throw new Error('wrong token was not rejected');
 let tlsRejected=false;try{await call('Bearer '+token,'herman-adapter')}catch{tlsRejected=true}
 if(!tlsRejected) throw new Error('wrong TLS server name was accepted');
 await new Promise((resolve,reject)=>{const s=net.connect(8642,'alica');s.once('connect',()=>reject(new Error('native API escaped loopback')));s.once('error',()=>resolve());setTimeout(()=>{s.destroy();resolve()},3000)});
})().catch(e=>{console.error(e);process.exit(1)});`;
  compose(['exec', '-T', 'unify-core', '/nodejs/bin/node', '-e', negativeNetworkProbe]);
  const crossNetworkProbe = String.raw`
const net=require('node:net');
const s=net.connect(28082,'herman');
s.once('connect',()=>{console.error('cross-framework network reachable');process.exit(1)});
s.once('error',()=>process.exit(0));
setTimeout(()=>{s.destroy();process.exit(0)},3000);`;
  compose(['exec', '-T', 'alica', '/usr/local/bin/node', '-e', crossNetworkProbe]);

  compose(['exec', '-T', 'unify-core', '/nodejs/bin/node', 'dist/cli/verify-audit.js']);
  const backupPath = join(fixture, 'backups', 'phase-14-5.tar.enc');
  run('bash', ['scripts/backup-gateway.sh'], {
    env: {
      ...environment,
      UNIFY_COMPOSE_FILE: composeFile,
      UNIFY_COMPOSE_PROJECT: project,
      BACKUP_ENCRYPTION_KEY_FILE: join(secrets, 'backup-encryption-key'),
      BACKUP_FILE: backupPath,
      UNIFY_GIT_COMMIT: 'phase-14.5-live-fixture',
    },
  });
  run('bash', ['scripts/rehearse-restore.sh', backupPath], {
    env: {
      ...environment,
      BACKUP_ENCRYPTION_KEY_FILE: join(secrets, 'backup-encryption-key'),
      UNIFY_AUDIT_IMAGE: coreImage,
    },
  });

  const frameworkHealth = (frameworkId) =>
    publicRequest('GET', `/api/v1/frameworks/${frameworkId}/health`, { cookie });
  const rotatingTokens = {
    'hermes-alica': randomBytes(48).toString('base64url'),
    'hermes-herman': randomBytes(48).toString('base64url'),
  };
  for (const [frameworkId, newToken] of Object.entries(rotatingTokens)) {
    const short = frameworkId.slice('hermes-'.length);
    const oldToken = short === 'alica' ? alicaToken : hermanToken;
    writeFileSync(
      join(secrets, `${short}-token-bundle.json`),
      `${JSON.stringify({
        active: { version: 'phase-14.5', token: newToken },
        retiring: {
          version: 'phase-14.3',
          token: oldToken,
          notAfter: new Date(Date.now() + 60_000).toISOString(),
        },
      })}\n`,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
    assert.equal((await frameworkHealth(frameworkId)).status, 200);
    writeFileSync(join(secrets, `${short}-token`), `${newToken}\n`);
    writeFileSync(
      join(secrets, `${short}-token-bundle.json`),
      `${JSON.stringify({ active: { version: 'phase-14.5', token: newToken } })}\n`,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
    assert.notEqual((await frameworkHealth(frameworkId)).status, 200);
    compose(['restart', 'unify-core']);
    await waitFor(
      `${frameworkId} after token cutover`,
      async () => (await frameworkHealth(frameworkId)).status === 200,
    );
  }

  for (const framework of ['alica', 'herman']) {
    for (const service of ['unify-hermes-gateway', 'unify-control-adapter']) {
      const oldPid = compose([
        'exec',
        '-T',
        framework,
        '/command/s6-svstat',
        '-o',
        'pid',
        `/run/service/${service}`,
      ]);
      compose(['exec', '-T', '--user', '10000:10000', framework, 'kill', '-TERM', oldPid]);
      await waitFor(`${framework}/${service} child recovery`, () => {
        const result = spawnSync(
          'docker',
          [
            'compose',
            '-f',
            composeFile,
            'exec',
            '-T',
            framework,
            '/command/s6-svstat',
            '-o',
            'pid',
            `/run/service/${service}`,
          ],
          { cwd: root, env: environment, encoding: 'utf8' },
        );
        return result.status === 0 && result.stdout.trim() !== oldPid;
      });
      await waitFor(`${framework}/${service} healthy`, () =>
        compose(['ps', '--format', 'json'])
          .split('\n')
          .filter(Boolean)
          .some((line) => {
            const state = JSON.parse(line);
            return state.Service === framework && state.Health === 'healthy';
          }),
      );
    }
  }

  const caddyCertificateState = () =>
    compose([
      'exec',
      '-T',
      'caddy',
      '/bin/sh',
      '-c',
      "find /data -type f \\( -name '*.crt' -o -name '*.key' \\) -exec sha256sum '{}' ';' | sort",
    ]);
  const certificateStateBefore = caddyCertificateState();
  assert.notEqual(certificateStateBefore, '');

  const allHealthy = () => {
    const states = compose(['ps', '--format', 'json'])
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return (
      states.length === 5 &&
      states.every((state) => state.State === 'running' && state.Health === 'healthy')
    );
  };
  for (const service of ['alica', 'herman', 'unify-core', 'unify-postgres', 'caddy']) {
    compose(['restart', service]);
    await waitFor(`${service} individual restart`, allHealthy);
  }
  assert.equal(caddyCertificateState(), certificateStateBefore);

  compose(['stop']);
  assert.equal(compose(['ps', '--services', '--status', 'running']), '');
  compose(['start']);
  await waitFor('host-service-equivalent stop/start recovery', allHealthy);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    compose(['restart']);
    await waitFor(`all five services restart loop ${iteration + 1}`, allHealthy);
  }
  assert.equal((await frameworkHealth('hermes-alica')).status, 200);
  assert.equal((await frameworkHealth('hermes-herman')).status, 200);
  assert.equal(caddyCertificateState(), certificateStateBefore);
  for (const frameworkId of ['hermes-alica', 'hermes-herman']) {
    const projects = await publicRequest(
      'GET',
      `/api/v1/frameworks/${frameworkId}/work/projects?limit=500`,
      { cookie },
    );
    assert.equal(projects.status, 200);
    assert.ok(projects.body.items.some((item) => item.name === workProjectNames[frameworkId]));
    const sessions = await publicRequest(
      'GET',
      `/api/v1/frameworks/${frameworkId}/conversations/sessions?limit=500`,
      { cookie },
    );
    assert.equal(sessions.status, 200);
    assert.ok(sessions.body.items.some((item) => item.title === conversationTitles[frameworkId]));
  }
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
  assert.equal((await publicRequest('POST', '/api/v1/auth/logout', { cookie })).status, 403);
  assert.equal((await publicRequest('POST', '/api/v1/auth/logout', { cookie, csrf })).status, 204);
  assert.equal((await publicRequest('GET', '/api/v1/auth/me', { cookie })).status, 401);

  console.log(
    `Phase 14.5 five-service live acceptance: PASS project=${project} containers=5 ports=${httpPort},${httpsPort}`,
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
  if (process.env.UNIFY_P145_KEEP_FAILED === '1')
    console.error(`Preserved Phase 14.5 fixture: ${fixture} project=${project}`);
  else cleanup();
}
