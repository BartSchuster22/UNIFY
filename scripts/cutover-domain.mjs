#!/usr/bin/env node
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const domains = ['profiles', 'dmm', 'worker', 'chat', 'memory-v4'];
const [action, domain, acceptance, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply') || acceptance === '--apply';
if (!['activate', 'rollback'].includes(action) || !domains.includes(domain)) {
  console.error('usage: scripts/cutover-domain.mjs activate DOMAIN ACCEPTANCE_REF [--apply]');
  console.error('   or: scripts/cutover-domain.mjs rollback DOMAIN [--apply]');
  process.exit(2);
}
if (action === 'activate' && (!acceptance || acceptance === '--apply')) {
  console.error('Activation requires a written acceptance reference.');
  process.exit(2);
}
if (action === 'activate' && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,199}$/.test(acceptance)) {
  console.error('Acceptance reference is invalid.');
  process.exit(2);
}

const stateDir = resolve(root, '.secrets');
const statePath = resolve(stateDir, 'mutation-cutover.json');
const envPath = resolve(stateDir, 'mutation-cutover.env');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const before = existsSync(statePath)
  ? JSON.parse(await readFile(statePath, 'utf8'))
  : { enabled: {}, updatedAt: null };
const next = structuredClone(before);
if (action === 'activate') next.enabled[domain] = acceptance;
else delete next.enabled[domain];
next.updatedAt = new Date().toISOString();
const entries = domains.filter((item) => next.enabled[item]);
const env = [
  `DEPLOYMENT_MODE=${entries.length ? 'mutation-canary' : 'read-only'}`,
  `MUTATION_DOMAINS=${entries.join(',')}`,
  `MUTATION_ACCEPTANCE_REFS=${entries.map((item) => `${item}=${next.enabled[item]}`).join(',')}`,
  '',
].join('\n');

let deployment = { applied: false, status: 'plan-only' };
if (apply) {
  const stateTemp = `${statePath}.tmp`;
  const envTemp = `${envPath}.tmp`;
  await writeFile(stateTemp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await writeFile(envTemp, env, { mode: 0o600 });
  const deployed = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      envTemp,
      '-f',
      resolve(root, 'compose.yaml'),
      '-f',
      resolve(root, 'compose.production.yaml'),
      'up',
      '-d',
      '--force-recreate',
      '--wait',
      'gateway',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (deployed.status !== 0) {
    await rm(stateTemp, { force: true });
    await rm(envTemp, { force: true });
    console.error(deployed.stderr || deployed.stdout);
    process.exit(deployed.status ?? 1);
  }
  await rename(stateTemp, statePath);
  await rename(envTemp, envPath);
  await chmod(statePath, 0o600);
  await chmod(envPath, 0o600);
  deployment = { applied: true, status: 'gateway-healthy' };
}
const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).stdout.trim();
const evidence = {
  action,
  domain,
  acceptanceRef: action === 'activate' ? acceptance : null,
  before: before.enabled,
  after: next.enabled,
  deployment,
  gitCommit: commit,
  recordedAt: new Date().toISOString(),
  legacyServicesDeleted: false,
};
const evidenceDir = resolve(root, 'artifacts', 'cutover');
await mkdir(evidenceDir, { recursive: true });
const evidencePath = resolve(evidenceDir, `${Date.now()}-${action}-${domain}.json`);
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
