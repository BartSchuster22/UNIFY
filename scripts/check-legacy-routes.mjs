#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const inventory = JSON.parse(await readFile(resolve(root, 'deploy/legacy-routes.json'), 'utf8'));
const expected = new Set(['profiles', 'dmm', 'worker', 'chat', 'memory-v4']);
if (inventory.policy.serviceDeletionPermitted !== false)
  throw new Error('Legacy service deletion must remain prohibited');
for (const entry of inventory.domains) {
  if (!expected.delete(entry.domain))
    throw new Error(`Unknown or duplicate domain: ${entry.domain}`);
  if (!['retained', 'deprecated', 'sunset-notified'].includes(entry.state))
    throw new Error(`Invalid legacy state for ${entry.domain}`);
  if (!Array.isArray(entry.routes) || !entry.routes.length)
    throw new Error(`Legacy routes missing for ${entry.domain}`);
  if (entry.state !== 'retained' && (!entry.deprecationDate || !entry.sunsetDate))
    throw new Error(`Deprecation and sunset dates are required for ${entry.domain}`);
}
if (expected.size) throw new Error(`Legacy inventory is incomplete: ${[...expected].join(', ')}`);
console.log(
  `Legacy route inventory verified: ${inventory.domains.length} retained domains; deletion prohibited`,
);
