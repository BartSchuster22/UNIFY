#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const qa10Runner = readFileSync(resolve(root, 'deploy/alica-v1/qa10-production.sh'), 'utf8');
for (const scope of ['control:secrets', 'memory:read', 'memory:write'])
  assert.ok(
    qa10Runner.includes(`'${scope}'`),
    `Production QA10 registration must preserve ${scope}`,
  );
const fixture = mkdtempSync(join(tmpdir(), 'unify-installer-'));
const installRoot = join(fixture, 'managed');
const partialRoot = join(fixture, 'partial');
const ambiguousRoot = join(fixture, 'ambiguous');
const fakeDocker = join(fixture, 'docker');
const fakeState = join(fixture, 'docker-state.json');
const fakeLog = join(fixture, 'docker.log');
const project = `unify-installer-${process.pid}`;

try {
  writeFakeDocker();
  const v1 = writeInput('phase-14.4-v1', '1', installRoot);
  const v2 = writeInput('phase-14.4-v2', '2', installRoot);

  mkdirSync(ambiguousRoot, { recursive: true });
  writeFileSync(join(ambiguousRoot, 'foreign.txt'), 'foreign\n');
  const ambiguous = installer('install', ambiguousRoot, v1, [], false);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /non-empty but unmanaged/u);

  const interrupted = installer(
    'install',
    partialRoot,
    writeInput('partial-v1', '3', partialRoot),
    ['--inject-failure', 'prepared'],
    false,
  );
  assert.notEqual(interrupted.status, 0);
  assert.ok(existsSync(join(partialRoot, 'installer-owned.json')));
  assert.ok(!existsSync(join(partialRoot, 'installer-state.json')));
  const resumed = installer('install', partialRoot, join(fixture, 'partial-v1.json'));
  assert.equal(result(resumed).status, 'PASS');

  const first = installer('install', installRoot, v1);
  assert.deepEqual(result(first), {
    schemaVersion: 'unify-installer-result/v1',
    mode: 'install',
    releaseId: 'phase-14.4-v1',
    changed: true,
    project,
    status: 'PASS',
  });
  assertConformance(installRoot, 'phase-14.4-v1');
  const lockPath = join(installRoot, '.installer.lock');
  writeFileSync(lockPath, `${process.pid}\n`);
  const locked = installer('verify', installRoot, undefined, [], false);
  assert.notEqual(locked.status, 0);
  assert.match(locked.stderr, /Another installer process holds the lock/u);
  assert.equal(readFileSync(lockPath, 'utf8'), `${process.pid}\n`);
  unlinkSync(lockPath);
  const manifestPath = join(installRoot, 'manifests/phase-14.4-v1.json');
  const manifestBefore = readFileSync(manifestPath, 'utf8');
  writeFileSync(manifestPath, `${manifestBefore} `);
  const tampered = installer('verify', installRoot, undefined, [], false);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /manifest checksum mismatch/u);
  writeFileSync(manifestPath, manifestBefore);
  const stateBefore = readFileSync(join(installRoot, 'installer-state.json'), 'utf8');
  const secretHashes = hashDirectory(join(installRoot, 'secrets'));
  const secretValues = readdirSync(join(installRoot, 'secrets'))
    .map((name) => readFileSync(join(installRoot, 'secrets', name), 'utf8').trim())
    .filter((value) => value.length >= 16);
  const registrationEvidenceBefore = dockerState().reconcileCount;
  const backupCountBefore = readdirSync(join(installRoot, 'backups')).length;

  const second = installer('install', installRoot, v1);
  assert.equal(result(second).changed, false);
  assert.equal(readFileSync(join(installRoot, 'installer-state.json'), 'utf8'), stateBefore);
  assert.deepEqual(hashDirectory(join(installRoot, 'secrets')), secretHashes);
  assert.equal(dockerState().reconcileCount, registrationEvidenceBefore + 1);
  assert.equal(readdirSync(join(installRoot, 'backups')).length, backupCountBefore);

  const verify = installer('verify', installRoot);
  assert.equal(result(verify).mode, 'verify');
  assert.equal(result(verify).changed, false);

  const failedUpgrade = installer(
    'upgrade',
    installRoot,
    v2,
    ['--inject-failure', 'started'],
    false,
  );
  assert.notEqual(failedUpgrade.status, 0);
  assert.match(failedUpgrade.stderr, /Injected installer failure/u);
  assert.equal(readState(installRoot).currentRelease, 'phase-14.4-v1');
  assert.ok(existsSync(join(installRoot, 'releases/phase-14.4-v2')));
  assert.equal(basenameOfLink(join(installRoot, 'current')), 'phase-14.4-v1');
  assert.deepEqual(hashDirectory(join(installRoot, 'secrets')), secretHashes);
  assert.ok(readdirSync(join(installRoot, 'failures')).length >= 1);

  const upgraded = installer('upgrade', installRoot, v2);
  assert.equal(result(upgraded).changed, true);
  assert.equal(readState(installRoot).currentRelease, 'phase-14.4-v2');
  assert.equal(readState(installRoot).previousRelease, 'phase-14.4-v1');
  assert.equal(basenameOfLink(join(installRoot, 'rollback')), 'phase-14.4-v1');
  assert.deepEqual(hashDirectory(join(installRoot, 'secrets')), secretHashes);
  assertConformance(installRoot, 'phase-14.4-v2');

  const rolledBack = installer(
    'rollback',
    installRoot,
    undefined,
    ['--target', 'phase-14.4-v1'],
    true,
    join(installRoot, 'current/deploy/five-service/install.mjs'),
  );
  assert.equal(result(rolledBack).changed, true);
  assert.equal(readState(installRoot).currentRelease, 'phase-14.4-v1');
  assert.equal(readState(installRoot).previousRelease, 'phase-14.4-v2');
  assert.equal(basenameOfLink(join(installRoot, 'rollback')), 'phase-14.4-v2');
  assert.deepEqual(hashDirectory(join(installRoot, 'secrets')), secretHashes);
  assertConformance(installRoot, 'phase-14.4-v1');

  const log = readFileSync(fakeLog, 'utf8');
  assert.doesNotMatch(log, /\b(?:rmi|image rm|volume rm|down -v)\b/u);
  assert.doesNotMatch(log, /ambient-override/u);
  assert.match(log, new RegExp(`SECRETS_DIR=${escapeRegex(join(installRoot, 'secrets'))}`, 'u'));
  const output = `${first.stdout}\n${first.stderr}`;
  for (const value of secretValues)
    assert.ok(!output.includes(value), 'Installer output exposed a secret');
  assert.equal(
    dockerState().services.sort().join(','),
    'alica,caddy,herman,unify-core,unify-postgres',
  );
  console.log(
    `Phase 14.4 installer acceptance: PASS install=no-op upgrade=recovered rollback=verified secrets=${Object.keys(secretHashes).length}`,
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function installer(
  mode,
  managedRoot,
  input,
  extra = [],
  expectSuccess = true,
  executable = resolve(root, 'deploy/five-service/install.mjs'),
) {
  const args = [executable, mode, '--root', managedRoot, '--project', project, '--acceptance'];
  if (input) args.push('--input', input);
  args.push(...extra);
  const execution = spawnSync(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      UNIFY_INSTALLER_ACCEPTANCE: '1',
      UNIFY_INSTALLER_DOCKER_BIN: fakeDocker,
      UNIFY_INSTALLER_SKIP_BACKUP: '1',
      SECRETS_DIR: '/tmp/ambient-override-secrets',
      UNIFY_POSTGRES_VOLUME: 'ambient-override-volume',
      FAKE_DOCKER_STATE: fakeState,
      FAKE_DOCKER_LOG: fakeLog,
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (expectSuccess && execution.status !== 0)
    throw new Error(
      `Installer failed (${execution.status}): ${execution.stderr}\n${execution.stdout}`,
    );
  return execution;
}

function result(execution) {
  const line = execution.stdout
    .trim()
    .split('\n')
    .findLast((entry) => entry.startsWith('{'));
  assert.ok(line, `Installer result missing: ${execution.stdout}`);
  return JSON.parse(line);
}

function assertConformance(managedRoot, expectedRelease) {
  const execution = spawnSync(
    process.execPath,
    [
      resolve(root, 'deploy/five-service/release-conformance.mjs'),
      '--root',
      managedRoot,
      '--project',
      project,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const report = JSON.parse(execution.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.integrity.status, 'PASS');
  assert.equal(report.targetConformance.status, 'PARTIAL');
  assert.equal(report.projection.release.releaseId, expectedRelease);
}

function writeInput(releaseId, digestCharacter, managedRoot) {
  const input = {
    schemaVersion: 'unify-five-service-installation/v1',
    releaseId,
    publicHost: 'localhost',
    publicOrigin: 'https://localhost',
    paths: {
      alicaData: join(managedRoot, 'data/alica'),
      hermanData: join(managedRoot, 'data/herman'),
      secrets: join(managedRoot, 'secrets'),
      backups: join(managedRoot, 'backups'),
    },
    volumes: {
      postgres: `${project}-postgres`,
      caddyData: `${project}-caddy-data`,
      caddyLogs: `${project}-caddy-logs`,
    },
    images: {
      hermesRuntime: `registry.invalid/unify/hermes@sha256:${digestCharacter.repeat(64)}`,
      core: `registry.invalid/unify/core@sha256:${digestCharacter.repeat(64)}`,
      caddy: `registry.invalid/unify/caddy@sha256:${digestCharacter.repeat(64)}`,
    },
  };
  const path = join(fixture, `${releaseId}.json`);
  writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`);
  return path;
}

function hashDirectory(directory) {
  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(join(directory, name)))
          .digest('hex'),
      ]),
  );
}

function readState(managedRoot) {
  return JSON.parse(readFileSync(join(managedRoot, 'installer-state.json'), 'utf8'));
}

function basenameOfLink(path) {
  return readlinkSync(path).split('/').at(-1);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function dockerState() {
  return JSON.parse(readFileSync(fakeState, 'utf8'));
}

function writeFakeDocker() {
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const statePath = process.env.FAKE_DOCKER_STATE;
const logPath = process.env.FAKE_DOCKER_LOG;
fs.appendFileSync(
  logPath,
  args.join(' ') +
    (args[0] === 'compose'
      ? ' SECRETS_DIR=' +
        process.env.SECRETS_DIR +
        ' UNIFY_POSTGRES_VOLUME=' +
        process.env.UNIFY_POSTGRES_VOLUME
      : '') +
    '\\n',
);
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { services: [], volumes: [], registered: false, reconcileCount: 0 };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
if (args[0] === 'pull') process.exit(0);
if (args[0] === 'run') process.exit(0);
if (args[0] === 'image' && args[1] === 'inspect') {
  const id = crypto.createHash('sha256').update(args[2]).digest('hex');
  process.stdout.write('sha256:' + id + '\\n');
  process.exit(0);
}
if (args[0] === 'volume' && args[1] === 'inspect')
  process.exit(state.volumes.includes(args[2]) ? 0 : 1);
if (args[0] === 'volume' && args[1] === 'create') {
  if (!state.volumes.includes(args[2])) state.volumes.push(args[2]);
  save();
  process.stdout.write(args[2] + '\\n');
  process.exit(0);
}
if (args[0] === 'ps') {
  for (const service of state.services)
    process.stdout.write(service + '|running|' + (service === 'caddy' ? '0.0.0.0:80->8080/tcp, 0.0.0.0:443->8443/tcp' : '') + '\\n');
  process.exit(0);
}
if (args[0] === 'compose') {
  const commandIndex = args.findIndex((arg) => ['config', 'up', 'run'].includes(arg));
  const command = args[commandIndex];
  if (command === 'config') {
    if (!args.includes('--quiet')) process.stdout.write('services:\\n  alica: {}\\n  herman: {}\\n  unify-core: {}\\n  unify-postgres: {}\\n  caddy: {}\\n');
    process.exit(0);
  }
  if (command === 'up') {
    const requested = args.slice(commandIndex + 1).filter((arg) => !arg.startsWith('-'));
    if (requested.length === 1 && requested[0] === 'unify-postgres') state.services = ['unify-postgres'];
    else state.services = ['alica', 'caddy', 'herman', 'unify-core', 'unify-postgres'];
    save();
    process.exit(0);
  }
  if (command === 'run') {
    const service = args.at(-1);
    if (service === 'reconcile-frameworks') {
      const changed = state.registered ? 0 : 2;
      state.registered = true;
      state.reconcileCount += 1;
      save();
      process.stdout.write(JSON.stringify({ changed, frameworks: [{ frameworkId: 'hermes-alica' }, { frameworkId: 'hermes-herman' }] }) + '\\n');
    } else if (service === 'reconcile-database-roles') {
      process.stdout.write(JSON.stringify({ changed: 0, roles: [] }) + '\\n');
    } else process.stdout.write(service + ' complete\\n');
    process.exit(0);
  }
}
process.stderr.write('unsupported fake docker command: ' + args.join(' ') + '\\n');
process.exit(2);
`,
    { mode: 0o755 },
  );
  chmodSync(fakeDocker, 0o755);
}
