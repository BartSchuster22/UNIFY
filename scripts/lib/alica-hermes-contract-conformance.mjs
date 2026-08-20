import { createHash } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  HermesControlErrorResponseSchema,
} from '../../packages/contracts/dist/index.js';

export const HMI_PHASE3_SCHEMA = 'alica-hermes-contract-conformance/v0.1';
export const HMI_PHASE3_TARGET = Object.freeze({
  frameworkId: 'hermes-main',
  contractVersion: HERMES_CONTROL_VERSION,
  frameworkVersion: PINNED_HERMES_RELEASE,
  frameworkCommit: PINNED_HERMES_COMMIT,
});

const capabilityStatuses = new Set(['supported', 'unsupported', 'unavailable', 'forbidden']);
const commandModes = new Set(['validate', 'dry-run', 'execute']);
const safeReasonCode = /^[A-Z][A-Z0-9_]{1,99}$/u;
const sensitiveKeys = new Set([
  'apikey',
  'authorization',
  'bearertoken',
  'clientsecret',
  'credentialvalue',
  'password',
  'passwordhash',
  'privatekey',
  'secrettoken',
  'secretvalue',
  'token',
]);
const sensitiveStrings = [/\bbearer\s+[a-z0-9._~-]+/iu, /-----BEGIN [A-Z ]*PRIVATE KEY-----/u];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizedKey(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
}

export function findSensitiveField(value, path = '$') {
  if (typeof value === 'string') {
    return sensitiveStrings.some((pattern) => pattern.test(value)) ? path : null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKeys.has(normalizedKey(key))) return `${path}.${key}`;
    const found = findSensitiveField(item, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function schemaErrors(schema, value) {
  return [...Value.Errors(schema, value)].map((error) => ({ path: error.path, type: error.type }));
}

function safeError(code, reasonCode, requestId = 'fixture-request', retryable = false) {
  if (!safeReasonCode.test(reasonCode)) throw new Error(`Unsafe reason code: ${reasonCode}`);
  const response = {
    contractVersion: HMI_PHASE3_TARGET.contractVersion,
    frameworkId: HMI_PHASE3_TARGET.frameworkId,
    error: {
      code,
      message: reasonCode,
      requestId,
      retryable,
      details: { reasonCode },
    },
  };
  if (!Value.Check(HermesControlErrorResponseSchema, response)) {
    throw new Error(
      `Generated error violates HermesControlErrorResponse: ${stableJson(schemaErrors(HermesControlErrorResponseSchema, response))}`,
    );
  }
  return response;
}

function reject(code, reasonCode, requestId, retryable = false, extra = {}) {
  return {
    accepted: false,
    ownerDispatch: false,
    reasonCode,
    safeError: safeError(code, reasonCode, requestId, retryable),
    ...extra,
  };
}

function assertExactProvenance(value) {
  if (value.contractVersion !== HMI_PHASE3_TARGET.contractVersion)
    return 'CONTRACT_VERSION_MISMATCH';
  if (value.frameworkId !== HMI_PHASE3_TARGET.frameworkId) return 'FRAMEWORK_ID_MISMATCH';
  if (value.frameworkVersion !== HMI_PHASE3_TARGET.frameworkVersion)
    return 'FRAMEWORK_VERSION_MISMATCH';
  if (value.frameworkCommit !== HMI_PHASE3_TARGET.frameworkCommit)
    return 'FRAMEWORK_COMMIT_MISMATCH';
  if (typeof value.sourceVersion !== 'string' || value.sourceVersion.length === 0)
    return 'SOURCE_VERSION_MISSING';
  if (Number.isNaN(Date.parse(value.observedAt))) return 'OBSERVED_AT_INVALID';
  return null;
}

export function evaluateReadFixture({ schema, response, limit, requestCursor = null }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return reject('invalid_request', 'PAGE_LIMIT_INVALID', 'read-fixture');
  if (!Value.Check(schema, response)) {
    return reject('invalid_request', 'READ_SCHEMA_INVALID', 'read-fixture', false, {
      schemaErrors: schemaErrors(schema, response),
    });
  }
  const provenanceFailure = assertExactProvenance(response);
  if (provenanceFailure)
    return reject('unsupported_framework_version', provenanceFailure, 'read-fixture');
  const sensitivePath = findSensitiveField(response);
  if (sensitivePath)
    return reject('invalid_request', 'SECRET_FIELD_DENIED', 'read-fixture', false, {
      sensitivePath,
    });
  const { items, page } = response.data;
  if (items.length > limit) return reject('invalid_request', 'PAGE_BOUND_EXCEEDED', 'read-fixture');
  if (page.hasMore && !page.nextCursor)
    return reject('replay_gap', 'NEXT_CURSOR_REQUIRED', 'read-fixture');
  if (page.hasMore && page.nextCursor === requestCursor)
    return reject('replay_gap', 'CURSOR_STALL', 'read-fixture');
  if (!page.hasMore && page.nextCursor)
    return reject('invalid_request', 'TERMINAL_CURSOR_FORBIDDEN', 'read-fixture');
  return {
    accepted: true,
    ownerDispatch: false,
    reasonCode: 'READ_PAGE_ACCEPTED',
    count: items.length,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor ?? null,
    sourceVersion: response.sourceVersion,
  };
}

function canonicalCommand(command) {
  return Object.fromEntries(
    Object.entries(command).filter(([key]) => !['requestId', 'correlationId'].includes(key)),
  );
}

export function evaluateCommandFixture({ schema, command, context, ledger = {} }) {
  const requestId = typeof command?.requestId === 'string' ? command.requestId : 'command-fixture';
  if (!Value.Check(schema, command)) {
    return {
      ...reject('invalid_request', 'COMMAND_SCHEMA_INVALID', requestId),
      ledger,
      schemaErrors: schemaErrors(schema, command),
    };
  }
  const sensitivePath = findSensitiveField(command.payload);
  if (sensitivePath)
    return {
      ...reject('invalid_request', 'SECRET_FIELD_DENIED', requestId, false, { sensitivePath }),
      ledger,
    };
  if (!context?.capability || !capabilityStatuses.has(context.capability.status)) {
    return { ...reject('invalid_request', 'CAPABILITY_STATE_INVALID', requestId), ledger };
  }
  if (context.capability.status === 'unsupported')
    return { ...reject('capability_unsupported', 'CAPABILITY_UNSUPPORTED', requestId), ledger };
  if (context.capability.status === 'unavailable')
    return {
      ...reject('capability_unavailable', 'CAPABILITY_UNAVAILABLE', requestId, true),
      ledger,
    };
  if (context.capability.status === 'forbidden')
    return { ...reject('forbidden', 'CAPABILITY_FORBIDDEN', requestId), ledger };
  if (!commandModes.has(command.mode) || !context.capability.modes.includes(command.mode))
    return { ...reject('forbidden', 'CAPABILITY_MODE_FORBIDDEN', requestId), ledger };
  if (context.requiresSourceVersion && !command.expectedSourceVersion)
    return { ...reject('source_version_mismatch', 'SOURCE_VERSION_REQUIRED', requestId), ledger };
  if (
    command.expectedSourceVersion &&
    command.expectedSourceVersion !== context.currentSourceVersion
  )
    return { ...reject('source_version_mismatch', 'SOURCE_VERSION_MISMATCH', requestId), ledger };

  const scope = context.idempotencyScope;
  if (typeof scope !== 'string' || scope.length === 0)
    return { ...reject('invalid_request', 'IDEMPOTENCY_SCOPE_INVALID', requestId), ledger };
  const key = `${scope}:${command.idempotencyKey}`;
  const requestDigest = digest(canonicalCommand(command));
  const prior = ledger[key];
  if (prior) {
    if (prior.requestDigest !== requestDigest)
      return {
        ...reject('idempotency_conflict', 'IDEMPOTENCY_CONFLICT', requestId),
        ledger,
      };
    return {
      ...prior.result,
      replayed: true,
      ownerDispatch: false,
      reasonCode: 'IDEMPOTENT_REPLAY',
      ledger,
    };
  }

  const status =
    command.mode === 'validate'
      ? 'validated'
      : command.mode === 'dry-run'
        ? 'dry-run'
        : 'completed';
  const result = {
    accepted: true,
    ownerDispatch: command.mode === 'execute',
    reasonCode: command.mode === 'execute' ? 'EXECUTION_WOULD_DISPATCH' : 'NON_EXECUTING_MODE',
    status,
    replayed: false,
    requestDigest: `sha256:${requestDigest}`,
  };
  return {
    ...result,
    ledger: { ...ledger, [key]: { requestDigest, result } },
  };
}

function eventDigest(event) {
  return digest(event);
}

function heldEvent(reasonCode, state, requestId = 'event-fixture') {
  return {
    ...reject('replay_gap', reasonCode, requestId, false),
    held: true,
    cursorAdvanced: false,
    state,
  };
}

export function evaluateEventFixture({ schema, response, context }) {
  const state = context.state ?? {
    cursor: null,
    lastSequence: -1,
    sourceVersion: null,
    seen: {},
  };
  if (context.consumerId !== context.acceptedConsumerId) {
    return {
      ...reject('SECOND_CONSUMER_FORBIDDEN', 'SECOND_CONSUMER_FORBIDDEN', 'event-fixture'),
      held: true,
      cursorAdvanced: false,
      state,
    };
  }
  if (!Value.Check(schema, response)) {
    return {
      ...reject('invalid_request', 'EVENT_SCHEMA_INVALID', 'event-fixture'),
      held: true,
      cursorAdvanced: false,
      state,
      schemaErrors: schemaErrors(schema, response),
    };
  }
  const provenanceFailure = assertExactProvenance(response);
  if (provenanceFailure) return heldEvent(provenanceFailure, state);
  if (response.data.items.length > context.limit)
    return heldEvent('EVENT_PAGE_BOUND_EXCEEDED', state);
  const page = response.data.page;
  if (page.hasMore && !page.nextCursor) return heldEvent('NEXT_CURSOR_REQUIRED', state);
  if (page.hasMore && page.nextCursor === context.requestCursor)
    return heldEvent('CURSOR_STALL', state);
  if (!page.hasMore && page.nextCursor) return heldEvent('TERMINAL_CURSOR_FORBIDDEN', state);

  let nextState = { ...state, seen: { ...state.seen } };
  let duplicates = 0;
  for (const event of response.data.items) {
    const eventProvenanceFailure = assertExactProvenance({
      ...event,
      observedAt: event.occurredAt,
    });
    if (eventProvenanceFailure) return heldEvent(eventProvenanceFailure, state);
    if (event.sourceVersion !== response.sourceVersion)
      return heldEvent('EVENT_PAGE_SOURCE_MISMATCH', state);
    const sensitivePath = findSensitiveField(event.payload);
    if (sensitivePath)
      return {
        ...heldEvent('SECRET_FIELD_DENIED', state),
        safeError: safeError('invalid_request', 'SECRET_FIELD_DENIED', 'event-fixture'),
        sensitivePath,
      };
    const currentDigest = eventDigest(event);
    const priorDigest = nextState.seen[event.eventId];
    if (priorDigest) {
      if (priorDigest !== currentDigest) return heldEvent('EVENT_DUPLICATE_CONFLICT', state);
      duplicates += 1;
      continue;
    }
    if (
      nextState.sourceVersion &&
      event.sourceVersion !== nextState.sourceVersion &&
      event.sequence <= nextState.lastSequence
    )
      return heldEvent('EVENT_SOURCE_RESET', state);
    if (event.sequence <= nextState.lastSequence) return heldEvent('EVENT_REORDER', state);
    if (event.sequence > nextState.lastSequence + 1) return heldEvent('EVENT_GAP', state);
    nextState.seen[event.eventId] = currentDigest;
    nextState.lastSequence = event.sequence;
    nextState.sourceVersion = event.sourceVersion;
  }
  nextState = { ...nextState, cursor: page.nextCursor ?? context.requestCursor ?? state.cursor };
  return {
    accepted: true,
    held: false,
    ownerDispatch: false,
    cursorAdvanced: nextState.cursor !== state.cursor,
    reasonCode: duplicates > 0 ? 'EVENT_DUPLICATE_IDEMPOTENT' : 'EVENT_PAGE_ACCEPTED',
    duplicates,
    state: nextState,
  };
}

export function summarizeFixtureResults(results) {
  const counts = { accepted: 0, rejected: 0, held: 0, ownerDispatch: 0, replayed: 0 };
  const reasons = {};
  for (const result of results) {
    counts[result.accepted ? 'accepted' : 'rejected'] += 1;
    if (result.held) counts.held += 1;
    if (result.ownerDispatch) counts.ownerDispatch += 1;
    if (result.replayed) counts.replayed += 1;
    reasons[result.reasonCode] = (reasons[result.reasonCode] ?? 0) + 1;
  }
  return { schemaVersion: HMI_PHASE3_SCHEMA, counts, reasons };
}
