#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { Value } from '@sinclair/typebox/value';
import {
  HermesCapabilitiesResponseSchema,
  HermesIdentityResponseSchema,
  HermesVersionResponseSchema,
} from '../packages/contracts/dist/index.js';

const child = spawn(process.execPath, ['scripts/hermes-pinned-fixture.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, 'line');
  const ready = JSON.parse(line);
  const headers = { authorization: `Bearer ${process.env.HERMES_FIXTURE_TOKEN}` };
  const cases = [
    ['/control/v1/identity', HermesIdentityResponseSchema],
    ['/control/v1/version', HermesVersionResponseSchema],
    ['/control/v1/capabilities', HermesCapabilitiesResponseSchema],
  ];
  for (const [path, schema] of cases) {
    const response = await fetch(`${ready.url}${path}`, { headers });
    const payload = await response.json();
    if (!response.ok || !Value.Check(schema, payload))
      throw new Error(
        `${path} failed frozen contract validation: ${JSON.stringify([...Value.Errors(schema, payload)])}`,
      );
  }
  const denied = await fetch(`${ready.url}/control/v1/identity`);
  if (denied.status !== 401) throw new Error('fixture service authentication did not fail closed');
  process.stdout.write(
    `Pinned Hermes ${ready.head} passed hermes-control/v1 identity, version, capabilities, and auth checks.\n`,
  );
} finally {
  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => undefined);
}
