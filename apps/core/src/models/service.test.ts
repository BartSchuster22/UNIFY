import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal } from '../auth/types.js';
import type { FrameworkGatewayService } from '../frameworks/service.js';
import { NativeModelError, NativeModelService } from './service.js';

const actor = {
  kind: 'service',
  id: 'svc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: 'model-unit-test',
  roles: ['core.admin'],
  permissions: ['models.read', 'models.manage'],
  credentialId: 'crd_01ARZ3NDEKTSV4RRFFQ69G5FAW',
  credentialScopes: ['*'],
} satisfies AuthenticatedPrincipal;

const authentication = {
  authorize: async () => undefined,
} as unknown as AuthenticationService;

const forbiddenPool = {
  connect: async () => {
    throw new Error('database must not be reached for invalid input');
  },
  query: async () => {
    throw new Error('database must not be reached for invalid input');
  },
} as unknown as Pool;

const frameworks = {} as FrameworkGatewayService;
const context = { remoteAddress: '127.0.0.1' } as const;

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof NativeModelError && error.code === code;
}

test('routing policy validation rejects duplicate candidates before persistence', async () => {
  const service = new NativeModelService(forbiddenPool, authentication, frameworks);
  await assert.rejects(
    service.setRoutingPolicy(
      'prf_01ARZ3NDEKTSV4RRFFQ69G5FAX',
      [
        { modelId: 'mdl_01ARZ3NDEKTSV4RRFFQ69G5FAY' },
        { modelId: 'mdl_01ARZ3NDEKTSV4RRFFQ69G5FAY', required: true },
      ],
      0,
      actor,
      context,
    ),
    rejectsWith('routing_candidates_duplicate'),
  );
});

test('route resolution rejects malformed capability requirements before querying projections', async () => {
  const service = new NativeModelService(forbiddenPool, authentication, frameworks);
  await assert.rejects(
    service.resolve('prf_01ARZ3NDEKTSV4RRFFQ69G5FAX', ['vision', 'VISION'], actor, context),
    rejectsWith('model_capability_invalid'),
  );
});
