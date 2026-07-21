import { FormatRegistry, Type, type Static, type TSchema } from '@sinclair/typebox';
import { HermesControlSchemas } from './hermes-control.js';
export * from './hermes-control.js';

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
    Type.Literal('kanban-board'),
    Type.Literal('cronjob'),
    Type.Literal('chat-session'),
    Type.Literal('chat-message'),
    Type.Literal('chat-route'),
    Type.Literal('memory-record'),
    Type.Literal('catalog-snapshot'),
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

/**
 * Legacy owner values are migration provenance only. A resource carrying one of
 * those values must use sourceRole=migration-only and authoritative=false.
 */
export const SourceRoleSchema = Type.Union(
  [Type.Literal('authoritative'), Type.Literal('migration-only')],
  { $id: 'SourceRole' },
);
export type SourceRole = Static<typeof SourceRoleSchema>;

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

export const OperationListSchema = Type.Object(
  { items: Type.Array(OperationSchema), meta: ResponseMetaSchema },
  { $id: 'OperationList', additionalProperties: false },
);
export const AuditEventSchema = Type.Object(
  {
    id: Type.String(),
    eventType: Type.String(),
    actorId: Type.Union([Type.String(), Type.Null()]),
    outcome: Type.String(),
    requestId: Type.String(),
    correlationId: Type.String(),
    operationId: Type.Union([Type.String(), Type.Null()]),
    frameworkId: Type.Union([Type.String(), Type.Null()]),
    resource: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
    safeMetadata: Type.Record(Type.String(), Type.Unknown()),
    previousEventHash: Type.Union([Type.String(), Type.Null()]),
    eventHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    occurredAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'AuditEvent', additionalProperties: false },
);
export const AuditEventListSchema = Type.Object(
  { items: Type.Array(AuditEventSchema), meta: ResponseMetaSchema },
  { $id: 'AuditEventList', additionalProperties: false },
);

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

export const SessionSummarySchema = Type.Object(
  {
    id: Type.String(),
    userId: Type.String(),
    deviceLabel: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    lastSeenAt: Type.String({ format: 'date-time' }),
    expiresAt: Type.String({ format: 'date-time' }),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { $id: 'SessionSummary', additionalProperties: false },
);
export const SessionListSchema = Type.Object(
  { items: Type.Array(SessionSummarySchema) },
  { $id: 'SessionList', additionalProperties: false },
);

export const HealthSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('ok'), Type.Literal('ready'), Type.Literal('not_ready')]),
    release: Type.String(),
  },
  { $id: 'Health', additionalProperties: false },
);

const UnifiedResourceProperties = {
  resource: ResourceRefSchema,
  truth: TruthStateSchema,
  adapterId: Type.String({ minLength: 1 }),
  fetchedAt: Type.String({ format: 'date-time' }),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  searchableText: Type.String({ maxLength: 10000 }),
  data: Type.Record(Type.String(), Type.Unknown()),
};

export const UnifiedResourceSchema = Type.Union(
  [
    Type.Object(
      {
        ...UnifiedResourceProperties,
        authoritative: Type.Literal(true),
        sourceRole: Type.Literal('authoritative'),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...UnifiedResourceProperties,
        authoritative: Type.Literal(false),
        sourceRole: Type.Literal('migration-only'),
      },
      { additionalProperties: false },
    ),
  ],
  { $id: 'UnifiedResource' },
);
export type UnifiedResource = Static<typeof UnifiedResourceSchema>;

export const IntegrationStatusSchema = Type.Object(
  {
    adapterId: Type.String(),
    owners: Type.Array(ResourceOwnerSchema),
    sourceRole: SourceRoleSchema,
    writeEnabled: Type.Boolean(),
    status: TruthStateSchema,
    observedAt: Type.Optional(Type.String({ format: 'date-time' })),
    resourceCount: Type.Integer({ minimum: 0 }),
    warnings: Type.Array(WarningSchema),
  },
  { $id: 'IntegrationStatus', additionalProperties: false },
);
export const IntegrationStatusListSchema = Type.Object(
  { items: Type.Array(IntegrationStatusSchema) },
  { $id: 'IntegrationStatusList', additionalProperties: false },
);
export const UnifiedResourceListSchema = Type.Object(
  { items: Type.Array(UnifiedResourceSchema), meta: ResponseMetaSchema },
  { $id: 'UnifiedResourceList', additionalProperties: false },
);
export const UnifiedSearchHitSchema = Type.Object(
  {
    resource: UnifiedResourceSchema,
    score: Type.Number(),
    matchedFields: Type.Array(Type.String()),
  },
  { $id: 'UnifiedSearchHit', additionalProperties: false },
);
export const UnifiedSearchResultsSchema = Type.Object(
  { items: Type.Array(UnifiedSearchHitSchema), meta: ResponseMetaSchema },
  { $id: 'UnifiedSearchResults', additionalProperties: false },
);
export const UnifiedNotificationSchema = Type.Object(
  {
    id: Type.String(),
    severity: Type.Union([
      Type.Literal('info'),
      Type.Literal('warning'),
      Type.Literal('error'),
      Type.Literal('critical'),
    ]),
    title: Type.String(),
    body: Type.String(),
    source: ResourceOwnerSchema,
    state: Type.Union([Type.Literal('unread'), Type.Literal('read'), Type.Literal('acknowledged')]),
    createdAt: Type.String({ format: 'date-time' }),
    deepLink: Type.Optional(Type.String({ pattern: '^/\\?' })),
    resource: Type.Optional(ResourceRefSchema),
  },
  { $id: 'UnifiedNotification', additionalProperties: false },
);
export const UnifiedNotificationListSchema = Type.Object(
  { items: Type.Array(UnifiedNotificationSchema), meta: ResponseMetaSchema },
  { $id: 'UnifiedNotificationList', additionalProperties: false },
);
export const UnifiedEventListSchema = Type.Object(
  { items: Type.Array(EventEnvelopeSchema), meta: ResponseMetaSchema },
  { $id: 'UnifiedEventList', additionalProperties: false },
);
export const ShadowComparisonSchema = Type.Object(
  {
    adapterId: Type.String(),
    owner: ResourceOwnerSchema,
    status: Type.Union([
      Type.Literal('match'),
      Type.Literal('mismatch'),
      Type.Literal('unavailable'),
    ]),
    comparedAt: Type.String({ format: 'date-time' }),
    expectedCount: Type.Integer({ minimum: 0 }),
    actualCount: Type.Integer({ minimum: 0 }),
    missing: Type.Array(Type.String()),
    unexpected: Type.Array(Type.String()),
    changed: Type.Array(Type.String()),
    evidenceHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { $id: 'ShadowComparison', additionalProperties: false },
);
export const ShadowComparisonListSchema = Type.Object(
  { items: Type.Array(ShadowComparisonSchema), meta: ResponseMetaSchema },
  { $id: 'ShadowComparisonList', additionalProperties: false },
);

export const MutationTargetSchema = Type.Object(
  {
    owner: Type.Union([
      Type.Literal('hermes'),
      Type.Literal('dmm'),
      Type.Literal('worker'),
      Type.Literal('chat'),
      Type.Literal('memory-v4'),
    ]),
    kind: Type.String({ minLength: 1, maxLength: 200 }),
    nativeId: Type.String({ minLength: 1, maxLength: 1024 }),
    frameworkId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { $id: 'MutationTarget', additionalProperties: false },
);
export const MutationRequestSchema = Type.Object(
  {
    operationType: Type.String({ minLength: 1, maxLength: 200 }),
    target: MutationTargetSchema,
    payload: Type.Record(Type.String(), Type.Unknown()),
    mode: Type.Union([Type.Literal('validate'), Type.Literal('dry-run'), Type.Literal('execute')]),
    confirmed: Type.Boolean(),
  },
  { $id: 'MutationRequest', additionalProperties: false },
);
export const MutationResponseSchema = Type.Object(
  {
    replayed: Type.Boolean(),
    operation: OperationSchema,
    result: Type.Unknown(),
  },
  { $id: 'MutationResponse', additionalProperties: false },
);
export type MutationTarget = Static<typeof MutationTargetSchema>;
export type MutationRequest = Static<typeof MutationRequestSchema>;
export type MutationResponse = Static<typeof MutationResponseSchema>;

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
  OperationListSchema,
  AuditEventSchema,
  AuditEventListSchema,
  LoginRequestSchema,
  PrincipalSchema,
  SessionSummarySchema,
  SessionListSchema,
  HealthSchema,
  UnifiedResourceSchema,
  IntegrationStatusSchema,
  IntegrationStatusListSchema,
  UnifiedResourceListSchema,
  UnifiedSearchHitSchema,
  UnifiedSearchResultsSchema,
  UnifiedNotificationSchema,
  UnifiedNotificationListSchema,
  UnifiedEventListSchema,
  ShadowComparisonSchema,
  ShadowComparisonListSchema,
  MutationTargetSchema,
  MutationRequestSchema,
  MutationResponseSchema,
  ...HermesControlSchemas,
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
    tags: [
      { name: 'health' },
      { name: 'auth' },
      { name: 'sessions' },
      { name: 'operations' },
      { name: 'mutations' },
      { name: 'audit' },
      { name: 'integrations' },
      { name: 'frameworks' },
      { name: 'search' },
      { name: 'events' },
      { name: 'notifications' },
      { name: 'shadow' },
    ],
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
      '/sessions': {
        get: {
          tags: ['sessions'],
          operationId: 'listSessions',
          security: [{ cookieSession: [] }],
          responses: {
            '200': jsonResponse('SessionList'),
            '401': jsonResponse('ErrorResponse'),
          },
        },
      },
      '/sessions/{sessionId}': {
        delete: {
          tags: ['sessions'],
          operationId: 'revokeSession',
          security: [{ cookieSession: [], csrfToken: [] }],
          parameters: [
            { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': { description: 'Revoked' },
            '401': jsonResponse('ErrorResponse'),
            '403': jsonResponse('ErrorResponse'),
            '404': jsonResponse('ErrorResponse'),
          },
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
      '/operations': readPath('operations', 'listOperations', 'OperationList'),
      '/mutations': {
        post: {
          tags: ['mutations'],
          operationId: 'executeMutation',
          security: [{ cookieSession: [], csrfToken: [] }],
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 200 },
            },
          ],
          requestBody: jsonBody('MutationRequest'),
          responses: {
            '200': jsonResponse('MutationResponse'),
            '201': jsonResponse('MutationResponse'),
            '400': jsonResponse('ErrorResponse'),
            '401': jsonResponse('ErrorResponse'),
            '403': jsonResponse('ErrorResponse'),
            '409': jsonResponse('ErrorResponse'),
            '422': jsonResponse('ErrorResponse'),
            '502': jsonResponse('ErrorResponse'),
            '503': jsonResponse('ErrorResponse'),
          },
        },
      },
      '/chat/download': {
        get: {
          tags: ['mutations'],
          operationId: 'downloadChatUpload',
          security: [{ cookieSession: [] }],
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: { type: 'string', pattern: '^/uploads/[a-zA-Z0-9._-]+$' },
            },
          ],
          responses: {
            '200': {
              description: 'Authenticated chat upload download',
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', contentEncoding: 'binary' },
                },
              },
            },
            '401': jsonResponse('ErrorResponse'),
            '403': jsonResponse('ErrorResponse'),
            '422': jsonResponse('ErrorResponse'),
          },
        },
      },
      '/control/v1/identity': controlReadPath('getHermesAdapterIdentity', 'HermesIdentityResponse'),
      '/control/v1/health': controlReadPath('getHermesAdapterHealth', 'HermesHealthResponse'),
      '/control/v1/version': controlReadPath('getHermesAdapterVersion', 'HermesVersionResponse'),
      '/control/v1/capabilities': controlReadPath(
        'getHermesAdapterCapabilities',
        'HermesCapabilitiesResponse',
      ),
      '/control/v1/profiles': controlReadPath(
        'listHermesProfiles',
        'HermesProfilesResponse',
        controlPageParameters(),
      ),
      '/control/v1/providers': controlReadPath(
        'listHermesProviders',
        'HermesProvidersResponse',
        controlPageParameters(),
      ),
      '/control/v1/work/projects': controlReadPath(
        'listHermesProjects',
        'HermesProjectsResponse',
        controlPageParameters(),
      ),
      '/control/v1/work/boards': controlReadPath(
        'listHermesBoards',
        'HermesBoardsResponse',
        controlPageParameters(),
      ),
      '/control/v1/work/boards/{boardId}/tasks': controlReadPath(
        'listHermesTasks',
        'HermesTasksResponse',
        [
          {
            name: 'boardId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 200 },
          },
          ...controlPageParameters(),
        ],
      ),
      '/control/v1/work/cronjobs': controlReadPath(
        'listHermesCronjobs',
        'HermesCronjobsResponse',
        controlPageParameters(),
      ),
      '/control/v1/conversations/sessions': controlReadPath(
        'listHermesSessions',
        'HermesSessionsResponse',
        controlPageParameters(),
      ),
      '/control/v1/conversations/sessions/{sessionId}/messages': controlReadPath(
        'listHermesMessages',
        'HermesMessagesResponse',
        [
          {
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 300 },
          },
          ...controlPageParameters(),
        ],
      ),
      '/control/v1/events': controlReadPath(
        'listHermesAdapterEvents',
        'HermesEventsResponse',
        controlPageParameters(),
      ),
      '/control/v1/commands/work': {
        post: {
          tags: ['hermes-control'],
          operationId: 'executeHermesWorkCommand',
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('HermesWorkCommand'),
          responses: {
            '200': jsonResponse('HermesWorkResult'),
            '400': jsonResponse('HermesControlErrorResponse'),
            '401': jsonResponse('HermesControlErrorResponse'),
            '403': jsonResponse('HermesControlErrorResponse'),
            '409': jsonResponse('HermesControlErrorResponse'),
            '503': jsonResponse('HermesControlErrorResponse'),
          },
        },
      },
      '/control/v1/commands/reconcile': {
        post: {
          tags: ['hermes-control'],
          operationId: 'reconcileHermesAdapter',
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody('HermesControlCommand'),
          responses: {
            '200': jsonResponse('HermesReconcileResult'),
            '400': jsonResponse('HermesControlErrorResponse'),
            '401': jsonResponse('HermesControlErrorResponse'),
            '403': jsonResponse('HermesControlErrorResponse'),
            '409': jsonResponse('HermesControlErrorResponse'),
            '503': jsonResponse('HermesControlErrorResponse'),
          },
        },
      },
      '/audit': readPath('audit', 'listAuditEvents', 'AuditEventList'),
      '/integrations': readPath('integrations', 'listIntegrations', 'IntegrationStatusList'),
      '/frameworks': readPath(
        'frameworks',
        'listFrameworkRegistrations',
        'FrameworkRegistrationList',
      ),
      '/frameworks/{frameworkId}': {
        get: {
          tags: ['frameworks'],
          operationId: 'getFrameworkRegistration',
          security: [{ cookieSession: [] }],
          parameters: [
            {
              name: 'frameworkId',
              in: 'path',
              required: true,
              schema: { $ref: '#/components/schemas/HermesFrameworkId' },
            },
          ],
          responses: {
            '200': jsonResponse('FrameworkRegistration'),
            '404': jsonResponse('ErrorResponse'),
          },
        },
        put: {
          tags: ['frameworks'],
          operationId: 'registerFramework',
          security: [{ cookieSession: [], csrfToken: [] }],
          parameters: [
            {
              name: 'frameworkId',
              in: 'path',
              required: true,
              schema: { $ref: '#/components/schemas/HermesFrameworkId' },
            },
          ],
          requestBody: jsonBody('FrameworkRegistrationInput'),
          responses: {
            '200': jsonResponse('FrameworkRegistration'),
            '401': jsonResponse('ErrorResponse'),
            '403': jsonResponse('ErrorResponse'),
            '422': jsonResponse('ErrorResponse'),
          },
        },
        delete: {
          tags: ['frameworks'],
          operationId: 'unregisterFramework',
          security: [{ cookieSession: [], csrfToken: [] }],
          parameters: [
            {
              name: 'frameworkId',
              in: 'path',
              required: true,
              schema: { $ref: '#/components/schemas/HermesFrameworkId' },
            },
          ],
          responses: {
            '204': { description: 'Framework unregistered' },
            '404': jsonResponse('ErrorResponse'),
          },
        },
      },
      '/frameworks/{frameworkId}/capabilities': readPath(
        'frameworks',
        'getFrameworkCapabilities',
        'GatewayHermesCapabilities',
        frameworkParameters(),
      ),
      '/frameworks/{frameworkId}/profiles': readPath(
        'frameworks',
        'listFrameworkProfiles',
        'GatewayHermesProfiles',
        frameworkParameters(true),
      ),
      '/frameworks/{frameworkId}/providers': readPath(
        'frameworks',
        'listFrameworkProviders',
        'GatewayHermesProviders',
        frameworkParameters(true),
      ),
      '/frameworks/{frameworkId}/work/projects': readPath(
        'frameworks',
        'listFrameworkProjects',
        'GatewayHermesProjects',
        frameworkParameters(true),
      ),
      '/frameworks/{frameworkId}/work/boards': readPath(
        'frameworks',
        'listFrameworkBoards',
        'GatewayHermesBoards',
        frameworkParameters(true),
      ),
      '/frameworks/{frameworkId}/work/boards/{boardId}/tasks': readPath(
        'frameworks',
        'listFrameworkTasks',
        'GatewayHermesTasks',
        [
          ...frameworkParameters(),
          {
            name: 'boardId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 200 },
          },
          ...controlPageParameters(),
        ],
      ),
      '/frameworks/{frameworkId}/work/cronjobs': readPath(
        'frameworks',
        'listFrameworkCronjobs',
        'GatewayHermesCronjobs',
        frameworkParameters(true),
      ),
      '/frameworks/{frameworkId}/conversations/sessions': readPath(
        'frameworks',
        'listFrameworkSessions',
        'GatewayHermesSessions',
        frameworkParameters(true),
      ),
      '/frameworks/{frameworkId}/conversations/sessions/{sessionId}/messages': readPath(
        'frameworks',
        'listFrameworkMessages',
        'GatewayHermesMessages',
        [
          ...frameworkParameters(),
          {
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 300 },
          },
          ...controlPageParameters(),
        ],
      ),
      '/frameworks/{frameworkId}/events': readPath(
        'frameworks',
        'listFrameworkEvents',
        'GatewayHermesEvents',
        frameworkParameters(true),
      ),
      '/resources': readPath(
        'integrations',
        'listUnifiedResources',
        'UnifiedResourceList',
        resourceQueryParameters(),
      ),
      '/search': readPath('search', 'searchUnifiedResources', 'UnifiedSearchResults', [
        {
          name: 'q',
          in: 'query',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 500 },
        },
        ...resourceQueryParameters(),
      ]),
      '/events': readPath('events', 'listUnifiedEvents', 'UnifiedEventList'),
      '/notifications': readPath(
        'notifications',
        'listUnifiedNotifications',
        'UnifiedNotificationList',
      ),
      '/notifications/{id}/acknowledge': {
        post: {
          tags: ['notifications'],
          operationId: 'acknowledgeNotification',
          security: [{ cookieSession: [], csrfToken: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 2048 },
            },
          ],
          responses: {
            '204': { description: 'Notification acknowledged' },
            '401': jsonResponse('ErrorResponse'),
            '403': jsonResponse('ErrorResponse'),
            '404': jsonResponse('ErrorResponse'),
            '503': jsonResponse('ErrorResponse'),
          },
        },
      },
      '/shadow': readPath('shadow', 'compareAuthoritativeOwners', 'ShadowComparisonList'),
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
function controlReadPath(
  operationId: string,
  schema: string,
  parameters: unknown[] = [],
): Record<string, unknown> {
  return {
    get: {
      tags: ['hermes-control'],
      operationId,
      security: [{ bearerAuth: [] }],
      parameters,
      responses: {
        '200': jsonResponse(schema),
        '400': jsonResponse('HermesControlErrorResponse'),
        '401': jsonResponse('HermesControlErrorResponse'),
        '403': jsonResponse('HermesControlErrorResponse'),
        '409': jsonResponse('HermesControlErrorResponse'),
        '503': jsonResponse('HermesControlErrorResponse'),
      },
    },
  };
}
function controlPageParameters(): unknown[] {
  return [
    {
      name: 'cursor',
      in: 'query',
      required: false,
      schema: { type: 'string', minLength: 1, maxLength: 4096 },
    },
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    },
  ];
}
function frameworkParameters(includePage = false): unknown[] {
  return [
    {
      name: 'frameworkId',
      in: 'path',
      required: true,
      schema: { $ref: '#/components/schemas/HermesFrameworkId' },
    },
    ...(includePage ? controlPageParameters() : []),
  ];
}
function readPath(
  tag: string,
  operationId: string,
  schema: string,
  parameters: unknown[] = [],
): Record<string, unknown> {
  return {
    get: {
      tags: [tag],
      operationId,
      security: [{ cookieSession: [] }],
      parameters,
      responses: {
        '200': jsonResponse(schema),
        '401': jsonResponse('ErrorResponse'),
        '403': jsonResponse('ErrorResponse'),
        '503': jsonResponse('ErrorResponse'),
      },
    },
  };
}
function resourceQueryParameters(): unknown[] {
  return [
    { name: 'owner', in: 'query', schema: { $ref: '#/components/schemas/ResourceOwner' } },
    { name: 'kind', in: 'query', schema: { $ref: '#/components/schemas/ResourceKind' } },
    { name: 'refresh', in: 'query', schema: { type: 'boolean', default: false } },
  ];
}
