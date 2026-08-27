#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const freezePath = resolve(root, 'dsh/product/alica-community-dsh-1.0.freeze.json');
const schemaPath = resolve(root, 'dsh/product/alica-dsh-product-freeze-v1.schema.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function keysEqual(actual, expected) {
  return JSON.stringify([...Object.keys(actual).sort()]) === JSON.stringify([...expected].sort());
}

function validate(freeze, { verifyFiles = true } = {}) {
  const errors = [];
  const requireObject = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return false;
    }
    return true;
  };
  const exactKeys = (value, expected, path) => {
    if (requireObject(value, path) && !keysEqual(value, expected)) {
      errors.push(`${path} keys must be exactly: ${expected.join(', ')}`);
    }
  };
  const equal = (actual, expected, path) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`${path} must equal ${JSON.stringify(expected)}`);
    }
  };
  const exactArray = (actual, expected, path) => {
    if (!Array.isArray(actual)) {
      errors.push(`${path} must be an array`);
      return;
    }
    if (new Set(actual).size !== actual.length) errors.push(`${path} must contain unique entries`);
    equal(actual, expected, path);
  };

  exactKeys(
    freeze,
    [
      '$schema',
      'schema_version',
      'status',
      'effective_date',
      'product',
      'license',
      'platform',
      'distribution',
      'capabilities',
      'dependencies',
      'authorities',
    ],
    '$',
  );
  equal(freeze.$schema, './alica-dsh-product-freeze-v1.schema.json', '$.$schema');
  equal(freeze.schema_version, 'alica-dsh-product-freeze/v1', '$.schema_version');
  equal(freeze.status, 'frozen', '$.status');
  equal(freeze.effective_date, '2026-08-27', '$.effective_date');

  exactKeys(
    freeze.product,
    [
      'id',
      'name',
      'edition',
      'release_line',
      'initial_version',
      'cell_contract',
      'profile',
      'origin',
      'management',
      'price',
      'source_policy',
    ],
    '$.product',
  );
  const product = {
    id: 'com.alica.community-dsh',
    name: 'ALICA Community DSH',
    edition: 'Community DSH',
    release_line: '1.0',
    initial_version: '1.0.0',
    cell_contract: 'alica-cell/v0.1',
    profile: 'dsh-minimal/v1',
    origin: 'dsh',
    management: 'local-only',
    price: 'free-of-charge',
    source_policy: 'proprietary-closed-source',
  };
  for (const [key, value] of Object.entries(product))
    equal(freeze.product?.[key], value, `$.product.${key}`);

  exactKeys(
    freeze.license,
    [
      'licensor',
      'jurisdiction',
      'first_party_source',
      'first_party_binary',
      'eula_path',
      'eula_sha256',
      'third_party_policy',
    ],
    '$.license',
  );
  const license = {
    licensor: 'ALICA Ltd',
    jurisdiction: 'Hong Kong Special Administrative Region',
    first_party_source: 'proprietary-all-rights-reserved',
    first_party_binary: 'ALICA-Community-DSH-EULA-1.0',
    eula_path: 'licenses/ALICA-COMMUNITY-DSH-EULA-1.0.md',
    third_party_policy: 'retain-upstream-rights-and-bundle-exact-notices',
  };
  for (const [key, value] of Object.entries(license))
    equal(freeze.license?.[key], value, `$.license.${key}`);
  if (!/^[a-f0-9]{64}$/.test(freeze.license?.eula_sha256 ?? '')) {
    errors.push('$.license.eula_sha256 must be lowercase SHA-256');
  }

  exactKeys(
    freeze.platform,
    ['os', 'architecture', 'runtime', 'compose', 'init', 'minimum'],
    '$.platform',
  );
  const platform = {
    os: 'debian-13',
    architecture: 'linux-amd64',
    runtime: 'docker-engine-community>=28.4.0<29.0.0',
    compose: 'docker-compose-plugin>=2.39.4<3.0.0',
    init: 'systemd',
  };
  for (const [key, value] of Object.entries(platform))
    equal(freeze.platform?.[key], value, `$.platform.${key}`);
  exactKeys(
    freeze.platform?.minimum,
    ['vcpu', 'memory_gib', 'free_disk_gib'],
    '$.platform.minimum',
  );
  equal(
    freeze.platform?.minimum,
    { vcpu: 4, memory_gib: 8, free_disk_gib: 100 },
    '$.platform.minimum',
  );

  exactKeys(
    freeze.distribution,
    ['online', 'offline', 'end_user_source_checkout', 'private_credentials'],
    '$.distribution',
  );
  equal(
    freeze.distribution,
    {
      online: 'tuf+oci',
      offline: 'oci-layout-tar.zst',
      end_user_source_checkout: false,
      private_credentials: false,
    },
    '$.distribution',
  );

  const included = [
    'caddy-ingress',
    'uniui',
    'unify-gateway-core',
    'keycloak-identity-authority',
    'postgresql',
    'alica-framework',
    'herman-framework',
    'memory-v4',
    'anchor-ainba',
    'doghouse-report-only',
    'alicactl',
    'profile-required-operations-jobs',
  ];
  const excluded = [
    'psi-dependency',
    'uprm-dependency',
    'fleet-dependency',
    'modelm8-dependency',
    'aquiero-hosted-runtime-dependency',
    'kubernetes-runtime',
    'multi-node-high-availability',
    'public-marketplace',
    'third-party-managed-hosting-rights',
    'automatic-doghouse-repair',
    'dsh-standard-v1-claim',
    'arm64-host',
    'non-debian-host',
  ];
  exactKeys(freeze.capabilities, ['included', 'excluded'], '$.capabilities');
  exactArray(freeze.capabilities?.included, included, '$.capabilities.included');
  exactArray(freeze.capabilities?.excluded, excluded, '$.capabilities.excluded');

  exactKeys(freeze.dependencies, ['central_runtime', 'provider_modes'], '$.dependencies');
  exactArray(freeze.dependencies?.central_runtime, [], '$.dependencies.central_runtime');
  exactArray(
    freeze.dependencies?.provider_modes,
    ['local-byok', 'local-model-endpoint'],
    '$.dependencies.provider_modes',
  );

  exactKeys(
    freeze.authorities,
    [
      'product_governance',
      'release_truth',
      'local_lifecycle',
      'runtime_realization',
      'local_operator',
    ],
    '$.authorities',
  );
  equal(
    freeze.authorities,
    {
      product_governance: 'PROJECT-ALICA',
      release_truth: 'signed-whole-cell-manifest',
      local_lifecycle: 'alicactl',
      runtime_realization: 'generated-docker-compose',
      local_operator: 'final-authority',
    },
    '$.authorities',
  );

  if (verifyFiles && typeof freeze.license?.eula_path === 'string') {
    const eulaPath = resolve(root, freeze.license.eula_path);
    if (!eulaPath.startsWith(`${root}${sep}`)) {
      errors.push('EULA path escapes repository root');
    } else {
      try {
        const eula = readFileSync(eulaPath);
        const hash = createHash('sha256').update(eula).digest('hex');
        equal(hash, freeze.license.eula_sha256, 'EULA SHA-256');
        const text = eula.toString('utf8');
        for (const marker of [
          'ALICA Ltd',
          'Hong Kong Special Administrative Region',
          'free self-hosting license',
          'Third-party software',
        ]) {
          if (!text.toLowerCase().includes(marker.toLowerCase()))
            errors.push(`EULA missing marker: ${marker}`);
        }
      } catch (error) {
        errors.push(`EULA cannot be read: ${error.message}`);
      }
    }

    const required = [
      'LICENSE',
      'THIRD-PARTY-NOTICES.md',
      'docs/dsh/D0-PRODUCT-AND-LICENSE-FREEZE.md',
      'dsh/product/alica-dsh-product-freeze-v1.schema.json',
    ];
    for (const path of required) {
      try {
        readFileSync(resolve(root, path));
      } catch {
        errors.push(`required D0 artifact missing: ${path}`);
      }
    }

    try {
      const rootPackage = readJson(resolve(root, 'package.json'));
      if (rootPackage.private !== true)
        errors.push('root package must remain private under the frozen source policy');
    } catch (error) {
      errors.push(`root package cannot be read: ${error.message}`);
    }
  }

  return errors;
}

function assertRejected(base, mutate, expectedFragment, { verifyFiles = false } = {}) {
  const candidate = clone(base);
  mutate(candidate);
  const errors = validate(candidate, { verifyFiles });
  if (!errors.some((error) => error.includes(expectedFragment))) {
    throw new Error(`negative self-test did not reject ${expectedFragment}: ${errors.join('; ')}`);
  }
}

const freeze = readJson(freezePath);
readJson(schemaPath);
const errors = validate(freeze);
if (errors.length) {
  console.error('DSH D0 freeze verification FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

assertRejected(
  freeze,
  (x) => {
    x.product.profile = 'dsh-standard/v1';
  },
  '$.product.profile',
);
assertRejected(
  freeze,
  (x) => {
    x.dependencies.central_runtime = ['psi'];
  },
  '$.dependencies.central_runtime',
);
assertRejected(
  freeze,
  (x) => {
    x.license.eula_sha256 = '0'.repeat(64);
  },
  'EULA SHA-256',
  { verifyFiles: true },
);
assertRejected(
  freeze,
  (x) => {
    x.distribution.end_user_source_checkout = true;
  },
  '$.distribution',
);
assertRejected(
  freeze,
  (x) => {
    x.unknown = true;
  },
  '$ keys',
);

const result = {
  status: 'PASS',
  phase: 'D0',
  schema_version: freeze.schema_version,
  product: freeze.product.name,
  version: freeze.product.initial_version,
  profile: freeze.product.profile,
  platform: `${freeze.platform.os}/${freeze.platform.architecture}`,
  source_policy: freeze.product.source_policy,
  binary_license: freeze.license.first_party_binary,
  eula_sha256: freeze.license.eula_sha256,
  central_runtime_dependencies: freeze.dependencies.central_runtime.length,
  negative_tests: 5,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else
  console.log(
    `DSH D0 freeze verification PASS: ${result.product} ${result.version}; ${result.profile}; ${result.platform}; ${result.negative_tests} negative tests`,
  );
