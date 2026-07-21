#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const legacyOwners = '(?:agency|dmm|worker|chat)';
const legacyOwnerPattern = new RegExp(`\\bowner\\s*:\\s*['"]${legacyOwners}['"]`, 'i');
const legacyUrlPattern = /\b(?:AGENCY|DMM|WORKER|CHAT)_(?:URL|USERNAME|PASSWORD|TOKEN)(?:_FILE)?\b/;

// Migration quarantine: production profile/provider UI and Hermes control code must not know
// legacy owners. Remaining legacy code is disabled unless the migration flag is explicit.
const migrationBoundaryFiles = new Set([
  'apps/chat-pwa/src/App.tsx',
  'apps/gateway/src/app.ts',
  'apps/gateway/src/integrations/adapters.ts',
  'apps/gateway/src/migration/legacy/owner-client.ts',
  'apps/gateway/src/server.ts',
  'apps/uniui/src/App.tsx',
  'apps/uniui/src/ChatView.tsx',
  'apps/uniui/src/WorkView.tsx',
  'compose.yaml',
  'scripts/prepare-compose-secrets.mjs',
]);

const sourceRoots = ['apps', 'packages', 'scripts', 'deploy'];
const files = [];
for (const entry of sourceRoots) await walk(resolve(root, entry), files);
files.push(resolve(root, 'compose.yaml'), resolve(root, 'compose.production.yaml'));

const violations = [];
for (const path of files) {
  const name = relative(root, path);
  if (
    name.includes('/dist/') ||
    name.includes('/node_modules/') ||
    /(?:^|\/)artifacts\//.test(name) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)
  )
    continue;
  const extension = extname(path);
  if (!['.ts', '.tsx', '.js', '.mjs', '.json', '.yaml', '.yml'].includes(extension)) continue;
  const body = await readFile(path, 'utf8');
  if (legacyOwnerPattern.test(body) && !migrationBoundaryFiles.has(name))
    violations.push(`${name}: authoritative-looking legacy owner declaration outside quarantine`);
  if (legacyUrlPattern.test(body) && !migrationBoundaryFiles.has(name))
    violations.push(`${name}: direct legacy connection configuration outside quarantine`);
}

const production = await readFile(resolve(root, 'compose.production.yaml'), 'utf8');
for (const required of [
  /DEPLOYMENT_MODE:\s*read-only\b/,
  /MUTATION_DOMAINS:\s*''/,
  /MUTATION_ACCEPTANCE_REFS:\s*''/,
]) {
  if (!required.test(production))
    violations.push('compose.production.yaml: production must remain unconditionally read-only');
}
if (/mutation-canary|qa10:unify-chat/i.test(production))
  violations.push('compose.production.yaml: legacy mutation canary declaration is forbidden');

const mutations = await readFile(
  resolve(root, 'apps/gateway/src/migration/legacy/owner-client.ts'),
  'utf8',
);
const definitions = mutations.slice(
  mutations.indexOf('export const mutationDefinitions'),
  mutations.indexOf('export class MutationOwnerClient'),
);
if (/executionPath:\s*['"]hermes-control['"]/.test(definitions))
  violations.push(
    'owner-client.ts: legacy owner client cannot declare a verified Hermes control path',
  );
if (!/executionPath:\s*['"]migration-legacy['"]/.test(definitions))
  violations.push('owner-client.ts: legacy mutation definitions must be explicitly quarantined');

const adapter = await readFile(resolve(root, 'apps/gateway/src/integrations/adapters.ts'), 'utf8');
for (const required of [
  /sourceRole\s*=\s*['"]migration-only['"]/,
  /writeEnabled\s*=\s*false/,
  /authoritative:\s*false/,
]) {
  if (!required.test(adapter))
    violations.push('adapters.ts: legacy adapters must be non-authoritative and read-only');
}

const gatewayServer = await readFile(resolve(root, 'apps/gateway/src/server.ts'), 'utf8');
if (!/ENABLE_LEGACY_MIGRATION_READERS\s*===\s*['"]true['"]/.test(gatewayServer))
  violations.push('gateway server: legacy migration readers must be explicitly feature-gated');
if (!/import\(['"]\.\/migration\/legacy\/owner-client\.js['"]\)/.test(gatewayServer))
  violations.push('gateway server: legacy owner client must be isolated behind a dynamic import');

for (const name of ['apps/uniui/src/ProfilesView.tsx', 'apps/uniui/src/ModelsView.tsx']) {
  const body = await readFile(resolve(root, name), 'utf8');
  if (
    /agency-context|dmm-context|['"]dmm\.credential|['"]profile\.(?:create|delete|identity|model|runtime)/i.test(
      body,
    )
  )
    violations.push(`${name}: production profile/model UI cannot call a legacy owner path`);
}

const historicalDocumentMarkers = new Map([
  ['docs/plans/BUILDING-PLAN.md', /SUPERSEDED ARCHITECTURE/],
  ['docs/evidence/PHASE-7-REPORT.md', /HISTORICAL EVIDENCE/],
  ['docs/runbooks/PRODUCTION-CUTOVER.md', /PHASE 0 CONTAINMENT/],
  ['docs/adapters/READ-ONLY-INTEGRATIONS.md', /MIGRATION-ONLY/],
  ['docs/architecture/RESOURCE-IDENTITY.md', /HERMES-SOURCE-OF-TRUTH QUALIFICATION/],
]);
for (const [name, marker] of historicalDocumentMarkers) {
  const body = await readFile(resolve(root, name), 'utf8');
  if (!marker.test(body))
    violations.push(`${name}: required source-of-truth supersession marker is missing`);
}

const immutableFrameworkDocuments = new Map([
  [
    'docs/plans/HERMES-SOT-REBUILD-AND-IMPLEMENTATION-PLAN.md',
    /Hermes Agent is an immutable external framework/,
  ],
  [
    'docs/architecture/HERMES-CONTROL-V1.md',
    /UNIFY-owned adapter contract[\s\S]*not an API that Hermes must implement/,
  ],
  [
    'docs/architecture/HERMES-ADAPTER-FOUNDATIONS.md',
    /never imports, patches, vendors, or writes the Hermes repository/,
  ],
]);
for (const [name, marker] of immutableFrameworkDocuments) {
  const body = await readFile(resolve(root, name), 'utf8');
  if (!marker.test(body))
    violations.push(`${name}: immutable external Hermes framework boundary is missing`);
}

const pinnedFixture = await readFile(resolve(root, 'scripts/hermes-pinned-fixture.mjs'), 'utf8');
if (/\b(?:writeFile|appendFile|rm|unlink|rename|copyFile|chmod|chown)\b/.test(pinnedFixture))
  violations.push('hermes-pinned-fixture.mjs: fixture must never mutate the Hermes checkout');

const liveVerifier = await readFile(
  resolve(root, 'scripts/verify-hermes-adapter-foundations.mjs'),
  'utf8',
);
if (/\b(?:writeFile|appendFile|rm|unlink|rename|copyFile|chmod|chown)\b/.test(liveVerifier))
  violations.push('verify-hermes-adapter-foundations.mjs: verifier must never mutate Hermes');

const hermesAdapterSource = await readFile(
  resolve(root, 'apps/hermes-control-adapter/src/source.ts'),
  'utf8',
);
if (/from\s+['"][^'"]*(?:hermes-agent|hermes_cli|gateway\/platforms)/.test(hermesAdapterSource))
  violations.push('Hermes adapter: importing Hermes implementation code is forbidden');
if (
  /['"](?:profile|kanban|cron)['"]\s*,\s*['"](?:create|add|update|edit|delete|remove|start|stop|run|enable|disable)['"]/.test(
    hermesAdapterSource,
  )
)
  violations.push('Hermes adapter foundations: mutating Hermes CLI commands are forbidden');

if (violations.length) {
  console.error('Hermes source-of-truth policy violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(
  `Hermes source-of-truth policy verified; ${migrationBoundaryFiles.size} legacy boundary files quarantined`,
);

async function walk(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['dist', 'node_modules', 'coverage', '.git'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, output);
    else output.push(path);
  }
}
