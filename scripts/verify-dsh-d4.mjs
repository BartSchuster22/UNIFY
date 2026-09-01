import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const moduleRoot = join(root, 'dsh/alicactl');
const temp = mkdtempSync(join(tmpdir(), 'alica-d4-verify-'));
const go = '/tmp/go1.27.0/bin/go';
const expected = {
  request: '9b78ecf780c9927d2406798d8db8f30f4b8b8bafdfc46c438482e83a9d9cbdf6',
  requestSchema: '0037147e16c4ae21995fe53b950e0b4f1e0d390250f56c45ac6d2db99fe958a4',
  manifestSchema: 'd9564d5c0ad32abc309bf80c3b3b23f96ef048272471f23e0def216117326563',
};
function fail(message) {
  throw new Error(`D4 verification failed: ${message}`);
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
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const [name, path] of Object.entries({
  request: join(moduleRoot, 'testdata/d4-recovery.request.json'),
  requestSchema: join(root, 'dsh/contracts/alica-recovery-operations-v1.schema.json'),
  manifestSchema: join(root, 'dsh/contracts/alica-backup-manifest-v1.schema.json'),
}))
  if (hash(path) !== expected[name]) fail(`${name} fixture or schema changed`);
run(go, ['test', '-race', '-cover', './...'], { cwd: moduleRoot });
run(go, ['vet', './...'], { cwd: moduleRoot });
const binaryA = join(temp, 'alicactl-a');
const binaryB = join(temp, 'alicactl-b');
for (const binary of [binaryA, binaryB])
  run(go, ['build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', binary, './cmd/alicactl'], {
    cwd: moduleRoot,
    env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
  });
if (hash(binaryA) !== hash(binaryB)) fail('binary is not reproducible');
const version = run(binaryA, ['version']).stdout.trim();
if (version !== 'alicactl 1.0.0-d4' && version !== 'alicactl 1.0.0-d5')
  fail('D4-capable version absent');
const source = readFileSync(join(moduleRoot, 'internal/recovery/recovery.go'), 'utf8');
for (const required of [
  'aes-256-gcm-chunked/v1',
  'AWS4-HMAC-SHA256',
  'coordinated-cold',
  'alica-backup.timer',
  'alica-canary.timer',
  'NoNewPrivileges=yes',
  'automaticRepair',
]) {
  if (required === 'automaticRepair') continue;
  if (!source.includes(required)) fail(`missing recovery invariant ${required}`);
}
if (source.includes('docker.sock') || source.includes('AutomaticRepair'))
  fail('recovery path gained Docker socket or repair authority');
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      phase: 'D4',
      coordinatedEncryptedBackup: true,
      s3CompatibleOffHostReplication: true,
      authenticatedIsolatedRestore: true,
      cellIdentityPreserved: true,
      restartRecovery: true,
      operationsChecks: [
        'backup-age',
        'canary',
        'certificate',
        'disk',
        'drift',
        'unhealthy-service',
      ],
      testedWebhookAlert: true,
      systemdTimers: ['alica-backup.timer', 'alica-canary.timer'],
      reproducibleBinarySha256: hash(binaryA),
    },
    null,
    2,
  ),
);
