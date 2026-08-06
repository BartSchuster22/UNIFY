#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import { arch, platform, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  composeEnvironment,
  validateInstallationInput,
} from '../../scripts/lib/five-service-installation.mjs';

const sourceRoot = resolve(import.meta.dirname, '../..');
const options = parseArguments(process.argv.slice(2));
const acceptance = options.acceptance && process.env.UNIFY_INSTALLER_ACCEPTANCE === '1';
if (options.acceptance && !acceptance)
  throw new Error('The acceptance bypass requires UNIFY_INSTALLER_ACCEPTANCE=1');
const dockerBin = acceptance ? (process.env.UNIFY_INSTALLER_DOCKER_BIN ?? 'docker') : 'docker';
const acceptanceImageMap = readAcceptanceImageMap();
const root = resolve(options.root);
const stateFile = join(root, 'installer-state.json');
const ownershipFile = join(root, 'installer-owned.json');
const lockFile = join(root, '.installer.lock');
const project = options.project;
let lockDescriptor;
let activeInput;
let recoveryRelease;

try {
  preflightHost();
  prepareManagedRoot();
  lockDescriptor = acquireLock();
  writeFileSync(lockDescriptor, `${process.pid}\n`);
  const state = readState();
  await executeMode(state);
} catch (error) {
  if (recoveryRelease) {
    try {
      recoverRelease(recoveryRelease);
      recordFailure(error);
    } catch (recoveryError) {
      console.error(`UNIFY installer recovery failed: ${safeMessage(recoveryError)}`);
    }
  }
  fail(safeMessage(error));
} finally {
  if (lockDescriptor !== undefined) {
    closeSync(lockDescriptor);
    if (existsSync(lockFile)) unlinkSync(lockFile);
  }
}

async function executeMode(state) {
  if (options.mode === 'verify') {
    requireState(state);
    const release = readAcceptedRelease(state.currentRelease, state.manifestSha256);
    activeInput = release.input;
    verifyDeployment(release);
    console.log(JSON.stringify(result('verify', state.currentRelease, false)));
    return;
  }
  if (options.mode === 'rollback') {
    requireState(state);
    const target = options.target ?? state.previousRelease;
    if (!target || target === state.currentRelease)
      throw new Error('No distinct rollback release is available');
    const release = readAcceptedRelease(target);
    activeInput = release.input;
    recoveryRelease = readAcceptedRelease(state.currentRelease, state.manifestSha256);
    createBackup(recoveryRelease, 'pre-rollback');
    activateRelease(release, { runMigrations: false });
    writeCurrentLinks(target, state.currentRelease);
    const targetManifest = join(root, 'manifests', `${target}.json`);
    writeState({
      ...state,
      currentRelease: target,
      previousRelease: state.currentRelease,
      manifestSha256: sha256(targetManifest),
      updatedAt: new Date().toISOString(),
    });
    configureBackupSchedule(release);
    writeOperationManifest('rollback', state.currentRelease, target);
    recoveryRelease = undefined;
    console.log(JSON.stringify(result('rollback', target, true)));
    return;
  }

  if (!options.input) throw new Error(`${options.mode} requires --input`);
  const input = validateInstallationInput(JSON.parse(readFileSync(resolve(options.input), 'utf8')));
  activeInput = input;
  preflightDeployment(input, state);
  if (!state && options.mode === 'upgrade')
    throw new Error('upgrade requires an existing managed installation');
  if (state && options.mode === 'install' && state.currentRelease !== input.releaseId)
    throw new Error('A different release is installed; use upgrade explicitly');
  if (state && options.mode === 'upgrade' && state.currentRelease === input.releaseId) {
    const current = readAcceptedRelease(state.currentRelease, state.manifestSha256);
    assertInputMatches(current.input, input);
    verifyDeployment(current);
    console.log(JSON.stringify(result('upgrade', input.releaseId, false)));
    return;
  }
  if (state && options.mode === 'install') {
    const current = readAcceptedRelease(state.currentRelease, state.manifestSha256);
    assertInputMatches(current.input, input);
    verifyDeployment(current);
    console.log(JSON.stringify(result('install', input.releaseId, false)));
    return;
  }
  if (state && !options.migrationMode)
    assertStableInstallationIdentity(
      readAcceptedRelease(state.currentRelease, state.manifestSha256).input,
      input,
    );

  const release = stageRelease(input);
  prepareDirectories(input);
  prepareSecrets(input);
  verifyImages(input);
  renderCompose(release);
  ensureVolumes(input);
  injectFailure('prepared');

  if (state) {
    recoveryRelease = readAcceptedRelease(state.currentRelease, state.manifestSha256);
    createBackup(recoveryRelease, 'pre-upgrade');
  }
  activateRelease(release, { runMigrations: true });
  injectFailure('started');
  const backup = createBackup(release, state ? 'post-upgrade' : 'post-install');
  const manifest = writeReleaseManifest(release, state?.currentRelease ?? null, backup);
  writeCurrentLinks(input.releaseId, state?.currentRelease ?? null);
  writeState({
    schemaVersion: 'unify-installer-state/v1',
    installationId: state?.installationId ?? randomUUID(),
    project,
    currentRelease: input.releaseId,
    previousRelease: state?.currentRelease ?? null,
    manifestSha256: manifest.sha256,
    updatedAt: new Date().toISOString(),
  });
  configureBackupSchedule(release);
  recoveryRelease = undefined;
  console.log(JSON.stringify(result(options.mode, input.releaseId, true)));
}

function preflightHost() {
  for (const command of ['curl', 'openssl', 'tar']) requireCommand(command);
  requireCommand(dockerBin);
  if (acceptance) return;
  if (platform() !== 'linux') throw new Error('Only Linux is supported');
  if (process.getuid?.() !== 0) throw new Error('Production installation must run as root');
  if (!['x64', 'arm64'].includes(arch()))
    throw new Error(`Unsupported CPU architecture: ${arch()}`);
  const osRelease = readKeyValue('/etc/os-release');
  if (!['ubuntu', 'debian'].includes(osRelease.ID))
    throw new Error(`Unsupported Linux distribution: ${osRelease.ID ?? 'unknown'}`);
  if (totalmem() < 4 * 1024 ** 3) throw new Error('At least 4 GiB RAM is required');
  let probePath = root;
  while (!existsSync(probePath) && probePath !== dirname(probePath)) probePath = dirname(probePath);
  const disk = statfsSync(probePath);
  if (disk.bavail * disk.bsize < 20 * 1024 ** 3)
    throw new Error('At least 20 GiB free disk is required');
  parseMinimumVersion(
    run(dockerBin, ['version', '--format', '{{.Server.Version}}']),
    [24, 0],
    'Docker',
  );
  parseMinimumVersion(run(dockerBin, ['compose', 'version', '--short']), [2, 20], 'Docker Compose');
  const sync = run('timedatectl', ['show', '--property=NTPSynchronized', '--value']);
  if (sync.trim() !== 'yes') throw new Error('System clock is not NTP synchronized');
  requireCommand('systemctl');
}

function preflightDeployment(input, state) {
  if (acceptance) return;
  requireCommand('getent');
  requireCommand('ss');
  run('getent', ['ahosts', input.publicHost]);
  if (!state && !options.migrationMode) {
    const listeners = run('ss', ['-H', '-ltn']);
    if (listeners.split('\n').some((line) => /:(?:80|443)\s/u.test(line)))
      throw new Error(
        'Ports 80 or 443 are already in use; use explicit migration mode only for a managed transition',
      );
  }
}

function prepareManagedRoot() {
  const existed = existsSync(root);
  if (existed && !existsSync(stateFile) && !existsSync(ownershipFile)) {
    const entries = readdirSync(root).filter((entry) => entry !== '.installer.lock');
    if (entries.length && !options.migrationMode)
      throw new Error(
        'Installation root is non-empty but unmanaged; use --migration-mode explicitly',
      );
  }
  mkdirSync(root, { recursive: true, mode: 0o750 });
  for (const directory of ['releases', 'manifests', 'failures'])
    mkdirSync(join(root, directory), { recursive: true, mode: 0o750 });
  if (existsSync(ownershipFile)) {
    const ownership = JSON.parse(readFileSync(ownershipFile, 'utf8'));
    if (ownership.schemaVersion !== 'unify-installer-ownership/v1' || ownership.project !== project)
      throw new Error('Installation ownership marker is invalid or belongs to another project');
  } else {
    atomicJson(
      ownershipFile,
      {
        schemaVersion: 'unify-installer-ownership/v1',
        project,
        createdAt: new Date().toISOString(),
      },
      0o640,
    );
  }
}

function stageRelease(input) {
  const finalDirectory = join(root, 'releases', input.releaseId);
  if (existsSync(finalDirectory)) {
    const release = readRelease(input.releaseId);
    assertInputMatches(release.input, input);
    return release;
  }
  const staging = join(root, 'releases', `.${input.releaseId}.staging-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'deploy/five-service'), { recursive: true, mode: 0o750 });
  mkdirSync(join(staging, 'apps/gateway'), { recursive: true, mode: 0o750 });
  mkdirSync(join(staging, 'scripts/lib'), { recursive: true, mode: 0o750 });
  for (const file of ['compose.yaml', 'compose.jobs.yaml', 'frameworks.json'])
    copyFileSync(
      join(sourceRoot, 'deploy/five-service', file),
      join(staging, 'deploy/five-service', file),
    );
  cpSync(join(sourceRoot, 'apps/gateway/migrations'), join(staging, 'apps/gateway/migrations'), {
    recursive: true,
  });
  copyFileSync(
    join(sourceRoot, 'scripts/backup-gateway.sh'),
    join(staging, 'scripts/backup-gateway.sh'),
  );
  copyFileSync(
    join(sourceRoot, 'scripts/lib/five-service-installation.mjs'),
    join(staging, 'scripts/lib/five-service-installation.mjs'),
  );
  copyFileSync(
    join(sourceRoot, 'deploy/five-service/install.mjs'),
    join(staging, 'deploy/five-service/install.mjs'),
  );
  chmodSync(join(staging, 'scripts/backup-gateway.sh'), 0o750);
  chmodSync(join(staging, 'deploy/five-service/install.mjs'), 0o750);
  writeFileSync(join(staging, 'installation-inputs.json'), `${JSON.stringify(input, null, 2)}\n`, {
    mode: 0o640,
  });
  const environment = installationEnvironment(input);
  writeFileSync(
    join(staging, 'compose.env'),
    `${Object.entries(environment)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\nCOMPOSE_PROJECT_NAME=${project}\n`,
    { mode: 0o640 },
  );
  const definitionHashes = {};
  for (const file of releaseDefinitionFiles(staging))
    definitionHashes[file] = sha256(join(staging, file));
  writeFileSync(
    join(staging, 'release-definitions.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'unify-release-definitions/v1',
        gitCommit: gitCommit(),
        definitionHashes,
      },
      null,
      2,
    )}\n`,
    { mode: 0o640 },
  );
  renameSync(staging, finalDirectory);
  return readRelease(input.releaseId);
}

function prepareDirectories(input) {
  for (const path of [input.paths.alicaData, input.paths.hermanData]) {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true, mode: 0o750 });
      if (process.getuid?.() === 0) chownSync(path, 10_000, 10_000);
    }
  }
  for (const path of [input.paths.secrets, input.paths.backups]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
}

function prepareSecrets(input) {
  const directory = input.paths.secrets;
  const secret = (name, bytes = 48) => {
    const path = join(directory, name);
    if (!existsSync(path)) writeSecret(path, randomBytes(bytes).toString('base64url'));
    requireNonempty(path);
    return readFileSync(path, 'utf8').trim();
  };
  const postgresPassword = secret('postgres-password', 32);
  const alicaDatabasePassword = secret('alica-database-password', 32);
  const hermanDatabasePassword = secret('herman-database-password', 32);
  ensureExactSecret(
    join(directory, 'database-url'),
    `postgresql://unify:${encodeURIComponent(postgresPassword)}@unify-postgres:5432/unify`,
  );
  ensureExactSecret(
    join(directory, 'alica-database-url'),
    `postgresql://unify_alica_adapter:${encodeURIComponent(alicaDatabasePassword)}@unify-postgres:5432/unify`,
  );
  ensureExactSecret(
    join(directory, 'herman-database-url'),
    `postgresql://unify_herman_adapter:${encodeURIComponent(hermanDatabasePassword)}@unify-postgres:5432/unify`,
  );
  secret('auth-pepper');
  secret('bootstrap-admin-password', 36);
  secret('backup-encryption-key', 48);
  secret('alica-api-token');
  secret('herman-api-token');
  for (const framework of ['alica', 'herman']) {
    const tokenPath = join(directory, `${framework}-token`);
    const bundlePath = join(directory, `${framework}-token-bundle.json`);
    let token;
    if (existsSync(tokenPath)) token = readFileSync(tokenPath, 'utf8').trim();
    else if (existsSync(bundlePath)) token = parseTokenBundle(bundlePath).active.token;
    else token = randomBytes(48).toString('base64url');
    ensureExactSecret(tokenPath, token);
    if (existsSync(bundlePath)) {
      if (parseTokenBundle(bundlePath).active.token !== token)
        throw new Error(`${framework} token and token bundle disagree`);
    } else {
      writeSecret(
        bundlePath,
        JSON.stringify({ active: { version: input.releaseId, token } }, null, 2),
      );
    }
  }
  prepareTlsSecrets(directory);
  for (const name of requiredSecretNames()) requireNonempty(join(directory, name));
  for (const name of containerSecretNames()) chmodSync(join(directory, name), 0o444);
}

function prepareTlsSecrets(directory) {
  const files = [
    'framework-ca.key',
    'framework-ca.crt',
    'alica.key',
    'alica.crt',
    'herman.key',
    'herman.crt',
  ];
  const existing = files.filter((name) => existsSync(join(directory, name)));
  if (existing.length === files.length) return;
  if (existing.length)
    throw new Error('TLS secret set is partial; refusing to replace existing key material');
  const temporary = join(directory, `.tls-${process.pid}`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    run('openssl', [
      'genpkey',
      '-algorithm',
      'RSA',
      '-pkeyopt',
      'rsa_keygen_bits:3072',
      '-out',
      join(temporary, 'framework-ca.key'),
    ]);
    run('openssl', [
      'req',
      '-x509',
      '-new',
      '-key',
      join(temporary, 'framework-ca.key'),
      '-sha256',
      '-days',
      '3650',
      '-subj',
      '/CN=UNIFY Framework CA',
      '-out',
      join(temporary, 'framework-ca.crt'),
    ]);
    for (const framework of ['alica', 'herman']) {
      run('openssl', [
        'req',
        '-newkey',
        'rsa:3072',
        '-nodes',
        '-subj',
        `/CN=${framework}-adapter`,
        '-keyout',
        join(temporary, `${framework}.key`),
        '-out',
        join(temporary, `${framework}.csr`),
      ]);
      writeFileSync(
        join(temporary, `${framework}.ext`),
        `subjectAltName=DNS:${framework}-adapter\nextendedKeyUsage=serverAuth\n`,
      );
      run('openssl', [
        'x509',
        '-req',
        '-in',
        join(temporary, `${framework}.csr`),
        '-CA',
        join(temporary, 'framework-ca.crt'),
        '-CAkey',
        join(temporary, 'framework-ca.key'),
        '-CAcreateserial',
        '-days',
        '825',
        '-sha256',
        '-extfile',
        join(temporary, `${framework}.ext`),
        '-out',
        join(temporary, `${framework}.crt`),
      ]);
    }
    for (const name of files) {
      renameSync(join(temporary, name), join(directory, name));
      chmodSync(join(directory, name), name.endsWith('.crt') ? 0o644 : 0o600);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function verifyImages(input) {
  for (const [name, declaredReference] of Object.entries(input.images)) {
    const reference = runtimeImageReference(name, declaredReference);
    if (reference === declaredReference) run(dockerBin, ['pull', reference]);
    const id = run(dockerBin, ['image', 'inspect', reference, '--format', '{{.Id}}']).trim();
    if (!/^sha256:[a-f0-9]{64}$/u.test(id))
      throw new Error('Image inspection returned an invalid immutable ID');
  }
}

function renderCompose(release) {
  const output = compose(release, ['config'], { capture: true });
  writeFileSync(join(release.directory, 'compose.resolved.yaml'), output, { mode: 0o640 });
  if (!output.includes('unify-core') || !output.includes('unify-postgres'))
    throw new Error('Rendered Compose configuration is incomplete');
}

function ensureVolumes(input) {
  const created = new Set();
  for (const volume of Object.values(input.volumes)) {
    const inspect = spawnSync(dockerBin, ['volume', 'inspect', volume], { encoding: 'utf8' });
    if (inspect.status !== 0) {
      run(dockerBin, ['volume', 'create', volume]);
      created.add(volume);
    }
  }
  const caddyImage = runtimeImageReference('caddy', input.images.caddy);
  const caddyVolumes = [
    { volume: input.volumes.caddyData, target: '/data' },
    { volume: input.volumes.caddyLogs, target: '/var/log/caddy' },
  ];
  for (const { volume, target } of caddyVolumes) {
    if (created.has(volume))
      run(dockerBin, [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--cap-add',
        'CHOWN',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        '0:0',
        '--volume',
        `${volume}:${target}`,
        '--entrypoint',
        '/bin/sh',
        caddyImage,
        '-c',
        `chmod 0750 ${target} && chown -R 10000:10000 ${target}`,
      ]);
    run(dockerBin, [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      '10000:10000',
      '--volume',
      `${volume}:${target}`,
      '--entrypoint',
      '/bin/sh',
      caddyImage,
      '-c',
      `test -w ${target}`,
    ]);
  }
}

function activateRelease(release, { runMigrations }) {
  compose(release, ['up', '-d', '--wait', 'unify-postgres']);
  if (runMigrations) composeJob(release, 'migrate');
  composeJob(release, 'reconcile-database-roles');
  composeJob(release, 'bootstrap-admin');
  compose(release, ['up', '-d', '--wait']);
  composeJob(release, 'reconcile-frameworks');
  verifyDeployment(release);
}

function verifyDeployment(release) {
  compose(release, ['config', '--quiet']);
  const lines = run(dockerBin, [
    'ps',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Ports}}',
  ])
    .split('\n')
    .filter(Boolean);
  const expected = ['alica', 'caddy', 'herman', 'unify-core', 'unify-postgres'];
  const observed = lines.map((line) => line.split('|')[0]).sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected))
    throw new Error(
      `Expected exactly five steady-state services, found ${observed.join(',') || 'none'}`,
    );
  for (const line of lines) {
    const [service, state, ports = ''] = line.split('|');
    if (state !== 'running') throw new Error(`${service} is not running`);
    if (service !== 'caddy' && ports.includes('->'))
      throw new Error(`${service} unexpectedly publishes ports`);
    if (service === 'caddy' && !ports.includes('->'))
      throw new Error('Caddy does not publish the declared ingress ports');
  }
  const reconciliation = JSON.parse(composeJob(release, 'reconcile-frameworks'));
  if (reconciliation.changed !== 0 || reconciliation.frameworks?.length !== 2)
    throw new Error('Framework registrations did not converge');
  if (!acceptance) verifyPublicHealth(release.input.publicOrigin);
}

function createBackup(release, reason) {
  if (acceptance && process.env.UNIFY_INSTALLER_SKIP_BACKUP === '1') {
    const path = join(
      release.input.paths.backups,
      `${reason}-${release.input.releaseId}.acceptance`,
    );
    if (!existsSync(path)) writeFileSync(path, 'acceptance-backup\n', { mode: 0o600 });
    return { path, sha256: sha256(path), reason, verified: true };
  }
  const environment = {
    ...process.env,
    UNIFY_COMPOSE_FILE: join(release.directory, 'deploy/five-service/compose.yaml'),
    UNIFY_COMPOSE_PROJECT: project,
    BACKUP_ENCRYPTION_KEY_FILE: join(release.input.paths.secrets, 'backup-encryption-key'),
    BACKUP_DIR: release.input.paths.backups,
    UNIFY_GIT_COMMIT: gitCommit(),
    ...installationEnvironment(release.input),
  };
  const output = run('bash', [join(release.directory, 'scripts/backup-gateway.sh')], {
    cwd: release.directory,
    env: environment,
  });
  const match = /Encrypted Gateway backup created: (.+)/u.exec(output);
  if (!match?.[1]) throw new Error('Backup command did not report an archive');
  const path = match[1].trim();
  verifyBackupArchive(path, environment.BACKUP_ENCRYPTION_KEY_FILE);
  return { path, sha256: sha256(path), reason, verified: true };
}

function verifyBackupArchive(path, keyFile) {
  const temporary = join(root, `.backup-verify-${process.pid}.tar`);
  try {
    run('openssl', [
      'enc',
      '-d',
      '-aes-256-cbc',
      '-pbkdf2',
      '-iter',
      '200000',
      '-pass',
      `file:${keyFile}`,
      '-in',
      path,
      '-out',
      temporary,
    ]);
    const listing = run('tar', ['-tf', temporary])
      .split('\n')
      .map((name) => name.replace(/^\.\//u, ''));
    for (const name of ['gateway.dump', 'release.manifest', 'compose.resolved.yaml'])
      if (!listing.includes(name)) throw new Error(`Backup archive is missing ${name}`);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeReleaseManifest(release, previousRelease, backup) {
  const input = release.input;
  const imageIds = Object.fromEntries(
    Object.entries(input.images).map(([name, reference]) => {
      const runtimeReference = runtimeImageReference(name, reference);
      return [
        name,
        {
          reference,
          runtimeReference,
          id: run(dockerBin, ['image', 'inspect', runtimeReference, '--format', '{{.Id}}']).trim(),
        },
      ];
    }),
  );
  const secretHashes = Object.fromEntries(
    requiredSecretNames().map((name) => [name, sha256(join(input.paths.secrets, name))]),
  );
  const manifest = {
    schemaVersion: 'unify-installation-manifest/v1',
    releaseId: input.releaseId,
    previousRelease,
    project,
    installedAt: new Date().toISOString(),
    inputSha256: sha256(join(release.directory, 'installation-inputs.json')),
    composeSha256: sha256(join(release.directory, 'compose.resolved.yaml')),
    definitionsSha256: sha256(join(release.directory, 'release-definitions.json')),
    imagePolicy: {
      digestPinned: true,
      sbomGate: 'repository-production-image-policy',
    },
    imageIds,
    secretHashes,
    backup,
  };
  const path = join(root, 'manifests', `${input.releaseId}.json`);
  atomicJson(path, manifest, 0o640);
  const digest = sha256(path);
  writeFileSync(`${path}.sha256`, `${digest}  ${basename(path)}\n`, { mode: 0o640 });
  return { path, sha256: digest };
}

function writeOperationManifest(operation, fromRelease, toRelease) {
  const directory = join(root, 'manifests', 'operations');
  mkdirSync(directory, { recursive: true, mode: 0o750 });
  const occurredAt = new Date().toISOString();
  const path = join(directory, `${Date.now()}-${operation}.json`);
  atomicJson(
    path,
    {
      schemaVersion: 'unify-installer-operation/v1',
      operation,
      fromRelease,
      toRelease,
      project,
      occurredAt,
    },
    0o640,
  );
  writeFileSync(`${path}.sha256`, `${sha256(path)}  ${basename(path)}\n`, { mode: 0o640 });
}

function configureBackupSchedule(release) {
  const unitDirectory = acceptance
    ? join(root, 'systemd')
    : (process.env.UNIFY_SYSTEMD_UNIT_DIR ?? '/etc/systemd/system');
  mkdirSync(unitDirectory, { recursive: true, mode: 0o755 });
  const environmentFile = join(root, 'backup.env');
  const environment = {
    UNIFY_COMPOSE_FILE: join(root, 'current/deploy/five-service/compose.yaml'),
    UNIFY_COMPOSE_PROJECT: project,
    BACKUP_ENCRYPTION_KEY_FILE: join(release.input.paths.secrets, 'backup-encryption-key'),
    BACKUP_DIR: release.input.paths.backups,
    UNIFY_GIT_COMMIT: gitCommit(),
    ...installationEnvironment(release.input),
  };
  writeFileSync(
    environmentFile,
    `${Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    { mode: 0o640 },
  );
  writeFileSync(
    join(unitDirectory, 'unify-backup.service'),
    `[Unit]\nDescription=UNIFY encrypted backup\nAfter=docker.service\n\n[Service]\nType=oneshot\nEnvironmentFile=${environmentFile}\nWorkingDirectory=${join(root, 'current')}\nExecStart=/usr/bin/env bash ${join(root, 'current/scripts/backup-gateway.sh')}\n`,
  );
  writeFileSync(
    join(unitDirectory, 'unify-backup.timer'),
    '[Unit]\nDescription=Daily UNIFY encrypted backup\n\n[Timer]\nOnCalendar=*-*-* 03:17:00 UTC\nPersistent=true\nRandomizedDelaySec=900\n\n[Install]\nWantedBy=timers.target\n',
  );
  if (!acceptance) {
    run('systemctl', ['daemon-reload']);
    run('systemctl', ['enable', '--now', 'unify-backup.timer']);
  }
}

function recoverRelease(release) {
  compose(release, ['up', '-d', '--wait']);
  composeJob(release, 'reconcile-frameworks');
  verifyDeployment(release);
}

function compose(release, args, options = {}) {
  return run(
    dockerBin,
    [
      'compose',
      '--env-file',
      join(release.directory, 'compose.env'),
      '-f',
      join(release.directory, 'deploy/five-service/compose.yaml'),
      '--project-name',
      project,
      ...args,
    ],
    { ...options, env: composeProcessEnvironment(release) },
  );
}

function composeJob(release, service) {
  return run(
    dockerBin,
    [
      'compose',
      '--env-file',
      join(release.directory, 'compose.env'),
      '-f',
      join(release.directory, 'deploy/five-service/compose.yaml'),
      '-f',
      join(release.directory, 'deploy/five-service/compose.jobs.yaml'),
      '--project-name',
      project,
      'run',
      '--rm',
      '--no-deps',
      service,
    ],
    { env: composeProcessEnvironment(release) },
  );
}

function composeProcessEnvironment(release) {
  return {
    ...process.env,
    ...installationEnvironment(release.input),
    COMPOSE_PROJECT_NAME: project,
  };
}

function readRelease(releaseId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(releaseId))
    throw new Error('Release ID is invalid');
  const directory = join(root, 'releases', releaseId);
  if (!existsSync(directory)) throw new Error(`Release definitions not found: ${releaseId}`);
  const input = validateInstallationInput(
    JSON.parse(readFileSync(join(directory, 'installation-inputs.json'), 'utf8')),
  );
  const definitions = JSON.parse(readFileSync(join(directory, 'release-definitions.json'), 'utf8'));
  if (
    definitions.schemaVersion !== 'unify-release-definitions/v1' ||
    !/^[a-f0-9]{40}$/u.test(definitions.gitCommit)
  )
    throw new Error('Release definition metadata is invalid');
  for (const [file, expected] of Object.entries(definitions.definitionHashes))
    if (sha256(join(directory, file)) !== expected)
      throw new Error(`Release definition checksum mismatch: ${file}`);
  return { directory, input };
}

function readAcceptedRelease(releaseId, expectedManifestSha256) {
  const release = readRelease(releaseId);
  const manifestPath = join(root, 'manifests', `${releaseId}.json`);
  const checksumPath = `${manifestPath}.sha256`;
  if (!existsSync(manifestPath) || !existsSync(checksumPath))
    throw new Error(`Accepted release manifest not found: ${releaseId}`);
  const digest = sha256(manifestPath);
  const recordedDigest = readFileSync(checksumPath, 'utf8').trim().split(/\s+/u)[0];
  if (digest !== recordedDigest || (expectedManifestSha256 && digest !== expectedManifestSha256))
    throw new Error(`Accepted release manifest checksum mismatch: ${releaseId}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.schemaVersion !== 'unify-installation-manifest/v1' ||
    manifest.releaseId !== releaseId ||
    manifest.project !== project
  )
    throw new Error(`Accepted release manifest is invalid: ${releaseId}`);
  return release;
}

function writeCurrentLinks(current, previous) {
  atomicSymlink(join(root, 'current'), join(root, 'releases', current));
  if (previous) atomicSymlink(join(root, 'rollback'), join(root, 'releases', previous));
  else if (existsSync(join(root, 'rollback'))) unlinkSync(join(root, 'rollback'));
}

function atomicSymlink(path, target) {
  const temporary = `${path}.new-${process.pid}`;
  rmSync(temporary, { force: true });
  symlinkSync(target, temporary);
  renameSync(temporary, path);
}

function acquireLock() {
  try {
    return openSync(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const owner = Number(readFileSync(lockFile, 'utf8').trim());
    try {
      if (Number.isInteger(owner) && owner > 1) process.kill(owner, 0);
      throw new Error(`Another installer process holds the lock (${owner || 'unknown'})`);
    } catch (probeError) {
      if (probeError?.code !== 'ESRCH') throw probeError;
    }
    unlinkSync(lockFile);
    return openSync(lockFile, 'wx', 0o600);
  }
}

function readState() {
  if (!existsSync(stateFile)) return null;
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.schemaVersion !== 'unify-installer-state/v1' || state.project !== project)
    throw new Error('Installer state is invalid or belongs to another Compose project');
  return state;
}

function writeState(state) {
  atomicJson(stateFile, state, 0o640);
}

function recordFailure(error) {
  const path = join(root, 'failures', `${Date.now()}.json`);
  atomicJson(
    path,
    {
      schemaVersion: 'unify-installer-failure/v1',
      mode: options.mode,
      requestedRelease: activeInput?.releaseId ?? null,
      recoveredRelease: recoveryRelease?.input.releaseId ?? null,
      occurredAt: new Date().toISOString(),
      error: safeMessage(error),
    },
    0o640,
  );
}

function atomicJson(path, value, mode) {
  const temporary = `${path}.new-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, path);
}

function injectFailure(step) {
  if (options.injectFailure === step) throw new Error(`Injected installer failure at ${step}`);
}

function parseTokenBundle(path) {
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  if (!bundle?.active?.token || typeof bundle.active.token !== 'string')
    throw new Error(`Invalid token bundle: ${basename(path)}`);
  return bundle;
}

function ensureExactSecret(path, expected) {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8').trim() !== expected)
      throw new Error(`Existing related secret is inconsistent: ${basename(path)}`);
    return;
  }
  writeSecret(path, expected);
}

function writeSecret(path, value) {
  writeFileSync(path, `${value}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
}

function requireNonempty(path) {
  if (!existsSync(path) || readFileSync(path).length === 0)
    throw new Error(`Required secret is missing or empty: ${basename(path)}`);
  chmodSync(path, path.endsWith('.crt') ? 0o644 : 0o600);
}

function requiredSecretNames() {
  return [
    'postgres-password',
    'alica-database-password',
    'herman-database-password',
    'database-url',
    'alica-database-url',
    'herman-database-url',
    'auth-pepper',
    'bootstrap-admin-password',
    'backup-encryption-key',
    'alica-token',
    'herman-token',
    'alica-api-token',
    'herman-api-token',
    'alica-token-bundle.json',
    'herman-token-bundle.json',
    'framework-ca.key',
    'framework-ca.crt',
    'alica.key',
    'alica.crt',
    'herman.key',
    'herman.crt',
  ];
}

function containerSecretNames() {
  return [
    'postgres-password',
    'database-url',
    'alica-database-url',
    'herman-database-url',
    'auth-pepper',
    'bootstrap-admin-password',
    'alica-token',
    'herman-token',
    'alica-api-token',
    'herman-api-token',
    'alica-token-bundle.json',
    'herman-token-bundle.json',
    'framework-ca.crt',
    'alica.key',
    'alica.crt',
    'herman.key',
    'herman.crt',
  ];
}

function releaseDefinitionFiles(directory) {
  const files = [
    'deploy/five-service/compose.yaml',
    'deploy/five-service/compose.jobs.yaml',
    'deploy/five-service/frameworks.json',
    'deploy/five-service/install.mjs',
    'scripts/backup-gateway.sh',
    'scripts/lib/five-service-installation.mjs',
    'installation-inputs.json',
    'compose.env',
  ];
  for (const name of readdirSync(join(directory, 'apps/gateway/migrations')).sort())
    files.push(`apps/gateway/migrations/${name}`);
  return files;
}

function assertInputMatches(left, right) {
  if (canonicalJson(left) !== canonicalJson(right))
    throw new Error('Existing release ID has different installation inputs');
}

function assertStableInstallationIdentity(current, requested) {
  const currentIdentity = {
    publicHost: current.publicHost,
    publicOrigin: current.publicOrigin,
    paths: current.paths,
    volumes: current.volumes,
  };
  const requestedIdentity = {
    publicHost: requested.publicHost,
    publicOrigin: requested.publicOrigin,
    paths: requested.paths,
    volumes: requested.volumes,
  };
  if (canonicalJson(currentIdentity) !== canonicalJson(requestedIdentity))
    throw new Error(
      'Upgrade changes installation identity, data paths, or volumes; use explicit migration mode',
    );
}

function verifyPublicHealth(origin) {
  run('curl', ['--fail', '--silent', '--show-error', '--max-time', '10', `${origin}/healthz`]);
  const unauthenticated = run('curl', [
    '--silent',
    '--show-error',
    '--output',
    '/dev/null',
    '--write-out',
    '%{http_code}',
    '--max-time',
    '10',
    `${origin}/api/v1/auth/me`,
  ]);
  if (unauthenticated !== '401')
    throw new Error(`Authentication smoke gate returned HTTP ${unauthenticated}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? sourceRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${basename(command)} command failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function requireCommand(command) {
  const result = spawnSync('sh', ['-c', `command -v "$1" >/dev/null 2>&1`, 'sh', command]);
  if (result.status !== 0) throw new Error(`Required command is unavailable: ${basename(command)}`);
}

function parseMinimumVersion(value, minimum, label) {
  const match = /^(\d+)\.(\d+)/u.exec(value.trim());
  if (
    !match ||
    Number(match[1]) < minimum[0] ||
    (Number(match[1]) === minimum[0] && Number(match[2]) < minimum[1])
  )
    throw new Error(`${label} ${minimum.join('.')} or newer is required`);
}

function readKeyValue(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/gu, '')];
      }),
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function readAcceptanceImageMap() {
  const raw = process.env.UNIFY_INSTALLER_ACCEPTANCE_IMAGE_MAP;
  if (!raw) return {};
  if (!acceptance) throw new Error('Local image mapping is restricted to guarded acceptance mode');
  const value = JSON.parse(raw);
  const expected = ['caddy', 'core', 'hermesRuntime'];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)
  )
    throw new Error('Acceptance image map must define exactly caddy, core, and hermesRuntime');
  for (const reference of Object.values(value))
    if (
      typeof reference !== 'string' ||
      !reference ||
      /\s/u.test(reference) ||
      [...reference].some((character) => character.codePointAt(0) < 32)
    )
      throw new Error('Acceptance image map contains an invalid local reference');
  return value;
}

function runtimeImageReference(name, declaredReference) {
  return acceptanceImageMap[name] ?? declaredReference;
}

function installationEnvironment(input) {
  const environment = composeEnvironment(input);
  environment.HERMES_RUNTIME_IMAGE = runtimeImageReference(
    'hermesRuntime',
    input.images.hermesRuntime,
  );
  environment.UNIFY_CORE_IMAGE = runtimeImageReference('core', input.images.core);
  environment.CADDY_IMAGE = runtimeImageReference('caddy', input.images.caddy);
  return environment;
}

function gitCommit() {
  const stagedDefinitions = join(sourceRoot, 'release-definitions.json');
  const value =
    process.env.UNIFY_GIT_COMMIT ??
    (existsSync(stagedDefinitions)
      ? JSON.parse(readFileSync(stagedDefinitions, 'utf8')).gitCommit
      : run('git', ['rev-parse', 'HEAD']));
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error('Git commit is unavailable');
  return value;
}

function requireState(state) {
  if (!state) throw new Error(`${options.mode} requires an existing managed installation`);
}

function result(mode, releaseId, changed) {
  return {
    schemaVersion: 'unify-installer-result/v1',
    mode,
    releaseId,
    changed,
    project,
    status: 'PASS',
  };
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/giu, 'postgresql://[REDACTED]@')
    .replace(/[A-Za-z0-9_-]{32,}/gu, '[REDACTED]')
    .slice(0, 2000);
}

function fail(message) {
  console.error(`UNIFY installer failed: ${message}`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const mode = args.shift();
  if (!['install', 'verify', 'upgrade', 'rollback'].includes(mode))
    throw new Error(
      'Usage: install.mjs <install|verify|upgrade|rollback> --root PATH [--input FILE]',
    );
  const parsed = {
    mode,
    root: '',
    input: undefined,
    target: undefined,
    project: 'unify',
    migrationMode: false,
    acceptance: false,
    injectFailure: undefined,
  };
  while (args.length) {
    const name = args.shift();
    if (name === '--migration-mode') parsed.migrationMode = true;
    else if (name === '--acceptance') parsed.acceptance = true;
    else if (['--root', '--input', '--target', '--project', '--inject-failure'].includes(name)) {
      const value = args.shift();
      if (!value) throw new Error(`${name} requires a value`);
      if (name === '--root') parsed.root = value;
      if (name === '--input') parsed.input = value;
      if (name === '--target') parsed.target = value;
      if (name === '--project') parsed.project = value;
      if (name === '--inject-failure') parsed.injectFailure = value;
    } else throw new Error(`Unknown argument: ${name}`);
  }
  if (!parsed.root || !resolve(parsed.root).startsWith('/'))
    throw new Error('--root must be absolute');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(parsed.project)) throw new Error('Invalid project name');
  return parsed;
}
