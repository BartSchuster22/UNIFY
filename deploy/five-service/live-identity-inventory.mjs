#!/usr/bin/env node
import { inventoryLiveIdentityContext } from '../../scripts/lib/alica-live-identity-inventory.mjs';

const allowed = new Set(['--pretty']);
for (const argument of process.argv.slice(2)) {
  if (!allowed.has(argument)) throw new Error(`unknown argument: ${argument}`);
}
const report = inventoryLiveIdentityContext();
console.log(JSON.stringify(report, null, process.argv.includes('--pretty') ? 2 : 0));
