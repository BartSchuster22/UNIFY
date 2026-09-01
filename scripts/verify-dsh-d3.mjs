import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const moduleRoot = join(root, 'dsh/alicactl');
const testdata = join(moduleRoot, 'testdata');
const temp = mkdtempSync(join(tmpdir(), 'alica-d3-verify-'));
const go = '/tmp/go1.27.0/bin/go';
const expectedDigest = 'sha256:b4728dd7a729d91ea767849639a9dfb921eded0ee9e9bd19cd9db3c0ad579142';
function fail(message) {
  throw new Error(`D3 verification failed: ${message}`);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  if (!(options.expected ?? [0]).includes(result.status))
    fail(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  return result;
}
const generated = run('python3', ['scripts/generate-dsh-d3-fixture.py', '--check']);
if (!generated.stdout.includes(expectedDigest)) fail('fixture digest changed');
run(go, ['test', '-race', '-cover', './...'], { cwd: moduleRoot });
const binaryA = join(temp, 'alicactl-a'),
  binaryB = join(temp, 'alicactl-b');
for (const binary of [binaryA, binaryB])
  run(go, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', binary, './cmd/alicactl'], {
    cwd: moduleRoot,
    env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
  });
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
if (hash(binaryA) !== hash(binaryB)) fail('binary is not reproducible');
const fakeDocker = join(temp, 'docker');
writeFileSync(
  fakeDocker,
  `#!/bin/sh\nset -eu\nprintf '%s\\n' "$*" >> "$ALICA_D3_DOCKER_LOG"\nif [ "$1" = version ]; then echo 28.4.0; exit 0; fi\nif [ "$1" = image ] && [ "$2" = inspect ]; then echo sha256:${'1'.repeat(64)}; exit 0; fi\nif [ "$1" = compose ] && printf '%s' "$*" | grep -q 'ps --services --status running'; then printf '%s\\n' ainba-anchor alica caddy doghouse-node herman keycloak memory-v4 postgresql unify-core uniui; fi\nexit 0\n`,
);
chmodSync(fakeDocker, 0o700);
const credential = join(temp, 'provider-api-key');
writeFileSync(credential, 'd3-test-provider-key\n');
chmodSync(credential, 0o600);
const requestValue = JSON.parse(
  readFileSync(join(testdata, 'd3-clean-install.request.json'), 'utf8'),
);
requestValue.installationRoot = join(temp, 'cell');
requestValue.provider.credentialFile = credential;
const request = join(temp, 'request.json');
writeFileSync(request, JSON.stringify(requestValue, null, 2) + '\n');
const common = [
  '--manifest',
  join(testdata, 'd3-contract.manifest.json'),
  '--signature',
  join(testdata, 'd3-contract.manifest.signature.json'),
  '--public-key',
  join(testdata, 'd3-test-public-key.json'),
  '--request',
  request,
  '--json',
];
const env = {
  ALICACTL_INSTALL_TEST_MODE: '1',
  ALICACTL_INSTALL_FAKE_RUNTIME: '1',
  ALICACTL_DOCKER_BIN: fakeDocker,
  ALICA_D3_DOCKER_LOG: join(temp, 'docker.log'),
};
const plan = JSON.parse(run(binaryA, ['plan', ...common], { env }).stdout);
if (plan.mutationPerformed || existsSync(requestValue.installationRoot)) fail('plan mutated');
const installed = JSON.parse(run(binaryA, ['install', ...common], { env }).stdout);
if (installed.components.length !== 10 || !installed.changed)
  fail('minimum Cell did not install exactly ten runtime components');
const release = join(requestValue.installationRoot, 'release');
for (const name of [
  'ainba-anchor.mjs',
  'doghouse-node.mjs',
  'provider-config.json',
  'secrets/provider-api-key',
])
  if (!existsSync(join(release, name))) fail(`missing ${name}`);
const compose = readFileSync(join(release, 'compose.yaml'), 'utf8');
if (
  compose.includes('docker.sock') ||
  !compose.includes('com.alica.mode: report-only') ||
  !compose.includes('profiles: [minimum-cell]')
)
  fail('governed service constraints absent');
const publicMaterial = [
  'compose.yaml',
  'compose.env',
  'provider-config.json',
  'ainba-anchor.mjs',
  'doghouse-node.mjs',
]
  .map((n) => readFileSync(join(release, n), 'utf8'))
  .join('\n');
if (publicMaterial.includes('d3-test-provider-key')) fail('BYOK credential leaked');
if (
  !compose.match(/ainba-anchor:[\s\S]*networks: \[application\]/) ||
  !compose.match(/doghouse-node:[\s\S]*networks: \[application\]/)
)
  fail('minimum-Cell services have a central/egress dependency');
const noop = JSON.parse(run(binaryA, ['install', ...common], { env }).stdout);
if (noop.changed || noop.mutationPerformed) fail('reinstall was not a no-op');
const missing = { ...requestValue };
delete missing.provider;
const missingPath = join(temp, 'missing-provider.json');
writeFileSync(missingPath, JSON.stringify(missing));
run(
  binaryA,
  [
    'plan',
    '--manifest',
    common[1],
    '--signature',
    common[3],
    '--public-key',
    common[5],
    '--request',
    missingPath,
  ],
  { env, expected: [2] },
);
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      phase: 'D3',
      manifestDigest: expectedDigest,
      components: 10,
      anchorAInBALifecycle: true,
      doghouseReportOnly: true,
      localBYOK: true,
      noCentralRuntimeDependency: true,
      reproducibleBinarySha256: hash(binaryA),
    },
    null,
    2,
  ),
);
