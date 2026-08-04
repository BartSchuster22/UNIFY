import { Type, type Static, type TSchema } from '@sinclair/typebox';
import {
  CanonicalIdSchema,
  ContractVersionSchema,
  IdempotencyKeySchema,
  ResourceVersionSchema,
  Sha256Schema,
  TimestampSchema,
  canonicalIdSchema,
} from './primitives.js';

export const ErrorCodeSchema = Type.Union(
  [
    'authentication_required',
    'authentication_failed',
    'authorization_denied',
    'csrf_failed',
    'rate_limited',
    'validation_failed',
    'resource_not_found',
    'resource_conflict',
    'idempotency_conflict',
    'capability_unsupported',
    'framework_unavailable',
    'precondition_failed',
    'operation_failed',
    'operation_timed_out',
    'service_unavailable',
    'internal_error',
  ].map((value) => Type.Literal(value)),
  { $id: 'ErrorCode' },
);

export const FieldViolationSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 500 }),
    code: Type.String({ minLength: 1, maxLength: 100 }),
    message: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { $id: 'FieldViolation', additionalProperties: false },
);

export const ApiErrorSchema = Type.Object(
  {
    contractVersion: ContractVersionSchema,
    code: ErrorCodeSchema,
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    message: Type.String({ minLength: 1, maxLength: 1_000 }),
    requestId: canonicalIdSchema('request'),
    correlationId: canonicalIdSchema('correlation'),
    retryable: Type.Boolean(),
    retryAfterSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
    violations: Type.Optional(Type.Array(FieldViolationSchema, { maxItems: 100 })),
    operationId: Type.Optional(canonicalIdSchema('operation')),
  },
  { $id: 'ApiError', additionalProperties: false },
);

export const ErrorResponseSchema = Type.Object(
  { error: ApiErrorSchema },
  { $id: 'ErrorResponse', additionalProperties: false },
);

export const ActorSchema = Type.Object(
  {
    principalId: Type.Union([canonicalIdSchema('user'), canonicalIdSchema('service')]),
    sessionId: Type.Optional(canonicalIdSchema('session')),
  },
  { $id: 'Actor', additionalProperties: false },
);

export const CommandTargetSchema = Type.Object(
  {
    kind: Type.String({ pattern: '^[a-z][a-z0-9.-]{1,99}$' }),
    id: Type.Optional(CanonicalIdSchema),
  },
  { $id: 'CommandTarget', additionalProperties: false },
);

export function commandEnvelopeSchema(
  name: string,
  commandType: string,
  payload: TSchema,
): TSchema {
  return Type.Object(
    {
      contractVersion: ContractVersionSchema,
      commandId: canonicalIdSchema('command'),
      commandType: Type.Literal(commandType),
      idempotencyKey: IdempotencyKeySchema,
      issuedAt: TimestampSchema,
      expectedResourceVersion: Type.Optional(ResourceVersionSchema),
      target: CommandTargetSchema,
      payload,
    },
    { $id: name, additionalProperties: false },
  );
}

export const CommandAcceptedSchema = Type.Object(
  {
    contractVersion: ContractVersionSchema,
    commandId: canonicalIdSchema('command'),
    operationId: canonicalIdSchema('operation'),
    status: Type.Literal('accepted'),
    replayed: Type.Boolean(),
    acceptedAt: TimestampSchema,
  },
  { $id: 'CommandAccepted', additionalProperties: false },
);

export const EventEnvelopeSchema = Type.Object(
  {
    contractVersion: ContractVersionSchema,
    eventId: canonicalIdSchema('event'),
    sequence: Type.Integer({ minimum: 1 }),
    eventType: Type.String({ pattern: '^[a-z][a-z0-9.-]+\\.v1$' }),
    occurredAt: TimestampSchema,
    recordedAt: TimestampSchema,
    correlationId: canonicalIdSchema('correlation'),
    operationId: Type.Optional(canonicalIdSchema('operation')),
    subjectId: Type.Optional(CanonicalIdSchema),
    payloadSchema: Type.String({ pattern: '^[a-z][a-z0-9.-]+\\.v1$' }),
    payloadHash: Sha256Schema,
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { $id: 'EventEnvelope', additionalProperties: false },
);

export type ApiError = Static<typeof ApiErrorSchema>;
export type CommandAccepted = Static<typeof CommandAcceptedSchema>;
export type EventEnvelope = Static<typeof EventEnvelopeSchema>;
