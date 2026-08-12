import { Type, type Static, type TObject, type TSchema } from '@sinclair/typebox';

export const HERMES_CONTROL_VERSION = 'hermes-control/v1' as const;
export const PINNED_HERMES_RELEASE = '0.20.0' as const;
export const PINNED_HERMES_COMMIT = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4' as const;

export const HermesContractVersionSchema = Type.Literal(HERMES_CONTROL_VERSION, {
  $id: 'HermesContractVersion',
});
export const HermesFrameworkIdSchema = Type.String({
  $id: 'HermesFrameworkId',
  pattern: '^[a-z0-9][a-z0-9._-]{2,127}$',
});
export const GitCommitSchema = Type.String({ pattern: '^[a-f0-9]{40}$' });
export const HermesSourceVersionSchema = Type.String({ minLength: 1, maxLength: 256 });

export const HermesControlMetadataSchema = Type.Object(
  {
    contractVersion: HermesContractVersionSchema,
    frameworkId: HermesFrameworkIdSchema,
    frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
    frameworkCommit: GitCommitSchema,
    sourceVersion: HermesSourceVersionSchema,
    observedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'HermesControlMetadata', additionalProperties: false },
);

const controlResponse = <T extends ReturnType<typeof Type.Object>>(id: string, data: T) =>
  Type.Object(
    {
      contractVersion: HermesContractVersionSchema,
      frameworkId: HermesFrameworkIdSchema,
      frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
      frameworkCommit: GitCommitSchema,
      sourceVersion: HermesSourceVersionSchema,
      observedAt: Type.String({ format: 'date-time' }),
      data,
    },
    { $id: id, additionalProperties: false },
  );

export const HermesIdentityResponseSchema = controlResponse(
  'HermesIdentityResponse',
  Type.Object(
    {
      runtime: Type.Literal('hermes-agent'),
      instanceId: Type.String({ minLength: 1, maxLength: 200 }),
      displayName: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
);

export const HermesHealthResponseSchema = controlResponse(
  'HermesHealthResponse',
  Type.Object(
    {
      status: Type.Union([
        Type.Literal('healthy'),
        Type.Literal('degraded'),
        Type.Literal('unavailable'),
      ]),
      checks: Type.Record(
        Type.String({ minLength: 1, maxLength: 100 }),
        Type.Object(
          {
            status: Type.Union([
              Type.Literal('healthy'),
              Type.Literal('degraded'),
              Type.Literal('unavailable'),
            ]),
            safeCode: Type.Optional(Type.String({ maxLength: 100 })),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
);

export const HermesVersionResponseSchema = controlResponse(
  'HermesVersionResponse',
  Type.Object(
    {
      release: Type.String({ minLength: 1, maxLength: 128 }),
      commit: GitCommitSchema,
      upstreamBaseCommit: Type.Optional(GitCommitSchema),
      dirty: Type.Boolean(),
      pythonVersion: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
);

export const HermesCapabilityStatusSchema = Type.Union(
  [
    Type.Literal('supported'),
    Type.Literal('unsupported'),
    Type.Literal('unavailable'),
    Type.Literal('forbidden'),
  ],
  { $id: 'HermesCapabilityStatus' },
);
export const HermesCapabilityModeSchema = Type.Union(
  [
    Type.Literal('read'),
    Type.Literal('validate'),
    Type.Literal('dry-run'),
    Type.Literal('execute'),
    Type.Literal('verify'),
    Type.Literal('subscribe'),
  ],
  { $id: 'HermesCapabilityMode' },
);
export const HermesCapabilitySchema = Type.Object(
  {
    status: HermesCapabilityStatusSchema,
    modes: Type.Array(HermesCapabilityModeSchema, { uniqueItems: true }),
    requiredScopes: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
      uniqueItems: true,
    }),
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    constraints: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'HermesCapability', additionalProperties: false },
);
export const HermesCapabilitiesResponseSchema = controlResponse(
  'HermesCapabilitiesResponse',
  Type.Object(
    {
      capabilities: Type.Record(
        Type.String({ minLength: 1, maxLength: 200 }),
        HermesCapabilitySchema,
      ),
    },
    { additionalProperties: false },
  ),
);

export const HermesPageSchema = Type.Object(
  {
    nextCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    hasMore: Type.Boolean(),
  },
  { $id: 'HermesPage', additionalProperties: false },
);
export const HermesCollectionResponseSchema = Type.Object(
  {
    contractVersion: HermesContractVersionSchema,
    frameworkId: HermesFrameworkIdSchema,
    frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
    frameworkCommit: GitCommitSchema,
    sourceVersion: HermesSourceVersionSchema,
    observedAt: Type.String({ format: 'date-time' }),
    data: Type.Object(
      {
        items: Type.Array(Type.Unknown()),
        page: HermesPageSchema,
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'HermesCollectionResponse', additionalProperties: false },
);

const controlCollectionResponse = <T extends TSchema>(id: string, item: T) =>
  Type.Object(
    {
      contractVersion: HermesContractVersionSchema,
      frameworkId: HermesFrameworkIdSchema,
      frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
      frameworkCommit: GitCommitSchema,
      sourceVersion: HermesSourceVersionSchema,
      observedAt: Type.String({ format: 'date-time' }),
      data: Type.Object(
        { items: Type.Array(item), page: HermesPageSchema },
        { additionalProperties: false },
      ),
    },
    { $id: id, additionalProperties: false },
  );

export const HermesProfileSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    active: Type.Boolean(),
    gatewayStatus: Type.Union([
      Type.Literal('running'),
      Type.Literal('stopped'),
      Type.Literal('unknown'),
    ]),
    model: Type.Optional(Type.String({ maxLength: 300 })),
    provider: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { $id: 'HermesProfile', additionalProperties: false },
);
export const HermesProfilesResponseSchema = controlCollectionResponse(
  'HermesProfilesResponse',
  HermesProfileSchema,
);

export const HermesProviderAuthMethodSchema = Type.Union(
  [
    Type.Literal('api_key'),
    Type.Literal('oauth_device_code'),
    Type.Literal('oauth_browser'),
    Type.Literal('external_cli'),
    Type.Literal('cloud_identity'),
    Type.Literal('endpoint'),
    Type.Literal('composite'),
    Type.Literal('none'),
    Type.Literal('unknown'),
  ],
  { $id: 'HermesProviderAuthMethod' },
);
export const HermesProviderSetupFieldSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 100 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    type: Type.Union([
      Type.Literal('secret'),
      Type.Literal('secret_file'),
      Type.Literal('text'),
      Type.Literal('url'),
      Type.Literal('choice'),
      Type.Literal('region'),
      Type.Literal('project'),
    ]),
    required: Type.Boolean(),
    secret: Type.Boolean(),
    choices: Type.Optional(
      Type.Array(
        Type.Object(
          {
            value: Type.String({ minLength: 1, maxLength: 100 }),
            label: Type.String({ minLength: 1, maxLength: 200 }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 20 },
      ),
    ),
  },
  { $id: 'HermesProviderSetupField', additionalProperties: false },
);
export const HermesProviderPrerequisiteSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 100 }),
    label: Type.String({ minLength: 1, maxLength: 300 }),
    kind: Type.Union([
      Type.Literal('account'),
      Type.Literal('executable'),
      Type.Literal('cloud_identity'),
      Type.Literal('network'),
      Type.Literal('provider'),
    ]),
    status: Type.Union([
      Type.Literal('satisfied'),
      Type.Literal('missing'),
      Type.Literal('unknown'),
    ]),
  },
  { $id: 'HermesProviderPrerequisite', additionalProperties: false },
);
export const HermesProviderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    credentialStatus: Type.Union([
      Type.Literal('configured'),
      Type.Literal('missing'),
      Type.Literal('unknown'),
    ]),
    selected: Type.Boolean(),
    authType: Type.Optional(
      Type.Union([
        Type.Literal('api_key'),
        Type.Literal('oauth'),
        Type.Literal('none'),
        Type.Literal('unknown'),
      ]),
    ),
    authMethod: Type.Optional(HermesProviderAuthMethodSchema),
    credentialMutable: Type.Optional(Type.Boolean()),
    setupSupported: Type.Optional(Type.Boolean()),
    setupFields: Type.Optional(Type.Array(HermesProviderSetupFieldSchema, { maxItems: 20 })),
    prerequisites: Type.Optional(Type.Array(HermesProviderPrerequisiteSchema, { maxItems: 20 })),
    connectionState: Type.Optional(
      Type.Union([
        Type.Literal('connected'),
        Type.Literal('disconnected'),
        Type.Literal('authorization_pending'),
        Type.Literal('expired'),
        Type.Literal('not_required'),
        Type.Literal('unknown'),
      ]),
    ),
    deploymentReadiness: Type.Optional(
      Type.Union([
        Type.Literal('ready'),
        Type.Literal('needs_configuration'),
        Type.Literal('needs_model'),
        Type.Literal('needs_selection'),
        Type.Literal('blocked'),
        Type.Literal('unsupported'),
      ]),
    ),
    readinessReasonCodes: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
        uniqueItems: true,
        maxItems: 20,
      }),
    ),
    modelCount: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { $id: 'HermesProvider', additionalProperties: false },
);
export const HermesProvidersResponseSchema = controlCollectionResponse(
  'HermesProvidersResponse',
  HermesProviderSchema,
);

export const HermesModelSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 300 }),
    providerId: Type.String({ minLength: 1, maxLength: 200 }),
    displayName: Type.String({ minLength: 1, maxLength: 300 }),
    capabilities: Type.Array(
      Type.Union([
        Type.Literal('text'),
        Type.Literal('vision'),
        Type.Literal('audio'),
        Type.Literal('tool-use'),
        Type.Literal('structured-output'),
        Type.Literal('reasoning'),
      ]),
      { uniqueItems: true, maxItems: 20 },
    ),
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    selected: Type.Boolean(),
    fallbackPriority: Type.Optional(Type.Integer({ minimum: 1, maximum: 99 })),
  },
  { $id: 'HermesModel', additionalProperties: false },
);
export const HermesModelsResponseSchema = controlCollectionResponse(
  'HermesModelsResponse',
  HermesModelSchema,
);

export const HermesBoardSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 500 }),
    archived: Type.Boolean(),
    isCurrent: Type.Boolean(),
    counts: Type.Record(Type.String({ maxLength: 100 }), Type.Integer({ minimum: 0 })),
    total: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'HermesBoard', additionalProperties: false },
);
export const HermesBoardsResponseSchema = controlCollectionResponse(
  'HermesBoardsResponse',
  HermesBoardSchema,
);

export const HermesProjectSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.Optional(Type.String({ maxLength: 1000000 })),
    boardId: Type.Optional(Type.String({ maxLength: 200 })),
    archived: Type.Boolean(),
  },
  { $id: 'HermesProject', additionalProperties: false },
);
export const HermesProjectsResponseSchema = controlCollectionResponse(
  'HermesProjectsResponse',
  HermesProjectSchema,
);

export const HermesTaskSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    boardId: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.String({ minLength: 1, maxLength: 2000 }),
    body: Type.Optional(Type.String({ maxLength: 1000000 })),
    status: Type.String({ minLength: 1, maxLength: 100 }),
    assignee: Type.Optional(Type.String({ maxLength: 200 })),
    priority: Type.Optional(Type.Integer()),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'HermesTask', additionalProperties: false },
);
export const HermesTasksResponseSchema = controlCollectionResponse(
  'HermesTasksResponse',
  HermesTaskSchema,
);

export const HermesCronjobSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 500 }),
    schedule: Type.String({ minLength: 1, maxLength: 500 }),
    status: Type.Union([
      Type.Literal('active'),
      Type.Literal('paused'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('disabled'),
    ]),
    nextRunAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastRunAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastResult: Type.Optional(Type.String({ maxLength: 100 })),
    deliver: Type.Array(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { $id: 'HermesCronjob', additionalProperties: false },
);
export const HermesCronjobsResponseSchema = controlCollectionResponse(
  'HermesCronjobsResponse',
  HermesCronjobSchema,
);

export const HermesSessionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 300 }),
    title: Type.Optional(Type.String({ maxLength: 2000 })),
    source: Type.Optional(Type.String({ maxLength: 200 })),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'HermesSession', additionalProperties: false },
);
export const HermesSessionsResponseSchema = controlCollectionResponse(
  'HermesSessionsResponse',
  HermesSessionSchema,
);

export const HermesMessageSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 300 }),
    sessionId: Type.String({ minLength: 1, maxLength: 300 }),
    role: Type.String({ minLength: 1, maxLength: 100 }),
    content: Type.Optional(Type.String({ maxLength: 1000000 })),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'HermesMessage', additionalProperties: false },
);
export const HermesMessagesResponseSchema = controlCollectionResponse(
  'HermesMessagesResponse',
  HermesMessageSchema,
);

export const HermesControlErrorCodeSchema = Type.Union(
  [
    Type.Literal('invalid_request'),
    Type.Literal('unauthenticated'),
    Type.Literal('forbidden'),
    Type.Literal('not_found'),
    Type.Literal('conflict'),
    Type.Literal('source_version_mismatch'),
    Type.Literal('idempotency_conflict'),
    Type.Literal('unsupported_contract_version'),
    Type.Literal('unsupported_framework_version'),
    Type.Literal('capability_unsupported'),
    Type.Literal('capability_unavailable'),
    Type.Literal('SECOND_CONSUMER_FORBIDDEN'),
    Type.Literal('replay_gap'),
    Type.Literal('rate_limited'),
    Type.Literal('internal_error'),
  ],
  { $id: 'HermesControlErrorCode' },
);
export const HermesControlErrorResponseSchema = Type.Object(
  {
    contractVersion: HermesContractVersionSchema,
    frameworkId: Type.Optional(HermesFrameworkIdSchema),
    error: Type.Object(
      {
        code: HermesControlErrorCodeSchema,
        message: Type.String({ minLength: 1, maxLength: 1000 }),
        requestId: Type.String({ minLength: 1, maxLength: 200 }),
        retryable: Type.Boolean(),
        retryAfterSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
        details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'HermesControlErrorResponse', additionalProperties: false },
);

const HermesControlCommandProperties = {
  mode: Type.Union([Type.Literal('validate'), Type.Literal('dry-run'), Type.Literal('execute')]),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  expectedSourceVersion: Type.Optional(HermesSourceVersionSchema),
  requestId: Type.String({ minLength: 1, maxLength: 200 }),
  correlationId: Type.String({ minLength: 1, maxLength: 200 }),
  actor: Type.Object(
    {
      type: Type.Union([Type.Literal('user'), Type.Literal('service')]),
      id: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  payload: Type.Record(Type.String(), Type.Unknown()),
};
export const HermesControlCommandSchema = Type.Object(HermesControlCommandProperties, {
  $id: 'HermesControlCommand',
  additionalProperties: false,
});

export const HermesProfileOperationSchema = Type.Union(
  [
    Type.Literal('profile.create'),
    Type.Literal('profile.update'),
    Type.Literal('profile.delete'),
    Type.Literal('profile.rename'),
  ],
  { $id: 'HermesProfileOperation' },
);
export const HermesProfileCommandSchema = Type.Object(
  {
    ...HermesControlCommandProperties,
    operation: HermesProfileOperationSchema,
    targetId: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,127}$' }),
  },
  { $id: 'HermesProfileCommand', additionalProperties: false },
);
export const HermesProfileResultSchema = controlResponse(
  'HermesProfileResult',
  Type.Object(
    {
      operationId: Type.String({ minLength: 1, maxLength: 200 }),
      status: Type.Union([
        Type.Literal('validated'),
        Type.Literal('dry-run'),
        Type.Literal('completed'),
      ]),
      replayed: Type.Boolean(),
      operation: HermesProfileOperationSchema,
      targetId: Type.String({ minLength: 1, maxLength: 128 }),
      result: Type.Record(Type.String(), Type.Unknown()),
      emittedEvents: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
);

export const HermesModelManagementOperationSchema = Type.Union(
  [
    Type.Literal('model.select'),
    Type.Literal('provider.credential.set'),
    Type.Literal('provider.credential.remove'),
    Type.Literal('provider.validate'),
    Type.Literal('provider.models.refresh'),
    Type.Literal('provider.inference.test'),
    Type.Literal('provider.persistence.verify'),
    Type.Literal('provider.oauth.start'),
    Type.Literal('provider.oauth.status'),
    Type.Literal('provider.oauth.reconnect'),
    Type.Literal('provider.oauth.disconnect'),
  ],
  { $id: 'HermesModelManagementOperation' },
);
export const HermesModelManagementCommandSchema = Type.Object(
  {
    ...HermesControlCommandProperties,
    operation: HermesModelManagementOperationSchema,
    targetId: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { $id: 'HermesModelManagementCommand', additionalProperties: false },
);
export const HermesModelManagementResultSchema = controlResponse(
  'HermesModelManagementResult',
  Type.Object(
    {
      operationId: Type.String({ minLength: 1, maxLength: 200 }),
      status: Type.Union([
        Type.Literal('validated'),
        Type.Literal('dry-run'),
        Type.Literal('completed'),
      ]),
      replayed: Type.Boolean(),
      operation: HermesModelManagementOperationSchema,
      targetId: Type.String({ minLength: 1, maxLength: 300 }),
      result: Type.Record(Type.String(), Type.Unknown()),
      emittedEvents: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
);

export const HermesWorkOperationSchema = Type.Union(
  [
    Type.Literal('project.create'),
    Type.Literal('project.rename'),
    Type.Literal('project.archive'),
    Type.Literal('task.create'),
    Type.Literal('task.start'),
    Type.Literal('task.block'),
    Type.Literal('task.unblock'),
    Type.Literal('task.complete'),
    Type.Literal('cron.create'),
    Type.Literal('cron.run'),
    Type.Literal('cron.pause'),
    Type.Literal('cron.resume'),
    Type.Literal('cron.delete'),
  ],
  { $id: 'HermesWorkOperation' },
);
export const HermesWorkCommandSchema = Type.Object(
  {
    ...HermesControlCommandProperties,
    operation: HermesWorkOperationSchema,
    targetId: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { $id: 'HermesWorkCommand', additionalProperties: false },
);
export const HermesWorkResultSchema = controlResponse(
  'HermesWorkResult',
  Type.Object(
    {
      operationId: Type.String({ minLength: 1, maxLength: 200 }),
      status: Type.Union([
        Type.Literal('validated'),
        Type.Literal('dry-run'),
        Type.Literal('completed'),
      ]),
      replayed: Type.Boolean(),
      operation: HermesWorkOperationSchema,
      targetId: Type.String({ minLength: 1, maxLength: 300 }),
      result: Type.Record(Type.String(), Type.Unknown()),
      emittedEvents: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
);

export const HermesConversationOperationSchema = Type.Union(
  [Type.Literal('session.create'), Type.Literal('message.send')],
  { $id: 'HermesConversationOperation' },
);
export const HermesConversationCommandSchema = Type.Object(
  {
    ...HermesControlCommandProperties,
    operation: HermesConversationOperationSchema,
    targetId: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { $id: 'HermesConversationCommand', additionalProperties: false },
);
export const HermesConversationResultSchema = controlResponse(
  'HermesConversationResult',
  Type.Object(
    {
      operationId: Type.String({ minLength: 1, maxLength: 200 }),
      status: Type.Union([
        Type.Literal('validated'),
        Type.Literal('dry-run'),
        Type.Literal('completed'),
      ]),
      replayed: Type.Boolean(),
      operation: HermesConversationOperationSchema,
      targetId: Type.String({ minLength: 1, maxLength: 300 }),
      result: Type.Record(Type.String(), Type.Unknown()),
      emittedEvents: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
);

export const HermesEventEnvelopeSchema = Type.Object(
  {
    contractVersion: HermesContractVersionSchema,
    frameworkId: HermesFrameworkIdSchema,
    frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
    frameworkCommit: GitCommitSchema,
    eventId: Type.String({ minLength: 1, maxLength: 256 }),
    sequence: Type.Integer({ minimum: 0 }),
    sourceVersion: HermesSourceVersionSchema,
    type: Type.String({ minLength: 1, maxLength: 200 }),
    classification: Type.Union([Type.Literal('durable'), Type.Literal('ephemeral')]),
    occurredAt: Type.String({ format: 'date-time' }),
    correlationId: Type.Optional(Type.String({ maxLength: 200 })),
    operationId: Type.Optional(Type.String({ maxLength: 200 })),
    runId: Type.Optional(Type.String({ maxLength: 200 })),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { $id: 'HermesEventEnvelope', additionalProperties: false },
);

export const HermesEventsResponseSchema = Type.Object(
  {
    contractVersion: HermesContractVersionSchema,
    frameworkId: HermesFrameworkIdSchema,
    frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
    frameworkCommit: GitCommitSchema,
    sourceVersion: HermesSourceVersionSchema,
    observedAt: Type.String({ format: 'date-time' }),
    data: Type.Object(
      { items: Type.Array(HermesEventEnvelopeSchema), page: HermesPageSchema },
      { additionalProperties: false },
    ),
  },
  { $id: 'HermesEventsResponse', additionalProperties: false },
);

export const HermesReconcileResultSchema = controlResponse(
  'HermesReconcileResult',
  Type.Object(
    {
      operationId: Type.String({ minLength: 1, maxLength: 200 }),
      status: Type.Union([
        Type.Literal('validated'),
        Type.Literal('dry-run'),
        Type.Literal('completed'),
      ]),
      replayed: Type.Boolean(),
      observedFamilies: Type.Array(
        Type.Union([
          Type.Literal('profiles'),
          Type.Literal('providers'),
          Type.Literal('work'),
          Type.Literal('conversations'),
        ]),
        { uniqueItems: true },
      ),
      emittedEvents: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
);

export const FrameworkScopeSchema = Type.Union(
  [
    Type.Literal('control:read'),
    Type.Literal('control:execute'),
    Type.Literal('control:secrets'),
    Type.Literal('control:delivery'),
    Type.Literal('control:approval'),
    Type.Literal('control:events'),
    Type.Literal('memory:read'),
    Type.Literal('memory:write'),
  ],
  { $id: 'FrameworkScope' },
);
export const FrameworkRegistrationInputSchema = Type.Object(
  {
    frameworkId: HermesFrameworkIdSchema,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    serviceAuthReference: Type.String({ pattern: '^env:[A-Z][A-Z0-9_]{2,127}$' }),
    scopes: Type.Array(FrameworkScopeSchema, { minItems: 1, uniqueItems: true }),
    expectedContractVersion: HermesContractVersionSchema,
    expectedFrameworkVersion: Type.Literal(PINNED_HERMES_RELEASE),
    expectedFrameworkCommit: Type.Literal(PINNED_HERMES_COMMIT),
    enabled: Type.Boolean(),
  },
  { $id: 'FrameworkRegistrationInput', additionalProperties: false },
);
export const FrameworkRegistrationSchema = Type.Object(
  {
    frameworkId: HermesFrameworkIdSchema,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    serviceAuthConfigured: Type.Boolean(),
    scopes: Type.Array(FrameworkScopeSchema, { minItems: 1, uniqueItems: true }),
    contractVersion: HermesContractVersionSchema,
    frameworkVersion: Type.Literal(PINNED_HERMES_RELEASE),
    frameworkCommit: Type.Literal(PINNED_HERMES_COMMIT),
    status: Type.Union([
      Type.Literal('verified'),
      Type.Literal('disabled'),
      Type.Literal('unavailable'),
      Type.Literal('unsupported'),
    ]),
    enabled: Type.Boolean(),
    verifiedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'FrameworkRegistration', additionalProperties: false },
);
export const FrameworkRegistrationListSchema = Type.Object(
  { items: Type.Array(FrameworkRegistrationSchema) },
  { $id: 'FrameworkRegistrationList', additionalProperties: false },
);

export const GatewayHermesMetadataSchema = Type.Object(
  {
    owner: Type.Literal('hermes'),
    frameworkId: HermesFrameworkIdSchema,
    frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
    frameworkCommit: GitCommitSchema,
    sourceVersion: HermesSourceVersionSchema,
    observedAt: Type.String({ format: 'date-time' }),
    freshness: Type.Literal('current'),
  },
  { $id: 'GatewayHermesMetadata', additionalProperties: false },
);

const gatewayOwnedItem = <T extends TObject>(id: string, item: T) =>
  Type.Object(
    {
      ...item.properties,
      owner: Type.Literal('hermes'),
      frameworkId: HermesFrameworkIdSchema,
      sourceVersion: HermesSourceVersionSchema,
      observedAt: Type.String({ format: 'date-time' }),
    },
    { $id: id, additionalProperties: false },
  );
const gatewayCollection = <T extends TSchema>(id: string, item: T) =>
  Type.Object(
    { meta: GatewayHermesMetadataSchema, items: Type.Array(item), page: HermesPageSchema },
    { $id: id, additionalProperties: false },
  );

export const GatewayHermesCapabilitiesSchema = Type.Object(
  {
    meta: GatewayHermesMetadataSchema,
    data: Type.Object(
      {
        capabilities: Type.Record(
          Type.String({ minLength: 1, maxLength: 200 }),
          HermesCapabilitySchema,
        ),
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'GatewayHermesCapabilities', additionalProperties: false },
);
export const GatewayHermesProfileSchema = gatewayOwnedItem(
  'GatewayHermesProfile',
  HermesProfileSchema,
);
export const GatewayHermesProfilesSchema = gatewayCollection(
  'GatewayHermesProfiles',
  GatewayHermesProfileSchema,
);
export const GatewayHermesProviderSchema = gatewayOwnedItem(
  'GatewayHermesProvider',
  HermesProviderSchema,
);
export const GatewayHermesProvidersSchema = gatewayCollection(
  'GatewayHermesProviders',
  GatewayHermesProviderSchema,
);
export const GatewayHermesProjectSchema = gatewayOwnedItem(
  'GatewayHermesProject',
  HermesProjectSchema,
);
export const GatewayHermesProjectsSchema = gatewayCollection(
  'GatewayHermesProjects',
  GatewayHermesProjectSchema,
);
export const GatewayHermesBoardSchema = gatewayOwnedItem('GatewayHermesBoard', HermesBoardSchema);
export const GatewayHermesBoardsSchema = gatewayCollection(
  'GatewayHermesBoards',
  GatewayHermesBoardSchema,
);
export const GatewayHermesTaskSchema = gatewayOwnedItem('GatewayHermesTask', HermesTaskSchema);
export const GatewayHermesTasksSchema = gatewayCollection(
  'GatewayHermesTasks',
  GatewayHermesTaskSchema,
);
export const GatewayHermesCronjobSchema = gatewayOwnedItem(
  'GatewayHermesCronjob',
  HermesCronjobSchema,
);
export const GatewayHermesCronjobsSchema = gatewayCollection(
  'GatewayHermesCronjobs',
  GatewayHermesCronjobSchema,
);
export const GatewayHermesSessionSchema = gatewayOwnedItem(
  'GatewayHermesSession',
  HermesSessionSchema,
);
export const GatewayHermesSessionsSchema = gatewayCollection(
  'GatewayHermesSessions',
  GatewayHermesSessionSchema,
);
export const GatewayHermesMessageSchema = gatewayOwnedItem(
  'GatewayHermesMessage',
  HermesMessageSchema,
);
export const GatewayHermesMessagesSchema = gatewayCollection(
  'GatewayHermesMessages',
  GatewayHermesMessageSchema,
);
export const GatewayHermesEventsSchema = Type.Object(
  {
    meta: Type.Object(
      {
        owner: Type.Literal('hermes'),
        frameworkId: HermesFrameworkIdSchema,
        frameworkVersion: Type.String({ minLength: 1, maxLength: 128 }),
        frameworkCommit: GitCommitSchema,
        freshness: Type.Union([
          Type.Literal('current'),
          Type.Literal('stale'),
          Type.Literal('unavailable'),
        ]),
        generatedAt: Type.String({ format: 'date-time' }),
        warnings: Type.Array(Type.Object({ code: Type.String({ minLength: 1, maxLength: 100 }) })),
      },
      { additionalProperties: false },
    ),
    items: Type.Array(HermesEventEnvelopeSchema),
    page: HermesPageSchema,
  },
  { $id: 'GatewayHermesEvents', additionalProperties: false },
);

export type HermesControlMetadata = Static<typeof HermesControlMetadataSchema>;
export type HermesIdentityResponse = Static<typeof HermesIdentityResponseSchema>;
export type HermesHealthResponse = Static<typeof HermesHealthResponseSchema>;
export type HermesVersionResponse = Static<typeof HermesVersionResponseSchema>;
export type HermesCapabilitiesResponse = Static<typeof HermesCapabilitiesResponseSchema>;
export type HermesProfile = Static<typeof HermesProfileSchema>;
export type HermesProvider = Static<typeof HermesProviderSchema>;
export type HermesModel = Static<typeof HermesModelSchema>;
export type HermesBoard = Static<typeof HermesBoardSchema>;
export type HermesProject = Static<typeof HermesProjectSchema>;
export type HermesTask = Static<typeof HermesTaskSchema>;
export type HermesCronjob = Static<typeof HermesCronjobSchema>;
export type HermesSession = Static<typeof HermesSessionSchema>;
export type HermesMessage = Static<typeof HermesMessageSchema>;
export type HermesControlCommand = Static<typeof HermesControlCommandSchema>;
export type HermesProfileOperation = Static<typeof HermesProfileOperationSchema>;
export type HermesProfileCommand = Static<typeof HermesProfileCommandSchema>;
export type HermesModelManagementOperation = Static<typeof HermesModelManagementOperationSchema>;
export type HermesModelManagementCommand = Static<typeof HermesModelManagementCommandSchema>;
export type HermesWorkOperation = Static<typeof HermesWorkOperationSchema>;
export type HermesWorkCommand = Static<typeof HermesWorkCommandSchema>;
export type HermesConversationOperation = Static<typeof HermesConversationOperationSchema>;
export type HermesConversationCommand = Static<typeof HermesConversationCommandSchema>;
export type HermesEventEnvelope = Static<typeof HermesEventEnvelopeSchema>;
export type HermesReconcileResult = Static<typeof HermesReconcileResultSchema>;
export type FrameworkScope = Static<typeof FrameworkScopeSchema>;
export type FrameworkRegistrationInput = Static<typeof FrameworkRegistrationInputSchema>;
export type FrameworkRegistration = Static<typeof FrameworkRegistrationSchema>;

export const HermesControlSchemas = [
  HermesContractVersionSchema,
  HermesFrameworkIdSchema,
  HermesControlMetadataSchema,
  HermesIdentityResponseSchema,
  HermesHealthResponseSchema,
  HermesVersionResponseSchema,
  HermesCapabilityStatusSchema,
  HermesCapabilityModeSchema,
  HermesCapabilitySchema,
  HermesCapabilitiesResponseSchema,
  HermesPageSchema,
  HermesCollectionResponseSchema,
  HermesProfileSchema,
  HermesProfilesResponseSchema,
  HermesProviderAuthMethodSchema,
  HermesProviderSetupFieldSchema,
  HermesProviderPrerequisiteSchema,
  HermesProviderSchema,
  HermesProvidersResponseSchema,
  HermesModelSchema,
  HermesModelsResponseSchema,
  HermesBoardSchema,
  HermesBoardsResponseSchema,
  HermesProjectSchema,
  HermesProjectsResponseSchema,
  HermesTaskSchema,
  HermesTasksResponseSchema,
  HermesCronjobSchema,
  HermesCronjobsResponseSchema,
  HermesSessionSchema,
  HermesSessionsResponseSchema,
  HermesMessageSchema,
  HermesMessagesResponseSchema,
  HermesControlErrorCodeSchema,
  HermesControlErrorResponseSchema,
  HermesControlCommandSchema,
  HermesProfileOperationSchema,
  HermesProfileCommandSchema,
  HermesProfileResultSchema,
  HermesModelManagementOperationSchema,
  HermesModelManagementCommandSchema,
  HermesModelManagementResultSchema,
  HermesWorkOperationSchema,
  HermesWorkCommandSchema,
  HermesWorkResultSchema,
  HermesConversationOperationSchema,
  HermesConversationCommandSchema,
  HermesConversationResultSchema,
  HermesEventEnvelopeSchema,
  HermesEventsResponseSchema,
  HermesReconcileResultSchema,
  FrameworkScopeSchema,
  FrameworkRegistrationInputSchema,
  FrameworkRegistrationSchema,
  FrameworkRegistrationListSchema,
  GatewayHermesMetadataSchema,
  GatewayHermesCapabilitiesSchema,
  GatewayHermesProfileSchema,
  GatewayHermesProfilesSchema,
  GatewayHermesProviderSchema,
  GatewayHermesProvidersSchema,
  GatewayHermesProjectSchema,
  GatewayHermesProjectsSchema,
  GatewayHermesBoardSchema,
  GatewayHermesBoardsSchema,
  GatewayHermesTaskSchema,
  GatewayHermesTasksSchema,
  GatewayHermesCronjobSchema,
  GatewayHermesCronjobsSchema,
  GatewayHermesSessionSchema,
  GatewayHermesSessionsSchema,
  GatewayHermesMessageSchema,
  GatewayHermesMessagesSchema,
  GatewayHermesEventsSchema,
] as const;
