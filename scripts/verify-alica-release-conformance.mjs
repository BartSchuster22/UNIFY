#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = resolve(import.meta.dirname, '..');
const executable = join(repository, 'deploy/five-service/release-conformance.mjs');
const library = join(repository, 'scripts/lib/alica-release-conformance.mjs');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'alica-release-conformance-'));
const project = `unify-conformance-${process.pid}`;

try {
  const source = `${readFileSync(executable, 'utf8')}\n${readFileSync(library, 'utf8')}`;
  for (const forbidden of [
    /spawnSync|execSync|execFileSync/u,
    /writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|mkdirSync/u,
    /\bfetch\s*\(|https?\.request/u,
  ])
    assert.doesNotMatch(
      source,
      forbidden,
      'Read-only adapter contains a forbidden mutation/network primitive',
    );

  const validRoot = buildFixture('valid');
  const before = snapshot(validRoot);
  const valid = runAdapter(validRoot);
  assert.equal(valid.execution.status, 0, valid.execution.stderr || valid.execution.stdout);
  assert.equal(valid.report.status, 'PASS');
  assert.equal(valid.report.mutationPerformed, false);
  assert.equal(valid.report.integrity.status, 'PASS');
  assert.equal(valid.report.targetConformance.status, 'PARTIAL');
  assert.equal(valid.report.projection.release.releaseId, 'legacy-release-v1');
  assert.equal(valid.report.projection.instance.instanceId, null);
  assert.ok(
    valid.report.targetConformance.missingCapabilities.includes('TUF trusted update metadata'),
  );
  assert.deepEqual(
    snapshot(validRoot),
    before,
    'Read-only adapter mutated the inspected installation',
  );

  const manifestTamper = buildFixture('manifest-tamper');
  writeFileSync(join(manifestTamper, 'manifests/legacy-release-v1.json'), '{}\n');
  assertFailure(manifestTamper, /state\/manifest digest mismatch/u);

  const definitionTamper = buildFixture('definition-tamper');
  writeFileSync(
    join(definitionTamper, 'releases/legacy-release-v1/deploy/five-service/compose.yaml'),
    'services: {tampered: {}}\n',
  );
  assertFailure(definitionTamper, /definition checksum mismatch/u);

  const traversal = buildFixture('definition-traversal', { definitionTraversal: true });
  assertFailure(traversal, /traverses outside release/u);

  const secretTamper = buildFixture('secret-tamper');
  writeFileSync(join(secretTamper, 'secrets/example-secret'), 'changed\n');
  assertFailure(secretTamper, /secret checksum mismatch/u);

  const backupTamper = buildFixture('backup-tamper');
  writeFileSync(join(backupTamper, 'backups/accepted.backup'), 'changed\n');
  assertFailure(backupTamper, /backup checksum mismatch/u);

  const wrongProject = runAdapter(validRoot, `${project}-wrong`);
  assert.notEqual(wrongProject.execution.status, 0);
  assert.match(wrongProject.report.error, /ownership project mismatch/u);

  const pointerTamper = buildFixture('pointer-tamper');
  rmSync(join(pointerTamper, 'current'));
  mkdirSync(join(pointerTamper, 'releases/not-current'), { recursive: true });
  symlinkSync(join(pointerTamper, 'releases/not-current'), join(pointerTamper, 'current'));
  assertFailure(pointerTamper, /current pointer mismatch/u);

  console.log(
    'ALICA release conformance adapter: PASS read-only=verified integrity=verified adversarial=6 target=partial',
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function buildFixture(name, options = {}) {
  const root = join(fixtureRoot, name);
  const releaseId = 'legacy-release-v1';
  const release = join(root, 'releases', releaseId);
  const secrets = join(root, 'secrets');
  const backups = join(root, 'backups');
  mkdirSync(join(release, 'deploy/five-service'), { recursive: true });
  mkdirSync(join(root, 'manifests'), { recursive: true });
  mkdirSync(secrets, { recursive: true });
  mkdirSync(backups, { recursive: true });

  const input = {
    schemaVersion: 'unify-five-service-installation/v1',
    releaseId,
    publicHost: 'localhost',
    publicOrigin: 'https://localhost',
    paths: {
      alicaData: join(root, 'data/alica'),
      hermanData: join(root, 'data/herman'),
      secrets,
      backups,
    },
    volumes: {
      postgres: `${project}-postgres`,
      caddyData: `${project}-caddy-data`,
      caddyLogs: `${project}-caddy-logs`,
    },
    images: {
      alicaHermesRuntime: `registry.invalid/alica@sha256:${'1'.repeat(64)}`,
      hermanHermesRuntime: `registry.invalid/herman@sha256:${'2'.repeat(64)}`,
      core: `registry.invalid/core@sha256:${'3'.repeat(64)}`,
      caddy: `registry.invalid/caddy@sha256:${'4'.repeat(64)}`,
    },
  };
  writeJson(join(release, 'installation-inputs.json'), input);
  writeFileSync(join(release, 'deploy/five-service/compose.yaml'), 'services: {}\n');
  writeFileSync(join(release, 'compose.resolved.yaml'), 'services: {}\n');
  writeFileSync(join(release, 'compose.env'), `COMPOSE_PROJECT_NAME=${project}\n`);

  const definitionHashes = Object.fromEntries(
    ['installation-inputs.json', 'deploy/five-service/compose.yaml', 'compose.env'].map((path) => [
      path,
      sha256(join(release, path)),
    ]),
  );
  if (options.definitionTraversal) definitionHashes['../outside'] = '0'.repeat(64);
  writeJson(join(release, 'release-definitions.json'), {
    schemaVersion: 'unify-release-definitions/v1',
    gitCommit: 'a'.repeat(40),
    definitionHashes,
  });

  writeFileSync(join(secrets, 'example-secret'), 'secret-value\n');
  writeFileSync(join(backups, 'accepted.backup'), 'verified-backup\n');
  const imageIds = Object.fromEntries(
    Object.entries(input.images).map(([componentId, reference], index) => [
      componentId,
      {
        reference,
        runtimeReference: reference,
        id: `sha256:${String(index + 5).repeat(64)}`,
      },
    ]),
  );
  const manifestPath = join(root, `manifests/${releaseId}.json`);
  writeJson(manifestPath, {
    schemaVersion: 'unify-installation-manifest/v1',
    releaseId,
    previousRelease: null,
    project,
    installedAt: '2026-08-19T00:00:00.000Z',
    inputSha256: sha256(join(release, 'installation-inputs.json')),
    composeSha256: sha256(join(release, 'compose.resolved.yaml')),
    definitionsSha256: sha256(join(release, 'release-definitions.json')),
    imagePolicy: { digestPinned: true, sbomGate: 'repository-production-image-policy' },
    imageIds,
    secretHashes: { 'example-secret': sha256(join(secrets, 'example-secret')) },
    backup: {
      path: join(backups, 'accepted.backup'),
      sha256: sha256(join(backups, 'accepted.backup')),
      reason: 'post-install',
      verified: true,
    },
  });
  const manifestDigest = sha256(manifestPath);
  writeFileSync(`${manifestPath}.sha256`, `${manifestDigest}  ${releaseId}.json\n`);
  writeJson(join(root, 'installer-owned.json'), {
    schemaVersion: 'unify-installer-ownership/v1',
    project,
    createdAt: '2026-08-19T00:00:00.000Z',
  });
  writeJson(join(root, 'installer-state.json'), {
    schemaVersion: 'unify-installer-state/v1',
    installationId: randomUUID(),
    project,
    currentRelease: releaseId,
    previousRelease: null,
    manifestSha256: manifestDigest,
    updatedAt: '2026-08-19T00:00:00.000Z',
  });
  symlinkSync(release, join(root, 'current'));
  return root;
}

function runAdapter(root, selectedProject = project) {
  const execution = spawnSync(
    process.execPath,
    [executable, '--root', root, '--project', selectedProject],
    { cwd: repository, encoding: 'utf8' },
  );
  return { execution, report: JSON.parse(execution.stdout) };
}

function assertFailure(root, pattern) {
  const before = snapshot(root);
  const { execution, report } = runAdapter(root);
  assert.notEqual(execution.status, 0);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.mutationPerformed, false);
  assert.match(report.error, pattern);
  assert.deepEqual(snapshot(root), before, 'Failed inspection mutated installation');
}

function snapshot(root) {
  const records = {};
  walk(root);
  return records;

  function walk(path) {
    const key = relative(root, path) || '.';
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      records[key] = { type: 'symlink', target: readlinkSync(path), mode: stat.mode & 0o7777 };
      return;
    }
    if (stat.isDirectory()) {
      records[key] = { type: 'directory', mode: stat.mode & 0o7777 };
      for (const name of readdirSync(path).sort()) walk(join(path, name));
      return;
    }
    records[key] = { type: 'file', mode: stat.mode & 0o7777, sha256: sha256(path) };
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
