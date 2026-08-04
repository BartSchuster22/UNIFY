import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
  API_ENDPOINTS,
  CANONICAL_ID_PREFIXES,
  CORE_API_DOMAINS,
  CapabilityNegotiationResultSchema,
  type CapabilityDocument,
  CommandSchemas,
  HermesCapabilityDocumentSchema,
  LoginInputSchema,
  buildCoreV1OpenApi,
  getCoreV1SchemaCatalog,
  isCanonicalId,
  negotiateCapabilities,
} from './index.js';

const ids = {
  user: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  framework: 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  command: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  request: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  correlation: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV',
};

const timestamp = '2026-08-04T12:00:00Z';

function references() {
  return Object.values(getCoreV1SchemaCatalog());
}

test('defines all native API domains with unique operations', () => {
  assert.deepEqual(CORE_API_DOMAINS, [
    'identity',
    'frameworks',
    'profiles',
    'models',
    'work',
    'conversations',
    'notifications',
    'operations',
    'audit',
  ]);
  for (const domain of CORE_API_DOMAINS)
    assert.ok(
      API_ENDPOINTS.some((endpoint) => endpoint.domain === domain),
      `missing ${domain}`,
    );
  assert.equal(
    new Set(API_ENDPOINTS.map((endpoint) => endpoint.operationId)).size,
    API_ENDPOINTS.length,
  );
  assert.equal(
    new Set(API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).size,
    API_ENDPOINTS.length,
  );
});

test('uses strict command envelopes for control-plane mutations', () => {
  for (const endpoint of API_ENDPOINTS.filter((candidate) =>
    ['post', 'put', 'patch', 'delete'].includes(candidate.method),
  )) {
    if (endpoint.domain === 'identity' || endpoint.operationId === 'frameworkNegotiateCapabilities')
      continue;
    assert.ok(
      endpoint.requestSchema?.endsWith('Command'),
      `${endpoint.operationId} lacks a command envelope`,
    );
    assert.equal(endpoint.successSchema, 'CommandAccepted');
  }

  const schema = CommandSchemas.FrameworkCreateCommand!;
  const valid = {
    contractVersion: 'core.v1',
    commandId: ids.command,
    commandType: 'framework.create.v1',
    idempotencyKey: 'framework-create:01ARZ3NDEKTSV4RRFFQ69G5FAV',
    issuedAt: timestamp,
    target: { kind: 'framework' },
    payload: {
      name: 'Alica',
      endpoint: 'https://framework.internal',
      credentialReference: 'secret://frameworks/alica',
    },
  };
  assert.equal(Value.Check(schema, references(), valid), true);
  assert.equal(Value.Check(schema, references(), { ...valid, legacyOwner: 'x' }), false);
  assert.equal(
    Value.Check(schema, references(), {
      ...valid,
      payload: { ...valid.payload, unexpected: true },
    }),
    false,
  );
});

test('enforces canonical prefixed ULIDs', () => {
  assert.equal(isCanonicalId(ids.user, 'user'), true);
  assert.equal(isCanonicalId(ids.user, 'framework'), false);
  assert.equal(isCanonicalId('user-123'), false);
  assert.equal(
    Object.keys(CANONICAL_ID_PREFIXES).length,
    new Set(Object.values(CANONICAL_ID_PREFIXES)).size,
  );
});

test('rejects unknown authentication properties', () => {
  assert.equal(
    Value.Check(LoginInputSchema, { username: 'admin', password: 'correct horse battery staple' }),
    true,
  );
  assert.equal(
    Value.Check(LoginInputSchema, {
      username: 'admin',
      password: 'correct horse battery staple',
      role: 'admin',
    }),
    false,
  );
});

test('validates and negotiates Hermes capabilities without inventing support', () => {
  const advertisement: CapabilityDocument = {
    protocol: 'hermes-control',
    protocolVersion: '1.0.0',
    frameworkId: ids.framework,
    frameworkInstance: 'alica-primary',
    frameworkVersion: '1.4.0',
    documentVersion: 7,
    issuedAt: timestamp,
    expiresAt: '2026-08-04T12:05:00Z',
    schemaDigest: 'a'.repeat(64),
    capabilities: [
      {
        name: 'profiles.read',
        version: '1.2.0',
        availability: 'supported',
        operations: ['read'],
        constraints: {
          supportsIdempotency: true,
          supportsExpectedVersion: true,
          transports: ['https'],
        },
      },
      {
        name: 'profiles.delete',
        version: '1.0.0',
        availability: 'temporarily-unavailable',
        operations: ['delete'],
        constraints: {
          supportsIdempotency: true,
          supportsExpectedVersion: true,
          transports: ['https'],
        },
        unavailableReason: 'Maintenance window.',
      },
    ],
  };
  assert.equal(Value.Check(HermesCapabilityDocumentSchema, advertisement), true);
  assert.equal(
    Value.Check(HermesCapabilityDocumentSchema, { ...advertisement, adapterId: 'forbidden' }),
    false,
  );

  const result = negotiateCapabilities(
    advertisement,
    [
      {
        name: 'profiles.read',
        minimumVersion: '1.0.0',
        requiredOperations: ['read'],
        required: true,
      },
      {
        name: 'profiles.delete',
        minimumVersion: '1.0.0',
        requiredOperations: ['delete'],
        required: false,
      },
    ],
    timestamp,
  );
  assert.equal(result.status, 'degraded');
  assert.deepEqual(
    result.effectiveCapabilities.map((item) => item.name),
    ['profiles.read'],
  );
  assert.equal(result.rejections[0]?.code, 'temporarily-unavailable');
  assert.equal(Value.Check(CapabilityNegotiationResultSchema, references(), result), true);
});

test('emits a complete strict OpenAPI 3.1 contract', () => {
  const document = buildCoreV1OpenApi() as {
    openapi: string;
    servers: Array<{ url: string }>;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  };
  assert.equal(document.openapi, '3.1.0');
  assert.equal(document.servers[0]?.url, '/core/v1');
  assert.equal(Object.keys(document.paths).length > 40, true);
  assert.equal(Object.keys(document.components.schemas).length > 70, true);
  assert.deepEqual(Object.keys(document.components.securitySchemes).sort(), [
    'cookieSession',
    'csrfToken',
    'serviceBearer',
  ]);

  const referencesInDocument = [
    ...JSON.stringify(document).matchAll(/#\/components\/schemas\/([A-Za-z0-9]+)/g),
  ].map((match) => match[1]!);
  for (const reference of referencesInDocument)
    assert.ok(document.components.schemas[reference], `unresolved schema ${reference}`);

  for (const endpoint of API_ENDPOINTS) {
    const operation = document.paths[endpoint.path]?.[endpoint.method] as {
      parameters: Array<{ name: string; in: string; schema: { pattern?: string } }>;
      security: Array<Record<string, unknown>>;
      'x-unify-reject-unknown-query': boolean;
    };
    assert.equal(operation['x-unify-reject-unknown-query'], true);
    for (const parameter of operation.parameters.filter((candidate) => candidate.in === 'path')) {
      assert.match(parameter.schema.pattern ?? '', /^\^[a-z]{3}_/);
    }
    if (endpoint.operationId.endsWith('List')) {
      assert.deepEqual(
        operation.parameters
          .filter((candidate) => candidate.in === 'query')
          .map((candidate) => candidate.name),
        ['cursor', 'limit'],
      );
    }
  }

  const passwordChange = document.paths['/identity/password-changes']?.post as {
    security: Array<Record<string, unknown>>;
  };
  assert.deepEqual(passwordChange.security, [{ cookieSession: [], csrfToken: [] }]);
});

test('keeps historical application terminology out of production contracts', () => {
  const contract = JSON.stringify(buildCoreV1OpenApi());
  const forbidden = [
    'worker',
    'agency',
    'dmm',
    'agent-chat',
    'harness',
    'adapter',
    'kanban',
    'chat',
  ];
  for (const term of forbidden)
    assert.equal(
      new RegExp(`(?:^|[^a-z])${term}(?:[^a-z]|$)`, 'i').test(contract),
      false,
      `forbidden contract term: ${term}`,
    );
});

test('compiles every published JSON schema', () => {
  const catalog = getCoreV1SchemaCatalog();
  const all = Object.values(catalog);
  for (const [name, schema] of Object.entries(catalog)) {
    assert.doesNotThrow(
      () =>
        TypeCompiler.Compile(
          schema,
          all.filter((candidate) => candidate !== schema),
        ),
      `schema did not compile: ${name}`,
    );
  }
});

test('makes every property-bearing object closed', () => {
  const seen = new Set<unknown>();
  const inspect = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const schema = node as Record<string, unknown>;
    if (schema.type === 'object' && schema.properties) {
      assert.equal(schema.additionalProperties, false, `${path} accepts unknown properties`);
    }
    for (const [key, value] of Object.entries(schema)) inspect(value, `${path}.${key}`);
  };
  inspect(buildCoreV1OpenApi(), 'openapi');
});
