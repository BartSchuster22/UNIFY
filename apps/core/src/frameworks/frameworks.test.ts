import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
} from '@aquiero/contracts';
import { HermesFrameworkClient } from './client.js';
import { MemoryCircuitBreaker } from './circuit.js';
import { frameworkGatewayConfigFromEnvironment } from './config.js';
import { parseCredentialBundle } from './credentials.js';
import { DnsPrivateEndpointGuard, isPrivateAddress } from './private-network.js';
import {
  DEFAULT_FRAMEWORK_GATEWAY_POLICY,
  type GatewayCredentialBundle,
  type GatewayCredentialProvider,
} from './types.js';
import type { FrameworkGatewayError } from './types.js';

const TOKEN_A = 'alica-token-that-is-at-least-thirty-two-bytes';
const TOKEN_B = 'herman-token-that-is-at-least-thirty-two-bytes';
const observedAt = '2026-08-04T12:00:00.000Z';

function metadata(frameworkId: string) {
  return {
    contractVersion: HERMES_CONTROL_VERSION,
    frameworkId,
    frameworkVersion: PINNED_HERMES_RELEASE,
    frameworkCommit: PINNED_HERMES_COMMIT,
    sourceVersion: `${PINNED_HERMES_RELEASE}+${PINNED_HERMES_COMMIT}`,
    observedAt,
  } as const;
}

function documents(frameworkId: string, instanceId: string) {
  const meta = metadata(frameworkId);
  return {
    '/control/v1/identity': {
      ...meta,
      data: { runtime: 'hermes-agent', instanceId, displayName: frameworkId },
    },
    '/control/v1/version': {
      ...meta,
      data: {
        release: PINNED_HERMES_RELEASE,
        commit: PINNED_HERMES_COMMIT,
        dirty: false,
        pythonVersion: '3.11.9',
      },
    },
    '/control/v1/health': {
      ...meta,
      data: { status: 'healthy', checks: { runtime: { status: 'healthy' } } },
    },
    '/control/v1/capabilities': {
      ...meta,
      data: {
        capabilities: {
          'profiles.read': { status: 'supported', modes: ['read'], requiredScopes: [] },
          'providers.read': { status: 'supported', modes: ['read'], requiredScopes: [] },
        },
      },
    },
  } as const;
}

class StaticCredentials implements GatewayCredentialProvider {
  constructor(public bundle: GatewayCredentialBundle) {}
  readonly calls: boolean[] = [];
  async resolve(_reference: string, forceRefresh = false): Promise<GatewayCredentialBundle> {
    this.calls.push(forceRefresh);
    return this.bundle;
  }
}

function client(options: {
  frameworkId?: string;
  instanceId?: string;
  token?: string;
  credentials?: GatewayCredentialProvider;
  fetchImpl: typeof fetch;
  retryLimit?: number;
  requestTimeoutMs?: number;
  circuit?: MemoryCircuitBreaker;
}) {
  const frameworkId = options.frameworkId ?? 'hermes-alica';
  const instanceId = options.instanceId ?? 'alica-private-1';
  return new HermesFrameworkClient({
    endpoint: 'https://10.20.0.2',
    credentialReference: 'secret://frameworks/alica',
    expectedNativeFrameworkId: frameworkId,
    expectedInstanceId: instanceId,
    expectedRelease: PINNED_HERMES_RELEASE,
    expectedCommit: PINNED_HERMES_COMMIT,
    policy: {
      ...DEFAULT_FRAMEWORK_GATEWAY_POLICY,
      retryLimit: options.retryLimit ?? 0,
      requestTimeoutMs: options.requestTimeoutMs ?? 1_000,
    },
    credentials:
      options.credentials ??
      new StaticCredentials({ active: { version: 'v1', token: options.token ?? TOKEN_A } }),
    endpointGuard: new DnsPrivateEndpointGuard(),
    fetchImpl: options.fetchImpl,
    sleep: async () => undefined,
    ...(options.circuit ? { circuit: options.circuit } : {}),
  });
}

function response(document: unknown, status = 200): Response {
  return new Response(JSON.stringify(document), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bearer(init: RequestInit | undefined): string {
  return new Headers(init?.headers).get('authorization') ?? '';
}

test('private network guard requires HTTPS and exclusively private DNS results', async () => {
  const privateGuard = new DnsPrivateEndpointGuard(async () => [
    { address: '10.0.0.4', family: 4 },
    { address: 'fd00::4', family: 6 },
  ]);
  await privateGuard.assertPrivate(new URL('https://framework.internal'));
  await new DnsPrivateEndpointGuard().assertPrivate(new URL('https://[::1]:8443'));
  const mixedGuard = new DnsPrivateEndpointGuard(async () => [
    { address: '10.0.0.4', family: 4 },
    { address: '8.8.8.8', family: 4 },
  ]);
  await assert.rejects(
    mixedGuard.assertPrivate(new URL('https://framework.internal')),
    (error: unknown) => (error as FrameworkGatewayError).code === 'framework_endpoint_not_private',
  );
  await assert.rejects(privateGuard.assertPrivate(new URL('http://framework.internal')));
  await assert.rejects(
    privateGuard.assertPrivate(new URL('https://user:secret@framework.internal')),
  );
  assert.equal(isPrivateAddress('192.168.2.2'), true);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
});

test('validates identity, version, health, capabilities, and keeps framework credentials isolated', async () => {
  const expected = new Map([
    ['10.20.0.2', { token: TOKEN_A, documents: documents('hermes-alica', 'alica-private-1') }],
    ['10.20.0.3', { token: TOKEN_B, documents: documents('hermes-herman', 'herman-private-1') }],
  ]);
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const target = expected.get(url.hostname)!;
    assert.equal(bearer(init), `Bearer ${target.token}`);
    return response(target.documents[url.pathname as keyof typeof target.documents]);
  };
  const alica = client({ fetchImpl: transport });
  const herman = new HermesFrameworkClient({
    endpoint: 'https://10.20.0.3',
    credentialReference: 'secret://frameworks/herman',
    expectedNativeFrameworkId: 'hermes-herman',
    expectedInstanceId: 'herman-private-1',
    expectedRelease: PINNED_HERMES_RELEASE,
    expectedCommit: PINNED_HERMES_COMMIT,
    policy: { ...DEFAULT_FRAMEWORK_GATEWAY_POLICY, retryLimit: 0 },
    credentials: new StaticCredentials({ active: { version: 'v9', token: TOKEN_B } }),
    endpointGuard: new DnsPrivateEndpointGuard(),
    fetchImpl: transport,
  });
  const [alicaInspection, hermanInspection] = await Promise.all([
    alica.inspect(),
    herman.inspect(),
  ]);
  assert.equal(alicaInspection.identity.data.instanceId, 'alica-private-1');
  assert.equal(hermanInspection.identity.data.instanceId, 'herman-private-1');
  assert.equal(alicaInspection.credentialVersion, 'v1');
  assert.equal(hermanInspection.credentialVersion, 'v9');
});

test('retries transient failures but rejects invalid contracts and pinned identity mismatches', async () => {
  let attempts = 0;
  const valid = documents('hermes-alica', 'alica-private-1')['/control/v1/identity'];
  const retried = client({
    retryLimit: 2,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? response({}, 503) : response(valid);
    },
  });
  assert.equal((await retried.identity()).data.instanceId, 'alica-private-1');
  assert.equal(attempts, 3);

  await assert.rejects(
    client({ fetchImpl: async () => response({ ...valid, unexpected: true }) }).identity(),
    (error: unknown) => (error as FrameworkGatewayError).code === 'framework_contract_invalid',
  );
  await assert.rejects(
    client({
      fetchImpl: async () =>
        response(documents('hermes-other', 'alica-private-1')['/control/v1/identity']),
    }).identity(),
    (error: unknown) => (error as FrameworkGatewayError).code === 'framework_identity_mismatch',
  );
});

test('times out bounded requests and opens then half-opens the circuit', async () => {
  let now = 1_000;
  const circuit = new MemoryCircuitBreaker(2, 500, () => now);
  const unavailable = client({
    circuit,
    requestTimeoutMs: 20,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('timeout signal did not fire')), 1_000);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(keepAlive);
            reject(new Error('aborted'));
          },
          { once: true },
        );
      }),
  });
  await assert.rejects(
    unavailable.identity(),
    (error: unknown) => (error as FrameworkGatewayError).code === 'framework_timeout',
  );
  await assert.rejects(unavailable.identity());
  assert.equal(circuit.snapshot().state, 'open');
  await assert.rejects(
    unavailable.identity(),
    (error: unknown) => (error as FrameworkGatewayError).code === 'framework_circuit_open',
  );
  now += 501;
  const valid = documents('hermes-alica', 'alica-private-1')['/control/v1/identity'];
  const recovered = client({ circuit, fetchImpl: async () => response(valid) });
  assert.equal((await recovered.identity()).data.instanceId, 'alica-private-1');
  assert.equal(circuit.snapshot().state, 'closed');
});

test('refreshes a rejected token and supports an overlap credential during rotation', async () => {
  const credentials = new StaticCredentials({ active: { version: 'old', token: TOKEN_A } });
  const rotated = 'rotated-token-that-is-at-least-thirty-two-bytes';
  credentials.resolve = async (_reference: string, forceRefresh = false) => {
    credentials.calls.push(forceRefresh);
    return forceRefresh
      ? {
          active: { version: 'new', token: rotated },
          retiring: { version: 'old', token: TOKEN_A },
        }
      : { active: { version: 'old', token: TOKEN_A } };
  };
  const valid = documents('hermes-alica', 'alica-private-1')['/control/v1/identity'];
  const gateway = client({
    credentials,
    fetchImpl: async (_input, init) =>
      bearer(init) === `Bearer ${rotated}` ? response(valid) : response({}, 401),
  });
  assert.equal((await gateway.identity()).data.instanceId, 'alica-private-1');
  assert.deepEqual(credentials.calls, [false, true]);
});

test('validates credential documents and complete independent environment configuration', () => {
  assert.equal(
    parseCredentialBundle({ active: { version: 'v1', token: TOKEN_A } }).active.version,
    'v1',
  );
  assert.throws(() =>
    parseCredentialBundle({
      active: { version: 'v1', token: TOKEN_A },
      retiring: { version: 'v1', token: TOKEN_B },
    }),
  );
  assert.equal(frameworkGatewayConfigFromEnvironment({}), undefined);
  assert.throws(() =>
    frameworkGatewayConfigFromEnvironment({ CORE_ALICA_FRAMEWORK_ID: 'frm_partial' }),
  );
  const common = {
    CORE_ALICA_FRAMEWORK_ID: 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    CORE_ALICA_ENDPOINT: 'https://10.20.0.2',
    CORE_ALICA_CREDENTIAL_REFERENCE: 'secret://frameworks/alica',
    CORE_ALICA_NATIVE_FRAMEWORK_ID: 'hermes-alica',
    CORE_ALICA_INSTANCE_ID: 'alica-private-1',
    CORE_ALICA_RELEASE: PINNED_HERMES_RELEASE,
    CORE_ALICA_COMMIT: PINNED_HERMES_COMMIT,
    CORE_HERMAN_FRAMEWORK_ID: 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    CORE_HERMAN_ENDPOINT: 'https://10.20.0.3',
    CORE_HERMAN_CREDENTIAL_REFERENCE: 'secret://frameworks/herman',
    CORE_HERMAN_NATIVE_FRAMEWORK_ID: 'hermes-herman',
    CORE_HERMAN_INSTANCE_ID: 'herman-private-1',
    CORE_HERMAN_RELEASE: PINNED_HERMES_RELEASE,
    CORE_HERMAN_COMMIT: PINNED_HERMES_COMMIT,
    CORE_FRAMEWORK_GATEWAY_SECRET_ROOT: '/run/secrets/unify-frameworks',
  };
  const config = frameworkGatewayConfigFromEnvironment(common)!;
  assert.equal(config.alica.credentialReference, 'secret://frameworks/alica');
  assert.equal(config.herman.credentialReference, 'secret://frameworks/herman');
  assert.notEqual(config.alica.endpoint, config.herman.endpoint);
});
