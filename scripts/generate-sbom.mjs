#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const listed = spawnSync(
  'pnpm',
  ['list', '--recursive', '--prod', '--json', '--depth', 'Infinity'],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  },
);
if (listed.status !== 0) throw new Error(listed.stderr || 'pnpm list failed');
const projects = JSON.parse(listed.stdout);
const components = new Map();
function visit(name, node) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.version === 'string' && name) {
    const key = `${name}@${node.version}`;
    components.set(key, {
      type: 'library',
      name,
      version: node.version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(node.version)}`,
    });
  }
  for (const [childName, child] of Object.entries(node.dependencies ?? {})) visit(childName, child);
  for (const [childName, child] of Object.entries(node.devDependencies ?? {}))
    visit(childName, child);
}
for (const project of projects) {
  visit(project.name, project);
  for (const [name, dependency] of Object.entries(project.dependencies ?? {}))
    visit(name, dependency);
}
const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: '@aquiero/unify', version: '0.1.0' },
    tools: {
      components: [{ type: 'application', name: 'unify-sbom-generator', version: '1.0.0' }],
    },
  },
  components: [...components.values()].sort((a, b) => a.purl.localeCompare(b.purl)),
};
const directory = resolve(root, 'artifacts');
const output = resolve(directory, 'unify-sbom.cdx.json');
await mkdir(directory, { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `CycloneDX SBOM generated: ${document.components.length} production components -> ${output}`,
);
