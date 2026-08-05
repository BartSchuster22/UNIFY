import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const staticOnly = process.argv.includes('--static');
const frontendDigest = 'sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e';
const runtimeDigest = 'sha256:939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167';
const buildDigest = 'sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f';
const trivy =
  'aquasec/trivy:0.69.3@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c';
const definitions = [
  { dockerfile: 'Dockerfile.gateway', image: 'unify-gateway:phase11', limitMiB: 250, args: [] },
  { dockerfile: 'Dockerfile.uniui', image: 'unify-uniui:phase11', limitMiB: 200, args: [] },
  {
    dockerfile: 'Dockerfile.focused-pwa',
    image: 'unify-chat-pwa:phase11',
    limitMiB: 200,
    args: ['--build-arg', 'APP=chat-pwa'],
  },
  {
    dockerfile: 'Dockerfile.focused-pwa',
    image: 'unify-alerts-pwa:phase11',
    limitMiB: 200,
    args: ['--build-arg', 'APP=alerts-pwa'],
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${detail}`);
  }
  return options.capture ? String(result.stdout).trim() : '';
}

async function verifyStaticDefinition() {
  for (const definition of definitions) {
    const source = await readFile(resolve(root, definition.dockerfile), 'utf8');
    for (const required of [
      frontendDigest,
      buildDigest,
      runtimeDigest,
      ' AS build',
      ' AS runtime',
      'USER 65532:65532',
      'STOPSIGNAL SIGTERM',
      'HEALTHCHECK',
      'org.opencontainers.image.source',
    ]) {
      if (!source.includes(required))
        throw new Error(`${definition.dockerfile} is missing ${required}`);
    }
    const fromLines = source.split('\n').filter((line) => line.startsWith('FROM '));
    if (fromLines.length !== 2 || fromLines.some((line) => !line.startsWith('FROM ${NODE_')))
      throw new Error(`${definition.dockerfile} must use only pinned NODE image arguments`);
  }
  const compose = run('docker', ['compose', 'config'], { capture: true });
  for (const required of [
    'read_only: true',
    'cap_drop:',
    '- ALL',
    'no-new-privileges:true',
    'pids_limit:',
    'mem_limit:',
    'cpus:',
    'stop_grace_period:',
  ]) {
    if (!compose.includes(required))
      throw new Error(`Rendered Compose configuration lacks ${required}`);
  }
}

async function verifyImage(definition) {
  run('docker', [
    'buildx',
    'build',
    '--load',
    '--pull',
    '--file',
    definition.dockerfile,
    '--tag',
    definition.image,
    ...definition.args,
    '.',
  ]);
  const inspection = JSON.parse(
    run('docker', ['image', 'inspect', definition.image], { capture: true }),
  )[0];
  const config = inspection.Config;
  if (config.User !== '65532:65532') throw new Error(`${definition.image} user is ${config.User}`);
  if (config.StopSignal !== 'SIGTERM')
    throw new Error(`${definition.image} lacks SIGTERM stop signal`);
  if (!config.Healthcheck?.Test?.length)
    throw new Error(`${definition.image} lacks a health check`);
  const sizeMiB = inspection.Size / 1024 / 1024;
  if (sizeMiB > definition.limitMiB)
    throw new Error(
      `${definition.image} is ${sizeMiB.toFixed(1)} MiB (limit ${definition.limitMiB})`,
    );
  console.log(`${definition.image}: ${sizeMiB.toFixed(1)} MiB, non-root, health-checked`);
}

function scanAndCreateSbom(definition) {
  const output = resolve(root, 'artifacts', 'sbom');
  const cache = resolve(tmpdir(), `unify-trivy-cache-${process.getuid?.() ?? 'runner'}`);
  const name = definition.image.replaceAll(/[^a-zA-Z0-9.-]/g, '-');
  run('docker', [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${output}:/output`,
    '-v',
    `${cache}:/root/.cache/trivy`,
    trivy,
    'image',
    '--format',
    'cyclonedx',
    '--output',
    `/output/${name}.cdx.json`,
    definition.image,
  ]);
  run('docker', [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${cache}:/root/.cache/trivy`,
    trivy,
    'image',
    '--scanners',
    'vuln',
    '--severity',
    'HIGH,CRITICAL',
    '--ignore-unfixed',
    '--exit-code',
    '1',
    definition.image,
  ]);
}

async function exerciseWebImage() {
  const name = `unify-phase11-${process.pid}`;
  run('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '100',
    '--memory',
    '192m',
    '--cpus',
    '0.5',
    '--tmpfs',
    '/tmp:uid=65532,gid=65532,mode=0700',
    'unify-uniui:phase11',
  ]);
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = run(
        'docker',
        ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{end}}', name],
        { capture: true },
      );
      if (status === 'healthy') break;
      if (attempt === 29) throw new Error(`web image health status remained ${status}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
    run('docker', ['stop', '--timeout', '15', name]);
    const logs = run('docker', ['logs', name], { capture: true });
    if (!logs.includes('Graceful shutdown complete'))
      throw new Error('graceful shutdown was not observed');
  } finally {
    spawnSync('docker', ['rm', '--force', name], { cwd: root, stdio: 'ignore' });
  }
}

await verifyStaticDefinition();
if (staticOnly) {
  console.log('Production image definitions and Compose hardening verified');
  process.exit(0);
}
await Promise.all([
  mkdir(resolve(root, 'artifacts', 'sbom'), { recursive: true }),
  mkdir(resolve(tmpdir(), `unify-trivy-cache-${process.getuid?.() ?? 'runner'}`), {
    recursive: true,
  }),
]);
for (const definition of definitions) await verifyImage(definition);
await exerciseWebImage();
for (const definition of definitions) scanAndCreateSbom(definition);
console.log('Production images built, exercised, SBOM-generated, and vulnerability-scanned');
