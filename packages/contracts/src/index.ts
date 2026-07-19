import { FormatRegistry, Type, type Static, type TSchema } from '@sinclair/typebox';

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (value) => !Number.isNaN(Date.parse(value)));
}

export const TruthStateSchema = Type.Union(
  [
    Type.Literal('current'),
    Type.Literal('stale'),
    Type.Literal('partial'),
    Type.Literal('empty'),
    Type.Literal('unavailable'),
    Type.Literal('unsupported'),
    Type.Literal('forbidden'),
    Type.Literal('failed'),
    Type.Literal('inconclusive'),
  ],
  { $id: 'TruthState' },
);
export type TruthState = Static<typeof TruthStateSchema>;

export const ResourceKindSchema = Type.Union(
  [
    Type.Literal('framework'),
    Type.Literal('profile'),
    Type.Literal('agent'),
    Type.Literal('provider'),
    Type.Literal('model'),
    Type.Literal('project'),
    Type.Literal('task'),
    Type.Literal('cronjob'),
    Type.Literal('chat-session'),
    Type.Literal('memory-record'),
    Type.Literal('operation'),
    Type.Literal('notification'),
  ],
  { $id: 'ResourceKind' },
);

export const ResourceOwnerSchema = Type.Union(
  [
    Type.Literal('hermes'),
    Type.Literal('agency'),
    Type.Literal('dmm'),
    Type.Literal('worker'),
    Type.Literal('chat'),
    Type.Literal('memory-v4'),
    Type.Literal('gateway'),
  ],
  { $id: 'ResourceOwner' },
);

export const ResourceRefSchema = Type.Object(
  {
    canonicalId: Type.String({ minLength: 1, maxLength: 1024 }),
    kind: ResourceKindSchema,
    owner: ResourceOwnerSchema,
    frameworkId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    nativeId: Type.String({ minLength: 1, maxLength: 1024 }),
    displayLabel: Type.Optional(Type.String({ maxLength: 500 })),
    sourceVersion: Type.Optional(Type.String({ maxLength: 500 })),
    observedAt: Type.String({ format: 'date-time' }),
    links: Type.Optional(
      Type.Array(Type.Object({ relation: Type.String(), canonicalId: Type.String() })),
    ),
  },
  { $id: 'ResourceRef', additionalProperties: false },
);
export type ResourceRef = Static<typeof ResourceRefSchema>;

export const WarningSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    message: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { $id: 'Warning', additionalProperties: false },
);

export const ResponseMetaSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    source: Type.Object(
      {
        owner: ResourceOwnerSchema,
        frameworkId: Type.Optional(Type.String()),
        adapterId: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    sourceStatus: Type.String({ minLength: 1 }),
    freshness: TruthStateSchema,
    observedAt: Type.Optional(Type.String({ format: 'date-time' })),
    generatedAt: Type.String({ format: 'date-time' }),
    warnings: Type.Array(WarningSchema),
    page: Type.Optional(
      Type.Object(
        {
          nextCursor: Type.Optional(Type.String()),
          hasMore: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'ResponseMeta', additionalProperties: false },
);
export type ResponseMeta = Static<typeof ResponseMetaSchema>;

export const ApiErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    message: Type.String({ minLength: 1, maxLength: 1000 }),
    requestId: Type.String({ minLength: 1 }),
    retryable: Type.Boolean(),
    target: Type.Optional(ResourceRefSchema),
    fields: Type.Optional(Type.Array(Type.Object({ field: Type.String(), reason: Type.String() }))),
    policyReasons: Type.Optional(Type.Array(Type.String())),
    evidenceId: Type.Optional(Type.String()),
  },
  { $id: 'ApiError', additionalProperties: false },
);
export type ApiError = Static<typeof ApiErrorSchema>;

export const ErrorResponseSchema = Type.Object(
  { error: ApiErrorSchema },
  {
    $id: 'ErrorResponse',
    additionalProperties: false,
  },
);

export const CapabilityModeSchema = Type.Union(
  [
    Type.Literal('read'),
    Type.Literal('validate'),
    Type.Literal('dry-run'),
    Type.Literal('execute'),
    Type.Literal('verify'),
    Type.Literal('subscribe'),
  ],
  { $id: 'CapabilityMode' },
);

export const CapabilityManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal('1.0'),
    adapterId: Type.String({ minLength: 1 }),
    adapterVersion: Type.String({ minLength: 1 }),
    frameworkId: Type.Optional(Type.String()),
    observedAt: Type.String({ format: 'date-time' }),
    capabilities: Type.Record(
      Type.String(),
      Type.Object(
        {
          supported: Type.Boolean(),
          modes: Type.Optional(Type.Array(CapabilityModeSchema, { uniqueItems: true })),
          constraints: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          reason: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'CapabilityManifest', additionalProperties: false },
);
export type CapabilityManifest = Static<typeof CapabilityManifestSchema>;

export const EventEnvelopeSchema = Type.Object(
  {
    eventId: Type.String({ minLength: 1 }),
    sequence: Type.String({ minLength: 1 }),
    type: Type.String({ minLength: 1, maxLength: 200 }),
    classification: Type.Union([Type.Literal('durable'), Type.Literal('ephemeral')]),
    source: Type.Object({ owner: ResourceOwnerSchema, frameworkId: Type.Optional(Type.String()) }),
    resource: Type.Optional(ResourceRefSchema),
    eventTime: Type.String({ format: 'date-time' }),
    receivedTime: Type.String({ format: 'date-time' }),
    correlationId: Type.Optional(Type.String()),
    operationId: Type.Optional(Type.String()),
    payload: Type.Record(Type.String(), Type.Unknown()),
    schemaVersion: Type.Literal('1.0'),
  },
  { $id: 'EventEnvelope', additionalProperties: false },
);
export type EventEnvelope = Static<typeof EventEnvelopeSchema>;

export const OperationStateSchema = Type.Union(
  [
    Type.Literal('pending'),
    Type.Literal('validated'),
    Type.Literal('preflighted'),
    Type.Literal('awaiting_confirmation'),
    Type.Literal('executing'),
    Type.Literal('applied'),
    Type.Literal('verifying'),
    Type.Literal('verified'),
    Type.Literal('denied'),
    Type.Literal('failed'),
    Type.Literal('inconclusive'),
    Type.Literal('rolling_back'),
    Type.Literal('rolled_back'),
    Type.Literal('rollback_failed'),
  ],
  { $id: 'OperationState' },
);

export const OperationSchema = Type.Object(
  {
    operationId: Type.String({ minLength: 1 }),
    operationType: Type.String({ minLength: 1 }),
    actorId: Type.String({ minLength: 1 }),
    target: ResourceRefSchema,
    payloadHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    mode: Type.Union([
      Type.Literal('validate'),
      Type.Literal('dry-run'),
      Type.Literal('execute'),
      Type.Literal('verify'),
      Type.Literal('rollback'),
    ]),
    idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    sourceVersion: Type.Optional(Type.String()),
    policyDecision: Type.Union([
      Type.Literal('pending'),
      Type.Literal('allowed'),
      Type.Literal('denied'),
    ]),
    state: OperationStateSchema,
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    evidenceIds: Type.Array(Type.String()),
  },
  { $id: 'Operation', additionalProperties: false },
);
export type Operation = Static<typeof OperationSchema>;

export const LoginRequestSchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 200 }),
    password: Type.String({ minLength: 12, maxLength: 1024 }),
  },
  { $id: 'LoginRequest', additionalProperties: false },
);

export const PrincipalSchema = Type.Object(
  {
    userId: Type.String(),
    username: Type.String(),
    displayName: Type.String(),
    roles: Type.Array(Type.String()),
    permissions: Type.Array(Type.String()),
  },
  { $id: 'Principal', additionalProperties: false },
);
export type Principal = Static<typeof PrincipalSchema>;

export const HealthSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('ok'), Type.Literal('ready'), Type.Literal('not_ready')]),
    release: Type.String(),
  },
  { $id: 'Health', additionalProperties: false },
);

const schemas: TSchema[] = [
  TruthStateSchema,
  ResourceKindSchema,
  ResourceOwnerSchema,
  ResourceRefSchema,
  WarningSchema,
  ResponseMetaSchema,
  ApiErrorSchema,
  ErrorResponseSchema,
  CapabilityModeSchema,
  CapabilityManifestSchema,
  EventEnvelopeSchema,
  OperationStateSchema,
  OperationSchema,
  LoginRequestSchema,
  PrincipalSchema,
  HealthSchema,
];

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Aquiero Unified Gateway',
      version: '1.0.0',
      description: 'Gateway-only public contract for UNIFY.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [{ name: 'health' }, { name: 'auth' }, { name: 'operations' }],
    paths: {
      '/health/live': {
        get: {
          tags: ['health'],
          operationId: 'getLiveness',
          responses: { '200': jsonResponse('Health') },
        },
      },
      '/health/ready': {
        get: {
          tags: ['health'],
          operationId: 'getReadiness',
          responses: { '200': jsonResponse('Health'), '503': jsonResponse('Health') },
        },
      },
      '/auth/login': {
        post: {
          tags: ['auth'],
          operationId: 'login',
          requestBody: jsonBody('LoginRequest'),
          responses: {
            '200': jsonResponse('Principal'),
            '401': jsonResponse('ErrorResponse'),
            '429': jsonResponse('ErrorResponse'),
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['auth'],
          operationId: 'logout',
          security: [{ cookieSession: [], csrfToken: [] }],
          responses: { '204': { description: 'Logged out' }, '401': jsonResponse('ErrorResponse') },
        },
      },
      '/auth/me': {
        get: {
          tags: ['auth'],
          operationId: 'getCurrentPrincipal',
          security: [{ cookieSession: [] }],
          responses: { '200': jsonResponse('Principal'), '401': jsonResponse('ErrorResponse') },
        },
      },
      '/operations/{operationId}': {
        get: {
          tags: ['operations'],
          operationId: 'getOperation',
          security: [{ cookieSession: [] }],
          parameters: [
            { name: 'operationId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': jsonResponse('Operation'), '404': jsonResponse('ErrorResponse') },
        },
      },
    },
    components: {
      securitySchemes: {
        cookieSession: { type: 'apiKey', in: 'cookie', name: 'aquiero_session' },
        csrfToken: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      },
      schemas: Object.fromEntries(schemas.map((schema) => [schema.$id, schema])),
    },
  };
}
function jsonResponse(schema: string): Record<string, unknown> {
  return {
    description: schema,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
  };
}
function jsonBody(schema: string): Record<string, unknown> {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
  };
}
