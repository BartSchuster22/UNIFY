import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const moduleRoot = join(root, 'dsh/alicactl');
const testdata = join(moduleRoot, 'testdata');
const temp = mkdtempSync(join(tmpdir(), 'alica-d2-verify-'));
const go = '/tmp/go1.27.0/bin/go';
const gofmt = '/tmp/go1.27.0/bin/gofmt';
const manifest = join(testdata, 'd2-contract.manifest.json');
const signature = join(testdata, 'd2-contract.manifest.signature.json');
const publicKey = join(testdata, 'd2-test-public-key.json');
const expectedDigest = 'sha256:fc6ea858b259ae8c5155c6be2ac30aabc7a3965f7da24da8f5301b5fb207d262';

function fail(message) {
  throw new Error(`D2 verification failed: ${message}`);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  const expected = options.expected ?? [0];
  if (!expected.includes(result.status))
    fail(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  return result;
}
function walk(path) {
  const out = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}
function fingerprint(path) {
  if (!existsSync(path)) return 'absent';
  const hash = createHash('sha256');
  for (const file of walk(path).sort()) {
    hash.update(file.slice(path.length));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

const generated = run('python3', ['scripts/generate-dsh-d2-fixture.py', '--check']);
if (!generated.stdout.includes(expectedDigest)) fail('fixture digest changed');
const goFiles = walk(moduleRoot).filter((path) => path.endsWith('.go'));
if (run(gofmt, ['-d', ...goFiles]).stdout.trim()) fail('gofmt produced a diff');
run(go, ['vet', './...'], { cwd: moduleRoot });
run(go, ['test', '-race', '-cover', './...'], { cwd: moduleRoot });
const binaryA = join(temp, 'alicactl-a');
const binaryB = join(temp, 'alicactl-b');
for (const binary of [binaryA, binaryB])
  run(go, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', binary, './cmd/alicactl'], {
    cwd: moduleRoot,
    env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
  });
if (
  createHash('sha256').update(readFileSync(binaryA)).digest('hex') !==
  createHash('sha256').update(readFileSync(binaryB)).digest('hex')
)
  fail('static build is not reproducible');

const fakeDocker = join(temp, 'docker');
writeFileSync(
  fakeDocker,
  `#!/bin/sh\nset -eu\nprintf '%s\\n' "$*" >> "$ALICA_D2_DOCKER_LOG"\nif [ "$1" = version ]; then echo 28.4.0; exit 0; fi\nif [ "$1" = image ] && [ "$2" = inspect ]; then echo sha256:${'1'.repeat(64)}; exit 0; fi\nif [ "\${ALICA_D2_FAIL:-0}" = 1 ] && [ "$1" = compose ] && printf '%s' "$*" | grep -q 'up -d --wait postgresql'; then echo injected >&2; exit 9; fi\nif [ "$1" = compose ] && printf '%s' "$*" | grep -q 'ps --services --status running'; then printf '%s\\n' alica caddy herman keycloak memory-v4 postgresql unify-core uniui; fi\nexit 0\n`,
);
chmodSync(fakeDocker, 0o755);
const baseRequest = JSON.parse(
  readFileSync(join(testdata, 'd2-clean-install.request.json'), 'utf8'),
);
const cellRoot = join(temp, 'clean-host', 'var/lib/alica');
baseRequest.installationRoot = cellRoot;
const request = join(temp, 'request.json');
writeFileSync(request, `${JSON.stringify(baseRequest, null, 2)}\n`);
const common = [
  '--manifest',
  manifest,
  '--signature',
  signature,
  '--public-key',
  publicKey,
  '--request',
  request,
  '--json',
];
const env = {
  ALICACTL_INSTALL_TEST_MODE: '1',
  ALICACTL_INSTALL_FAKE_RUNTIME: '1',
  ALICACTL_DOCKER_BIN: fakeDocker,
  ALICA_D2_DOCKER_LOG: join(temp, 'docker.log'),
};
const plan = JSON.parse(run(binaryA, ['plan', ...common], { env }).stdout);
if (plan.status !== 'PASS' || plan.mutationPerformed || existsSync(cellRoot))
  fail('plan was not read-only');
const installed = JSON.parse(run(binaryA, ['install', ...common], { env }).stdout);
if (installed.status !== 'PASS' || !installed.changed || !installed.mutationPerformed)
  fail('install did not report one mutation');
for (const path of [
  'accepted/cell-declaration.json',
  'accepted/lifecycle-state.json',
  'accepted/operation-journal.json',
  'release/compose.yaml',
  'release/compose.env',
])
  if (!existsSync(join(cellRoot, path))) fail(`missing accepted artifact ${path}`);
for (const legacy of ['cell-declaration.json', 'lifecycle-state.json', 'operation-journal.json'])
  if (existsSync(join(cellRoot, legacy))) fail(`non-atomic legacy state survived: ${legacy}`);
const journal = JSON.parse(readFileSync(join(cellRoot, 'accepted/operation-journal.json'), 'utf8'));
if (
  journal.entries.map((entry) => entry.phase).join(',') !==
  'planned,preflight,running,verify,accepted'
)
  fail('journal phase sequence is not exact');
const beforeNoop = fingerprint(cellRoot);
const noop = JSON.parse(run(binaryA, ['install', ...common], { env }).stdout);
if (noop.changed || noop.mutationPerformed || fingerprint(cellRoot) !== beforeNoop)
  fail('same-release reinstall was not a verified no-op');
const secretValues = walk(join(cellRoot, 'release/secrets'))
  .map((path) => readFileSync(path, 'utf8').trim())
  .filter((value) => value.length > 12);
const publicMaterial = [
  'accepted/cell-declaration.json',
  'accepted/lifecycle-state.json',
  'accepted/operation-journal.json',
  'release/compose.yaml',
  'release/compose.env',
  'release/Caddyfile',
]
  .map((path) => readFileSync(join(cellRoot, path), 'utf8'))
  .join('\n');
if (secretValues.some((value) => publicMaterial.includes(value)))
  fail('generated secret leaked into lifecycle/runtime definition');

const failedRoot = join(temp, 'failed-host', 'var/lib/alica');
const failedRequest = {
  ...baseRequest,
  cellId: 'ins_0198f8e0-6200-7a11-8c21-4f5d6e7a8b92',
  installationRoot: failedRoot,
  project: 'alica-d2-failure',
};
const failedRequestPath = join(temp, 'failed-request.json');
writeFileSync(failedRequestPath, `${JSON.stringify(failedRequest, null, 2)}\n`);
run(
  binaryA,
  [
    'install',
    '--manifest',
    manifest,
    '--signature',
    signature,
    '--public-key',
    publicKey,
    '--request',
    failedRequestPath,
    '--json',
  ],
  { expected: [3], env: { ...env, ALICA_D2_FAIL: '1' } },
);
if (existsSync(join(failedRoot, 'accepted')) || existsSync(join(failedRoot, 'release')))
  fail('failed install retained accepted state or runtime');
const failedJournal = JSON.parse(readFileSync(join(failedRoot, 'operation-journal.json'), 'utf8'));
if (failedJournal.entries.at(-1)?.phase !== 'failed')
  fail('failed install did not durably terminate its journal');

const duplicate = join(temp, 'duplicate-request.json');
writeFileSync(
  duplicate,
  readFileSync(request, 'utf8').replace(
    '"project": "alica-d2-fixture"',
    '"project": "alica-d2-fixture",\n  "project": "attack"',
  ),
);
run(
  binaryA,
  [
    'plan',
    '--manifest',
    manifest,
    '--signature',
    signature,
    '--public-key',
    publicKey,
    '--request',
    duplicate,
  ],
  { expected: [2], env },
);
const production = join(temp, 'production-request.json');
writeFileSync(
  production,
  `${JSON.stringify({ ...baseRequest, publicHost: 'uniui.aquiero.com', publicOrigin: 'https://uniui.aquiero.com' }, null, 2)}\n`,
);
run(
  binaryA,
  [
    'plan',
    '--manifest',
    manifest,
    '--signature',
    signature,
    '--public-key',
    publicKey,
    '--request',
    production,
  ],
  { expected: [2], env },
);
const tampered = join(temp, 'tampered-manifest.json');
writeFileSync(
  tampered,
  readFileSync(manifest, 'utf8').replace('1.0.0-d2.fixture.1', '1.0.0-d2.fixture.2'),
);
run(
  binaryA,
  [
    'plan',
    '--manifest',
    tampered,
    '--signature',
    signature,
    '--public-key',
    publicKey,
    '--request',
    request,
  ],
  { expected: [2], env },
);

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      manifestDigest: expectedDigest,
      components: installed.components.length,
      atomicAcceptedBundle: true,
      rollbackNoAcceptedState: true,
      noOpReinstall: true,
      publicCandidatePublication: 'BLOCKED_NO_REGISTRY_AUTH',
    },
    null,
    2,
  ),
);
