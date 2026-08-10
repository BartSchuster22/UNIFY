#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const cfg = {
  candidateId: required('FRAMEWORK_CANDIDATE_ID', /^fuc_[a-f0-9]{64}$/),
  tag: required('HERMES_CANDIDATE_TAG', /^v[0-9A-Za-z._-]+$/),
  commit: required('HERMES_CANDIDATE_COMMIT', /^[a-f0-9]{40}$/),
  release: required('HERMES_CANDIDATE_RELEASE', /^[0-9A-Za-z._-]+$/),
  repository:
    process.env.HERMES_CANDIDATE_REPOSITORY ?? 'https://github.com/NousResearch/hermes-agent.git',
  registry: required('FRAMEWORK_CANDIDATE_REGISTRY', /^[a-zA-Z0-9][a-zA-Z0-9.:/_-]+$/),
  adapterRelease:
    process.env.UNIFY_ADAPTER_RELEASE ??
    `candidate-${process.env.HERMES_CANDIDATE_COMMIT?.slice(0, 12)}`,
  output: resolve(
    process.env.FRAMEWORK_CANDIDATE_EVIDENCE_OUTPUT ?? '/tmp/framework-candidate-evidence.json',
  ),
};
if (cfg.repository !== 'https://github.com/NousResearch/hermes-agent.git')
  throw new Error('Only the configured trusted Hermes repository may be assessed');

const workspace = await mkdtemp(join(tmpdir(), 'unify-hermes-candidate-'));
const source = join(workspace, 'source');
const logs = join(workspace, 'logs');
await mkdir(logs);
const checks = [];
let sourceArchiveDigest = `sha256:${'0'.repeat(64)}`;
let stage = 'SOURCE_CHECKOUT';
let imageReference;
let imageDigest;
const startedAt = new Date().toISOString();
let failure;

try {
  await checked('source_checkout', 'git', [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    cfg.repository,
    source,
  ]);
  await checked('source_exact_commit', 'git', [
    '-C',
    source,
    'fetch',
    '--depth=1',
    'origin',
    `refs/tags/${cfg.tag}`,
  ]);
  await checked('source_checkout_detached', 'git', [
    '-C',
    source,
    'checkout',
    '--detach',
    'FETCH_HEAD',
  ]);
  const head = (await capture('git', ['-C', source, 'rev-parse', 'HEAD'])).trim();
  if (head !== cfg.commit) throw new Error('Trusted tag resolved to a different commit');
  const archive = await captureBuffer('git', ['-C', source, 'archive', '--format=tar', 'HEAD']);
  sourceArchiveDigest = `sha256:${sha256(archive)}`;
  checks.push({ name: 'exact_source', status: 'passed', digest: sourceArchiveDigest });

  stage = 'UPSTREAM_IMAGE_BUILD';
  const baseImage = `unify/hermes-candidate-base:${cfg.commit}`;
  await checked(
    'upstream_image_build',
    'docker',
    [
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '--build-arg',
      `HERMES_GIT_SHA=${cfg.commit}`,
      '-t',
      baseImage,
      source,
    ],
    4 * 60 * 60 * 1000,
  );
  const baseId = (
    await capture('docker', ['image', 'inspect', baseImage, '--format', '{{.Id}}'])
  ).trim();

  stage = 'CONTRACT_TESTS';
  await checked(
    'control_contract_tests',
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${root}:/workspace`,
      '-w',
      '/workspace',
      'node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e',
      'bash',
      '-lc',
      'corepack enable && corepack prepare pnpm@10.33.2 --activate && pnpm install --frozen-lockfile && pnpm --filter @aquiero/contracts build && pnpm --filter @aquiero/hermes-control-adapter test',
    ],
    20 * 60 * 1000,
    root,
  );

  stage = 'COMBINED_IMAGE_BUILD';
  const imageTag = `${cfg.registry}:${cfg.commit.slice(0, 12)}`;
  await checked(
    'combined_image_build',
    'docker',
    [
      'buildx',
      'build',
      '--load',
      '--provenance=false',
      '-f',
      'Dockerfile.hermes-runtime',
      '--build-arg',
      `HERMES_BASE_IMAGE=${baseImage}`,
      '--build-arg',
      `HERMES_RELEASE=${cfg.release}`,
      '--build-arg',
      `HERMES_COMMIT=${cfg.commit}`,
      '--build-arg',
      `HERMES_BASE_DIGEST=${baseId.replace(/^sha256:/, '')}`,
      '--build-arg',
      `UNIFY_ADAPTER_RELEASE=${cfg.adapterRelease}`,
      '-t',
      imageTag,
      '.',
    ],
    60 * 60 * 1000,
    root,
  );

  stage = 'ACCEPTANCE_TESTS';
  await checked(
    'isolated_runtime_acceptance',
    process.execPath,
    ['scripts/verify-hermes-combined-runtime.mjs'],
    15 * 60 * 1000,
    root,
    {
      HERMES_RUNTIME_IMAGE: imageTag,
      HERMES_RUNTIME_SKIP_BUILD: '1',
      EXPECTED_HERMES_RELEASE: cfg.release,
      EXPECTED_HERMES_COMMIT: cfg.commit,
      EXPECTED_HERMES_BASE_DIGEST: baseId.replace(/^sha256:/, '').slice(0, 12),
      UNIFY_ADAPTER_RELEASE: cfg.adapterRelease,
    },
  );

  stage = 'REGISTRY_PUSH';
  await checked('immutable_registry_push', 'docker', ['push', imageTag], 60 * 60 * 1000);
  const repoDigest = (
    await capture('docker', ['image', 'inspect', imageTag, '--format', '{{index .RepoDigests 0}}'])
  ).trim();
  const match = repoDigest.match(/@(?<digest>sha256:[a-f0-9]{64})$/);
  if (!match?.groups?.digest) throw new Error('Registry did not return an immutable digest');
  imageReference = repoDigest;
  imageDigest = match.groups.digest;
} catch (error) {
  failure = {
    code: `${stage}_FAILED`,
    reason: safeReason(stage),
    internal: error instanceof Error ? error.message : String(error),
  };
}

const finishedAt = new Date().toISOString();
const evidence = {
  schemaVersion: 1,
  builder: 'unify-framework-candidate-assessor-v1',
  repository: cfg.repository,
  tag: cfg.tag,
  commit: cfg.commit,
  startedAt,
  finishedAt,
  checks,
};
const evidenceDigest = `sha256:${sha256(stable(evidence))}`;
const ready = !failure;
const document = {
  candidateId: cfg.candidateId,
  state: ready ? 'ready' : 'blocked',
  sourceCommit: cfg.commit,
  sourceArchiveDigest,
  ...(ready ? { imageReference, imageDigest } : {}),
  adapterRelease: cfg.adapterRelease,
  contractVersion: 'hermes-control/v1',
  contractPassed: checkPassed('control_contract_tests'),
  acceptancePassed: checkPassed('isolated_runtime_acceptance'),
  evidence,
  evidenceDigest,
  ...(!ready ? { safeFailureCode: failure.code, safeFailureReason: failure.reason } : {}),
  assessedAt: finishedAt,
};
await writeFile(cfg.output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
await rm(workspace, { recursive: true, force: true });
process.stdout.write(
  `${JSON.stringify({ output: cfg.output, state: document.state, imageReference })}\n`,
);
if (!ready) {
  process.stderr.write(`${failure.code}: ${failure.internal}\n`);
  process.exitCode = 1;
}

async function checked(name, command, args, timeout = 10 * 60 * 1000, cwd = root, extraEnv = {}) {
  const path = join(logs, `${name}.log`);
  const result = await run(command, args, { cwd, timeout, env: { ...process.env, ...extraEnv } });
  await writeFile(path, `${result.stdout}${result.stderr}`, { mode: 0o600 });
  const logDigest = `sha256:${sha256(await readFile(path))}`;
  checks.push({ name, status: result.code === 0 ? 'passed' : 'failed', logDigest });
  if (result.code !== 0)
    throw new Error(`${command} failed with exit ${result.code}; log ${logDigest}`);
}
function checkPassed(name) {
  return checks.some((check) => check.name === name && check.status === 'passed');
}
async function capture(command, args) {
  const result = await run(command, args, { cwd: root, timeout: 60_000, env: process.env });
  if (result.code !== 0) throw new Error(`${command} failed`);
  return result.stdout;
}
async function captureBuffer(command, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(Buffer.concat(chunks))
        : reject(new Error(Buffer.concat(errors).toString())),
    );
  });
}
function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}
function required(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`${name} is missing or invalid`);
  return value;
}
function safeReason(failedStage) {
  return `Candidate assessment was blocked because ${failedStage.toLowerCase().replaceAll('_', ' ')} did not pass.`;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
