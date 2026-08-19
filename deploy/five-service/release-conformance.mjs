#!/usr/bin/env node
import { resolve } from 'node:path';

import { inspectFiveServiceRelease } from '../../scripts/lib/alica-release-conformance.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  const report = inspectFiveServiceRelease(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 'alica-release-conformance-report/v1',
        generatedAt: new Date().toISOString(),
        operation: 'read-only-inspection',
        mutationPerformed: false,
        status: 'FAIL',
        error: safeMessage(error),
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(args) {
  const parsed = { root: '', project: 'unify' };
  while (args.length) {
    const name = args.shift();
    if (name !== '--root' && name !== '--project') throw new Error(`Unknown argument: ${name}`);
    const value = args.shift();
    if (!value) throw new Error(`${name} requires a value`);
    if (name === '--root') parsed.root = resolve(value);
    if (name === '--project') parsed.project = value;
  }
  if (!parsed.root) throw new Error('Usage: release-conformance.mjs --root PATH [--project NAME]');
  return parsed;
}

function safeMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/giu, 'postgresql://[REDACTED]@')
    .replace(/[A-Za-z0-9_-]{80,}/gu, '[REDACTED]')
    .slice(0, 1000);
}
