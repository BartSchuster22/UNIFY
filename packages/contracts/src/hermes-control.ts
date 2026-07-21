import { Type, type Static } from '@sinclair/typebox';

export const HERMES_CONTROL_VERSION = 'hermes-control/v1' as const;
export const PINNED_HERMES_RELEASE = '0.18.0' as const;
export const PINNED_HERMES_COMMIT = '9e54eee44f1cbbe62247a36546e51ff8940373c6' as const;

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

export const HermesControlCommandSchema = Type.Object(
  {
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
  },
  { $id: 'HermesControlCommand', additionalProperties: false },
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

export const FrameworkScopeSchema = Type.Union(
  [
    Type.Literal('control:read'),
    Type.Literal('control:execute'),
    Type.Literal('control:secrets'),
    Type.Literal('control:delivery'),
    Type.Literal('control:approval'),
    Type.Literal('control:events'),
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

export type HermesControlMetadata = Static<typeof HermesControlMetadataSchema>;
export type HermesIdentityResponse = Static<typeof HermesIdentityResponseSchema>;
export type HermesHealthResponse = Static<typeof HermesHealthResponseSchema>;
export type HermesVersionResponse = Static<typeof HermesVersionResponseSchema>;
export type HermesCapabilitiesResponse = Static<typeof HermesCapabilitiesResponseSchema>;
export type HermesControlCommand = Static<typeof HermesControlCommandSchema>;
export type HermesEventEnvelope = Static<typeof HermesEventEnvelopeSchema>;
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
  HermesControlErrorCodeSchema,
  HermesControlErrorResponseSchema,
  HermesControlCommandSchema,
  HermesEventEnvelopeSchema,
  FrameworkScopeSchema,
  FrameworkRegistrationInputSchema,
  FrameworkRegistrationSchema,
  FrameworkRegistrationListSchema,
] as const;
