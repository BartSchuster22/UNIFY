import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

import { validateInstallationInput } from './five-service-installation.mjs';

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const bareDigestPattern = /^[a-f0-9]{64}$/u;
const releaseIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const projectPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/u;

export function inspectFiveServiceRelease({ root, project = 'unify' }) {
  assert.equal(typeof root, 'string', 'root must be a string');
  assert.ok(isAbsolute(root), 'root must be absolute');
  assert.match(project, projectPattern, 'project is invalid');

  const managedRoot = realpathSync(root);
  const checks = [];
  const check = (name, operation) => {
    operation();
    checks.push({ name, status: 'PASS' });
  };

  let ownership;
  check('ownership', () => {
    ownership = readJsonFile(inside(managedRoot, 'installer-owned.json'));
    assert.equal(ownership.schemaVersion, 'unify-installer-ownership/v1');
    assert.equal(ownership.project, project, 'ownership project mismatch');
  });

  let state;
  check('installer-state', () => {
    state = readJsonFile(inside(managedRoot, 'installer-state.json'));
    assert.equal(state.schemaVersion, 'unify-installer-state/v1');
    assert.equal(state.project, project, 'state project mismatch');
    assert.match(state.installationId, /^[0-9a-f-]{36}$/u, 'legacy installation ID is invalid');
    assert.match(state.currentRelease, releaseIdPattern, 'current release ID is invalid');
    assert.match(state.manifestSha256, bareDigestPattern, 'state manifest digest is invalid');
    if (state.previousRelease !== null)
      assert.match(state.previousRelease, releaseIdPattern, 'previous release ID is invalid');
  });

  const releaseDirectory = inside(managedRoot, `releases/${state.currentRelease}`);
  check('current-pointer', () => {
    const currentPath = inside(managedRoot, 'current');
    assert.ok(lstatSync(currentPath).isSymbolicLink(), 'current pointer is not a symlink');
    assert.equal(
      realpathSync(currentPath),
      realpathSync(releaseDirectory),
      'current pointer mismatch',
    );
  });

  let input;
  check('installation-inputs', () => {
    input = validateInstallationInput(
      readJsonFile(inside(releaseDirectory, 'installation-inputs.json')),
    );
    assert.equal(input.releaseId, state.currentRelease, 'input release ID mismatch');
  });

  let definitions;
  check('release-definitions', () => {
    definitions = readJsonFile(inside(releaseDirectory, 'release-definitions.json'));
    assert.equal(definitions.schemaVersion, 'unify-release-definitions/v1');
    assert.match(definitions.gitCommit, /^[a-f0-9]{40}$/u, 'definition Git commit is invalid');
    assertPlainObject(definitions.definitionHashes, 'definition hashes');
    assert.ok(Object.keys(definitions.definitionHashes).length > 0, 'definition hashes are empty');
    for (const [name, expected] of Object.entries(definitions.definitionHashes)) {
      assertSafeRelativeFile(name, 'definition path');
      assert.match(expected, bareDigestPattern, `definition digest is invalid: ${name}`);
      const path = inside(releaseDirectory, name);
      assert.ok(lstatSync(path).isFile(), `definition is not a regular file: ${name}`);
      assert.equal(sha256(path), expected, `definition checksum mismatch: ${name}`);
    }
  });

  let manifest;
  let manifestDigest;
  const manifestPath = inside(managedRoot, `manifests/${state.currentRelease}.json`);
  check('accepted-manifest', () => {
    manifestDigest = sha256(manifestPath);
    assert.equal(manifestDigest, state.manifestSha256, 'state/manifest digest mismatch');
    assert.equal(
      readDigestSidecar(`${manifestPath}.sha256`, basename(manifestPath)),
      manifestDigest,
      'manifest sidecar mismatch',
    );
    manifest = readJsonFile(manifestPath);
    assert.equal(manifest.schemaVersion, 'unify-installation-manifest/v1');
    assert.equal(manifest.releaseId, state.currentRelease, 'manifest release ID mismatch');
    assert.equal(manifest.project, project, 'manifest project mismatch');
    assert.equal(
      manifest.inputSha256,
      sha256(inside(releaseDirectory, 'installation-inputs.json')),
      'manifest input digest mismatch',
    );
    assert.equal(
      manifest.composeSha256,
      sha256(inside(releaseDirectory, 'compose.resolved.yaml')),
      'manifest resolved Compose digest mismatch',
    );
    assert.equal(
      manifest.definitionsSha256,
      sha256(inside(releaseDirectory, 'release-definitions.json')),
      'manifest definition digest mismatch',
    );
    assert.equal(
      manifest.imagePolicy?.digestPinned,
      true,
      'manifest image policy is not digest-pinned',
    );
  });

  check('image-declarations', () => {
    assertPlainObject(manifest.imageIds, 'manifest image IDs');
    assert.deepEqual(
      Object.keys(manifest.imageIds).sort(),
      Object.keys(input.images).sort(),
      'manifest/input image set mismatch',
    );
    for (const [name, declaredReference] of Object.entries(input.images)) {
      const record = manifest.imageIds[name];
      assert.equal(record?.reference, declaredReference, `image reference mismatch: ${name}`);
      assert.match(
        declaredReference,
        /@sha256:[a-f0-9]{64}$/u,
        `image is not digest-pinned: ${name}`,
      );
      assert.equal(
        typeof record.runtimeReference,
        'string',
        `runtime image reference missing: ${name}`,
      );
      assert.match(record.id, digestPattern, `runtime image ID is invalid: ${name}`);
    }
  });

  check('secret-integrity', () => {
    assertPlainObject(manifest.secretHashes, 'secret hashes');
    assert.ok(Object.keys(manifest.secretHashes).length > 0, 'secret hashes are empty');
    for (const [name, expected] of Object.entries(manifest.secretHashes)) {
      assertSafeBasename(name, 'secret name');
      assert.match(expected, bareDigestPattern, `secret digest is invalid: ${name}`);
      const path = inside(input.paths.secrets, name);
      assert.ok(lstatSync(path).isFile(), `secret is not a regular file: ${name}`);
      assert.equal(sha256(path), expected, `secret checksum mismatch: ${name}`);
    }
  });

  check('backup-evidence', () => {
    assert.equal(manifest.backup?.verified, true, 'accepted backup is not verified');
    assert.equal(typeof manifest.backup.path, 'string', 'backup path is missing');
    assert.ok(isAbsolute(manifest.backup.path), 'backup path must be absolute');
    assert.match(manifest.backup.sha256, bareDigestPattern, 'backup digest is invalid');
    assert.ok(lstatSync(manifest.backup.path).isFile(), 'backup is not a regular file');
    assert.equal(sha256(manifest.backup.path), manifest.backup.sha256, 'backup checksum mismatch');
  });

  check('rollback-pointer', () => {
    const rollbackPath = inside(managedRoot, 'rollback');
    if (state.previousRelease === null) {
      assert.equal(
        existsSync(rollbackPath),
        false,
        'rollback pointer exists without previous release',
      );
      return;
    }
    const previousDirectory = inside(managedRoot, `releases/${state.previousRelease}`);
    assert.ok(lstatSync(rollbackPath).isSymbolicLink(), 'rollback pointer is not a symlink');
    assert.equal(
      realpathSync(rollbackPath),
      realpathSync(previousDirectory),
      'rollback pointer mismatch',
    );
  });

  const components = Object.entries(input.images)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([componentId, artifact]) => ({
      componentId,
      artifact,
      runtimeImageId: manifest.imageIds[componentId].id,
      provenance: 'UNDECLARED',
      sbom: 'UNDECLARED',
      signaturePolicy: 'UNDECLARED',
    }));

  return {
    schemaVersion: 'alica-release-conformance-report/v1',
    generatedAt: new Date().toISOString(),
    operation: 'read-only-inspection',
    mutationPerformed: false,
    status: 'PASS',
    integrity: { status: 'PASS', checks },
    source: {
      contract: 'unify-installation-manifest/v1',
      root: managedRoot,
      project,
      manifestDigest: `sha256:${manifestDigest}`,
      definitionGitCommit: definitions.gitCommit,
    },
    projection: {
      schemaVersion: 'alica-release-read-only-projection/v1',
      cellContract: 'alica-cell/v0.1',
      releaseContract: 'alica-release/v0.1',
      profile: 'legacy-current/v1',
      instance: {
        instanceId: null,
        legacyInstallationId: state.installationId,
      },
      release: {
        releaseId: state.currentRelease,
        releaseVersion: null,
        manifestDigest: `sha256:${manifestDigest}`,
        channel: null,
      },
      acceptedCurrent: {
        releaseId: state.currentRelease,
        previousReleaseId: state.previousRelease,
        stateUpdatedAt: state.updatedAt,
      },
      observed: {
        releaseId: state.currentRelease,
        currentPointer: readlinkSync(inside(managedRoot, 'current')),
        definitionIntegrity: 'PASS',
        secretIntegrity: 'PASS',
        backupIntegrity: 'PASS',
      },
      components,
    },
    targetConformance: {
      status: 'PARTIAL',
      missingCapabilities: [
        'typed immutable Cell instance_id',
        'strict alica-release/v1 canonical manifest',
        'TUF trusted update metadata',
        'artifact signature policy',
        'bound SBOM and SLSA provenance',
        'directional compatibility edge and migration DAG',
        'separate requested/accepted desired state',
        'whole-Cell Identity Authority component',
        'whole-Cell MemoryV4 component and coordinated recovery',
        'governed AInbA runtime component',
        'integrated Doghouse Node component',
      ],
    },
  };
}

function readJsonFile(path) {
  const raw = readFileSync(path, 'utf8');
  assert.ok(!raw.startsWith('\uFEFF'), `JSON BOM is forbidden: ${basename(path)}`);
  const value = JSON.parse(raw);
  assertPlainObject(value, basename(path));
  return value;
}

function readDigestSidecar(path, expectedName) {
  const match = /^([a-f0-9]{64}) {2}([^\n]+)\n?$/u.exec(readFileSync(path, 'utf8'));
  assert.ok(match, 'digest sidecar format is invalid');
  assert.equal(match[2], expectedName, 'digest sidecar filename mismatch');
  return match[1];
}

function assertPlainObject(value, name) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${name} must be an object`,
  );
}

function assertSafeBasename(value, name) {
  assert.equal(typeof value, 'string', `${name} must be a string`);
  assert.equal(value, basename(value), `${name} must be a basename`);
  assert.ok(value !== '.' && value !== '..' && !value.includes('\0'), `${name} is unsafe`);
}

function assertSafeRelativeFile(value, name) {
  assert.equal(typeof value, 'string', `${name} must be a string`);
  assert.ok(value.length > 0 && !isAbsolute(value) && !value.includes('\0'), `${name} is unsafe`);
  const normalized = resolve('/', value);
  assert.ok(normalized !== '/' && !normalized.startsWith('/../'), `${name} is unsafe`);
  assert.ok(!value.split(/[\\/]/u).includes('..'), `${name} traverses outside release`);
}

function inside(root, relativePath) {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  const rel = relative(resolvedRoot, target);
  assert.ok(
    rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    'path escapes authority root',
  );
  return target;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
