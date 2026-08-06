#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(tmpdir(), 'unify-installer-runtime-'));
chmodSync(fixture, 0o755);
const managedRoot = join(fixture, 'managed');
const project = `unify-p144-${process.pid}`;
const httpPort = await freePort();
const httpsPort = await freePort();
const localImages = {
  hermesRuntime: 'unify/hermes-runtime:phase-14.1',
  core: 'unify-core:phase-14.3',
  caddy: 'unify-caddy:phase-14.2',
};
let release;
let completed = false;

try {
  for (const image of Object.values(localImages)) requireImage(image);
  const images = Object.fromEntries(
    Object.entries(localImages).map(([name, image]) => [
      name,
      `registry.invalid/unify/${name === 'hermesRuntime' ? 'hermes-runtime' : name}@${run(
        'docker',
        ['image', 'inspect', image, '--format', '{{.Id}}'],
      )}`,
    ]),
  );
  const v1 = writeInput('phase-14.4-runtime-v1', images);
  const v2 = writeInput('phase-14.4-runtime-v2', images);

  const first = installer('install', v1);
  assert.equal(installerResult(first).changed, true);
  release = 'phase-14.4-runtime-v1';
  assertSteadyState();
  const secretsBefore = hashDirectory(join(managedRoot, 'secrets'));
  const stateBefore = readFileSync(join(managedRoot, 'installer-state.json'), 'utf8');
  const backupsBefore = readdirSync(join(managedRoot, 'backups')).length;

  const second = installer('install', v1);
  assert.equal(installerResult(second).changed, false);
  assert.equal(readFileSync(join(managedRoot, 'installer-state.json'), 'utf8'), stateBefore);
  assert.equal(readdirSync(join(managedRoot, 'backups')).length, backupsBefore);
  assert.deepEqual(hashDirectory(join(managedRoot, 'secrets')), secretsBefore);
  assertSteadyState();

  const failed = installer('upgrade', v2, ['--inject-failure', 'started'], false);
  assert.notEqual(failed.status, 0);
  assert.equal(readState().currentRelease, 'phase-14.4-runtime-v1');
  assertSteadyState();
  assert.deepEqual(hashDirectory(join(managedRoot, 'secrets')), secretsBefore);

  const upgraded = installer('upgrade', v2);
  assert.equal(installerResult(upgraded).changed, true);
  release = 'phase-14.4-runtime-v2';
  assert.equal(readState().currentRelease, release);
  assertSteadyState();

  const rollback = installer(
    'rollback',
    undefined,
    ['--target', 'phase-14.4-runtime-v1'],
    true,
    join(managedRoot, 'current/deploy/five-service/install.mjs'),
  );
  assert.equal(installerResult(rollback).changed, true);
  release = 'phase-14.4-runtime-v1';
  assert.equal(readState().currentRelease, release);
  assertSteadyState();
  assert.deepEqual(hashDirectory(join(managedRoot, 'secrets')), secretsBefore);

  console.log(
    `Phase 14.4 installer real-runtime acceptance: PASS project=${project} containers=5 ports=${httpPort},${httpsPort}`,
  );
  completed = true;
} finally {
  if (completed || process.env.UNIFY_INSTALLER_KEEP_FAILED !== '1') cleanup();
  else console.error(`Preserved failed fixture: ${fixture} project=${project}`);
}

function installer(
  mode,
  input,
  extra = [],
  expectSuccess = true,
  executable = join(repository, 'deploy/five-service/install.mjs'),
) {
  const args = [executable, mode, '--root', managedRoot, '--project', project, '--acceptance'];
  if (input) args.push('--input', input);
  args.push(...extra);
  const execution = spawnSync(process.execPath, args, {
    cwd: repository,
    env: {
      ...process.env,
      UNIFY_INSTALLER_ACCEPTANCE: '1',
      UNIFY_INSTALLER_ACCEPTANCE_IMAGE_MAP: JSON.stringify(localImages),
      CADDY_HTTP_PORT: String(httpPort),
      CADDY_HTTPS_PORT: String(httpsPort),
    },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (expectSuccess && execution.status !== 0)
    throw new Error(
      `Installer failed (${execution.status}): ${execution.stderr}\n${execution.stdout}`,
    );
  return execution;
}

function installerResult(execution) {
  const line = execution.stdout
    .trim()
    .split('\n')
    .findLast((value) => value.startsWith('{'));
  assert.ok(line, `Installer result missing: ${execution.stdout}`);
  return JSON.parse(line);
}

function writeInput(releaseId, images) {
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
    images,
  };
  const path = join(fixture, `${releaseId}.json`);
  writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`);
  return path;
}

function assertSteadyState() {
  const services = run('docker', [
    'ps',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.Label "com.docker.compose.service"}}',
  ])
    .split('\n')
    .filter(Boolean)
    .sort();
  assert.deepEqual(services, ['alica', 'caddy', 'herman', 'unify-core', 'unify-postgres']);
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

function readState() {
  return JSON.parse(readFileSync(join(managedRoot, 'installer-state.json'), 'utf8'));
}

function requireImage(image) {
  run('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
}

function cleanup() {
  if (release) {
    const directory = join(managedRoot, 'releases', release);
    const environment = join(directory, 'compose.env');
    const compose = join(directory, 'deploy/five-service/compose.yaml');
    spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        environment,
        '-f',
        compose,
        '--project-name',
        project,
        'down',
        '--remove-orphans',
      ],
      {
        cwd: repository,
        env: {
          ...process.env,
          CADDY_HTTP_PORT: String(httpPort),
          CADDY_HTTPS_PORT: String(httpsPort),
        },
      },
    );
  }
  for (const volume of [`${project}-postgres`, `${project}-caddy-data`, `${project}-caddy-logs`])
    spawnSync('docker', ['volume', 'rm', '-f', volume]);
  spawnSync('docker', [
    'run',
    '--rm',
    '--user',
    '0:0',
    '--volume',
    `${fixture}:/fixture`,
    '--entrypoint',
    '/bin/sh',
    localImages.caddy,
    '-c',
    'rm -rf /fixture/*',
  ]);
  rmSync(fixture, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return result.stdout.trim();
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}
