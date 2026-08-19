#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateAuthorizationShadow,
  inspectIdentityAuthorizationContext,
} from '../../scripts/lib/alica-identity-shadow.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

const command = process.argv[2];
try {
  if (command === 'inventory') {
    const root = resolve(option('--root', process.cwd()));
    process.stdout.write(`${JSON.stringify(inspectIdentityAuthorizationContext(root), null, 2)}\n`);
  } else if (command === 'evaluate') {
    const input = option('--input');
    if (!input) fail('Usage: identity-shadow.mjs evaluate --input <fixture.json>');
    else {
      const parsed = JSON.parse(readFileSync(resolve(input), 'utf8'));
      process.stdout.write(`${JSON.stringify(evaluateAuthorizationShadow(parsed), null, 2)}\n`);
    }
  } else {
    fail('Usage: identity-shadow.mjs <inventory|evaluate> [options]');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
