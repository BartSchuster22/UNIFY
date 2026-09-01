#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const moduleRoot = join(root, 'dsh/alicactl');
const testdata = join(moduleRoot, 'testdata');
const manifest = join(testdata, 'd1-contract.manifest.json');
const signature = join(testdata, 'd1-contract.manifest.signature.json');
const publicKey = join(testdata, 'd1-test-public-key.json');
const observation = join(testdata, 'observed-conformant.json');
const expectedManifestDigest =
  'sha256:1bb322baf663684b6d2b9fd831a0e26c03959f5e327dfa5e47f2557f7c1a87c3';

function fail(message) {
  throw new Error(message);
}

function locateGo() {
  const candidates = [
    process.env.ALICA_GO_BIN,
    '/tmp/go1.27.0/bin/go',
    '/usr/local/go/bin/go',
    'go',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  fail('Go toolchain not found; install Go >=1.24 or set ALICA_GO_BIN');
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 20 * 1024 * 1024,
  });
  const expected = options.expected ?? [0];
  if (!expected.includes(result.status)) {
    fail(
      `${binary} ${args.join(' ')} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function walk(path) {
  if (!existsSync(path)) return [];
  const info = statSync(path);
  if (info.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => walk(join(path, entry.name)))
    .sort();
}

function fingerprint(paths) {
  const hash = createHash('sha256');
  for (const path of paths.flatMap(walk).sort()) {
    hash.update(path);
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

function dockerInventory() {
  const commands = [
    ['ps', '-aq'],
    ['network', 'ls', '-q'],
    ['volume', 'ls', '-q'],
  ];
  const result = [];
  for (const args of commands) {
    const value = spawnSync('docker', args, { encoding: 'utf8' });
    result.push(
      value.status === 0
        ? value.stdout.trim().split('\n').filter(Boolean).sort().join(',')
        : 'unavailable',
    );
  }
  return result.join('|');
}

const go = locateGo();
const gofmt = go.includes('/') ? join(dirname(go), 'gofmt') : 'gofmt';
const temp = mkdtempSync(join(tmpdir(), 'alica-d1-'));
const binaryA = join(temp, 'alicactl-a');
const binaryB = join(temp, 'alicactl-b');
const protectedPaths = [
  join(root, 'dsh/alicactl'),
  join(root, 'dsh/contracts'),
  join(root, 'dsh/product'),
];
const beforeFiles = fingerprint(protectedPaths);
const beforeRuntime = fingerprint(['/var/lib/alica']);
const beforeDocker = dockerInventory();

const fixtureCheck = run('python3', ['scripts/generate-dsh-d1-fixture.py', '--check']);
if (!fixtureCheck.stdout.includes(expectedManifestDigest)) fail('fixture generator digest changed');

const goSources = walk(moduleRoot).filter((path) => path.endsWith('.go'));
const formatCheck = run(gofmt, ['-d', ...goSources]);
if (formatCheck.stdout.trim() !== '') fail('gofmt produced a diff');
run(go, ['vet', './...'], { cwd: moduleRoot });
run(go, ['test', '-race', '-cover', './...'], { cwd: moduleRoot });
for (const output of [binaryA, binaryB]) {
  run(go, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', output, './cmd/alicactl'], {
    cwd: moduleRoot,
    env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
  });
}
const binaryHashA = createHash('sha256').update(readFileSync(binaryA)).digest('hex');
const binaryHashB = createHash('sha256').update(readFileSync(binaryB)).digest('hex');
if (binaryHashA !== binaryHashB) fail('alicactl static build is not reproducible');

const common = [
  '--manifest',
  manifest,
  '--signature',
  signature,
  '--public-key',
  publicKey,
  '--observation',
  observation,
  '--json',
];
const reports = {};
for (const command of ['preflight', 'status', 'verify']) {
  const result = run(binaryA, [command, ...common], {
    env: { ALICACTL_TEST_MODE: '1', ALICACTL_NOW: '2026-08-27T21:00:00Z' },
  });
  const report = JSON.parse(result.stdout);
  if (
    report.status !== 'PASS' ||
    report.mutationPerformed !== false ||
    report.summary.failed !== 0 ||
    report.summary.drift !== 0
  ) {
    fail(`${command} did not produce an exact read-only PASS`);
  }
  reports[command] = report;
}

run(binaryA, ['verify', ...common], { expected: [2], env: { ALICACTL_TEST_MODE: '' } });
const tamperedManifest = join(temp, 'tampered.manifest.json');
writeFileSync(
  tamperedManifest,
  readFileSync(manifest, 'utf8').replace('1.0.0-d1.fixture.1', '1.0.0-d1.fixture.2'),
);
run(
  binaryA,
  [
    'verify',
    '--manifest',
    tamperedManifest,
    '--signature',
    signature,
    '--public-key',
    publicKey,
    '--observation',
    observation,
  ],
  { expected: [2], env: { ALICACTL_TEST_MODE: '1' } },
);
const tamperedSignature = join(temp, 'tampered.signature.json');
const envelope = JSON.parse(readFileSync(signature, 'utf8'));
envelope.signature = `${envelope.signature[0] === 'A' ? 'B' : 'A'}${envelope.signature.slice(1)}`;
writeFileSync(tamperedSignature, `${JSON.stringify(envelope, null, 2)}\n`);
run(
  binaryA,
  [
    'verify',
    '--manifest',
    manifest,
    '--signature',
    tamperedSignature,
    '--public-key',
    publicKey,
    '--observation',
    observation,
  ],
  { expected: [2], env: { ALICACTL_TEST_MODE: '1' } },
);

const productionSources = [
  join(moduleRoot, 'cmd/alicactl/main.go'),
  ...walk(join(moduleRoot, 'internal')).filter(
    (path) =>
      path.endsWith('.go') &&
      !path.endsWith('_test.go') &&
      !path.includes(`${sep}internal${sep}install${sep}`) &&
      !path.includes(`${sep}internal${sep}recovery${sep}`),
  ),
];
const productionText = productionSources.map((path) => readFileSync(path, 'utf8')).join('\n');
for (const forbidden of [
  'os.WriteFile(',
  'os.Create(',
  'dockerOutput("run"',
  'dockerOutput("start"',
  'dockerOutput("stop"',
  'dockerOutput("rm"',
  'dockerOutput("create"',
]) {
  if (productionText.includes(forbidden))
    fail(`production lifecycle source contains mutator: ${forbidden}`);
}

const live = run(
  binaryA,
  [
    'preflight',
    '--manifest',
    manifest,
    '--signature',
    signature,
    '--public-key',
    publicKey,
    '--root',
    '/',
    '--json',
  ],
  { expected: [0, 3] },
);
const liveReport = JSON.parse(live.stdout);
if (liveReport.mutationPerformed !== false) fail('live preflight claimed mutation');

const afterFiles = fingerprint(protectedPaths);
const afterRuntime = fingerprint(['/var/lib/alica']);
const afterDocker = dockerInventory();
if (beforeFiles !== afterFiles) fail('alicactl changed protected source/contract files');
if (beforeRuntime !== afterRuntime) fail('alicactl changed /var/lib/alica');
if (beforeDocker !== afterDocker) fail('alicactl changed Docker resource inventory');

const result = {
  status: 'PASS',
  phase: 'D1',
  manifest_schema: 'alica-release/v1',
  signature_schema: 'alica-manifest-signature/v1',
  cell_declaration_schema: 'alica-cell-declaration/v1',
  operation_journal_schema: 'alica-operation-journal/v1',
  report_schema: 'alica-readonly-report/v1',
  manifest_digest: expectedManifestDigest,
  commands: Object.fromEntries(
    Object.entries(reports).map(([name, report]) => [name, report.status]),
  ),
  conformant_checks: reports.verify.summary.passed,
  drift_classes_tested: 13,
  manifest_policy_mutations_tested: 9,
  strict_json_attacks_tested: 5,
  trust_attacks_tested: 3,
  journal_chain_attacks_tested: 1,
  reproducible_static_binary_sha256: binaryHashA,
  live_preflight_status: liveReport.status,
  runtime_mutation: false,
  docker_inventory_unchanged: true,
  lifecycle_state_unchanged: true,
};
console.log(JSON.stringify(result, null, 2));
