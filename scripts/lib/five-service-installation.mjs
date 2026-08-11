import assert from 'node:assert/strict';
import { isAbsolute, normalize } from 'node:path';

const allowedTop = new Set([
  'schemaVersion',
  'releaseId',
  'publicHost',
  'publicOrigin',
  'paths',
  'volumes',
  'images',
]);

export function validateInstallationInput(input) {
  assertObject(input, 'installation inputs');
  assert.deepEqual(
    Object.keys(input).sort(),
    [...allowedTop].sort(),
    'Unexpected installation fields',
  );
  assert.equal(input.schemaVersion, 'unify-five-service-installation/v1');
  assertString(input.releaseId, 'releaseId', /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u);
  assertString(
    input.publicHost,
    'publicHost',
    /^(?=.{1,253}$)(?:localhost|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/u,
  );
  assert.equal(input.publicOrigin, `https://${input.publicHost}`);

  assertExactObject(input.paths, ['alicaData', 'hermanData', 'secrets', 'backups'], 'paths');
  const paths = Object.entries(input.paths).map(([name, value]) => {
    assertString(value, `paths.${name}`, /^\/[a-zA-Z0-9_./-]+$/u);
    assert.ok(isAbsolute(value), 'Installation paths must be absolute');
    const normalized = normalize(value);
    assert.notEqual(normalized, '/');
    return normalized;
  });
  assert.equal(new Set(paths).size, paths.length, 'Installation paths must be distinct');
  for (let left = 0; left < paths.length; left += 1)
    for (let right = left + 1; right < paths.length; right += 1)
      assert.ok(
        !paths[left].startsWith(`${paths[right]}/`) && !paths[right].startsWith(`${paths[left]}/`),
        'Installation paths must not contain one another',
      );

  assertExactObject(input.volumes, ['postgres', 'caddyData', 'caddyLogs'], 'volumes');
  for (const [name, value] of Object.entries(input.volumes))
    assertString(value, `volumes.${name}`, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u);
  assert.equal(new Set(Object.values(input.volumes)).size, 3, 'Volume names must be distinct');

  const imageKeys = Object.keys(input.images).sort();
  const legacyImages =
    JSON.stringify(imageKeys) === JSON.stringify(['caddy', 'core', 'hermesRuntime']);
  const splitImages =
    JSON.stringify(imageKeys) ===
    JSON.stringify(['alicaHermesRuntime', 'caddy', 'core', 'hermanHermesRuntime']);
  assert.ok(legacyImages || splitImages, 'images fields are invalid');
  for (const [name, value] of Object.entries(input.images))
    assertString(value, `images.${name}`, /^[^\s:@]+(?:[/:][^\s:@]+)*@sha256:[a-f0-9]{64}$/u);

  const valid = structuredClone(input);
  if (legacyImages) {
    valid.images = {
      alicaHermesRuntime: input.images.hermesRuntime,
      hermanHermesRuntime: input.images.hermesRuntime,
      core: input.images.core,
      caddy: input.images.caddy,
    };
  }
  return valid;
}

export function composeEnvironment(input) {
  const valid = validateInstallationInput(input);
  return {
    RELEASE_ID: valid.releaseId,
    UNIFY_PUBLIC_HOST: valid.publicHost,
    UNIFY_PUBLIC_ORIGIN: valid.publicOrigin,
    ALICA_DATA_PATH: normalize(valid.paths.alicaData),
    HERMAN_DATA_PATH: normalize(valid.paths.hermanData),
    SECRETS_DIR: normalize(valid.paths.secrets),
    BACKUP_DIR: normalize(valid.paths.backups),
    UNIFY_POSTGRES_VOLUME: valid.volumes.postgres,
    CADDY_DATA_VOLUME: valid.volumes.caddyData,
    CADDY_LOGS_VOLUME: valid.volumes.caddyLogs,
    HERMES_RUNTIME_IMAGE: valid.images.alicaHermesRuntime,
    ALICA_HERMES_RUNTIME_IMAGE: valid.images.alicaHermesRuntime,
    HERMAN_HERMES_RUNTIME_IMAGE: valid.images.hermanHermesRuntime,
    UNIFY_CORE_IMAGE: valid.images.core,
    CADDY_IMAGE: valid.images.caddy,
  };
}

function assertObject(value, name) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${name} must be an object`,
  );
}

function assertExactObject(value, keys, name) {
  assertObject(value, name);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${name} fields are invalid`);
}

function assertString(value, name, pattern) {
  assert.equal(typeof value, 'string', `${name} must be a string`);
  assert.ok(value.length > 0, `${name} must not be empty`);
  if (pattern) assert.match(value, pattern, `${name} has an invalid format`);
}
