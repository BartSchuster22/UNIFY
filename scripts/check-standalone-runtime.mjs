import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const forbiddenRuntime = [
  /\b(?:AGENCY|DMM|WORKER|CHAT)_(?:URL|USERNAME|PASSWORD|TOKEN)(?:_FILE)?\b/,
  /\bENABLE_LEGACY_MIGRATION_READERS\b/,
  /\bMutationOwnerClient\b/,
  /\bLegacyMutationOwnerClient\b/,
  /\bcreateDefaultAdapters\b/,
  /\bIntegrationService\b/,
  /\bCutoverPolicy\b/,
  /['"](?:agency|dmm|worker|chat)['"]\s*:\s*\{[^}]*\burl\b/is,
];
const runtimeFiles = [
  'apps/gateway/src/app.ts',
  'apps/gateway/src/server.ts',
  'apps/gateway/src/mutations/service.ts',
  'apps/gateway/src/mutations/types.ts',
  'apps/gateway/package.json',
  'packages/contracts/src/index.ts',
  'packages/auth-client/src/index.ts',
  'compose.yaml',
  'compose.production.yaml',
  'Dockerfile.gateway',
  'scripts/prepare-compose-secrets.mjs',
];
const removedPaths = [
  'apps/gateway/src/integrations',
  'apps/gateway/src/migration',
  'apps/gateway/src/cutover',
  'packages/adapter-sdk',
  'deploy/legacy-routes.json',
  'scripts/cutover-domain.mjs',
];
const retiredPaths = ['/integrations', '/resources', '/search', '/events', '/shadow'];
const violations = [];

for (const name of runtimeFiles) {
  const body = await readFile(resolve(root, name), 'utf8');
  for (const pattern of forbiddenRuntime)
    if (pattern.test(body)) violations.push(`${name}: forbidden legacy runtime pattern ${pattern}`);
}
for (const name of removedPaths) {
  try {
    await stat(resolve(root, name));
    violations.push(`${name}: retired runtime path still exists`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const contract = await readFile(resolve(root, 'packages/contracts/src/index.ts'), 'utf8');
const gateway = await readFile(resolve(root, 'apps/gateway/src/app.ts'), 'utf8');
for (const path of retiredPaths) {
  const literal = `'${path}'`;
  if (contract.includes(literal)) violations.push(`contracts: retired route ${path} remains`);
  if (gateway.includes(literal)) violations.push(`gateway: retired route ${path} remains`);
}
for (const owner of ['agency', 'dmm', 'worker', 'memory-v4']) {
  if (new RegExp(`Type\\.Literal\\(['"]${owner}['"]\\)`).test(contract))
    violations.push(`contracts: retired owner ${owner} remains`);
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(
  `Standalone runtime boundary verified: ${runtimeFiles.length} runtime files and ${removedPaths.length} retired paths checked`,
);
