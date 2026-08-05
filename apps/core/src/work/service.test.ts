import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import { NativeWorkError, NativeWorkService } from './service.js';

const actor = { kind: 'service', id: 'svc_01HZZZZZZZZZZZZZZZZZZZZZZZ' } as AuthenticatedPrincipal;
const context: RequestContext = { remoteAddress: '127.0.0.1' };
const authentication = { authorize: async () => undefined } as unknown as AuthenticationService;
const pool = {
  connect: () => {
    throw new Error('database must not be reached');
  },
} as unknown as Pool;
const service = new NativeWorkService(pool, authentication);

test('active projects require a goal and profiles', async () => {
  await assert.rejects(
    service.createProject(
      { name: 'Project', activate: true },
      { commandId: 'cmd_01HZZZZZZZZZZZZZZZZZZZZZZZ', idempotencyKey: 'phase8:activation:0001' },
      actor,
      context,
    ),
    (error: unknown) =>
      error instanceof NativeWorkError && error.code === 'project_activation_requirements_missing',
  );
});

test('commands reject malformed canonical IDs before database access', async () => {
  await assert.rejects(
    service.createProject(
      { name: 'Draft' },
      { commandId: 'invalid', idempotencyKey: 'phase8:command-id:0001' },
      actor,
      context,
    ),
    (error: unknown) => error instanceof NativeWorkError && error.code === 'command_id_invalid',
  );
});
