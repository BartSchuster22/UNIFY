#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(root, 'deploy/five-service/hermes-contract-conformance-fixtures.v1.json');
const commit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4';
const meta = {
  contractVersion: 'hermes-control/v1',
  frameworkId: 'hermes-main',
  frameworkVersion: '0.20.0',
  frameworkCommit: commit,
  sourceVersion: 'source-v1',
  observedAt: '2026-08-20T04:00:00.000Z',
};

const profile = (index) => ({
  id: `fixture-profile-${index}`,
  displayName: `Fixture Profile ${index}`,
  active: true,
  gatewayStatus: 'stopped',
});
const page = (items, hasMore = false, nextCursor, overrides = {}) => ({
  ...meta,
  ...overrides,
  data: {
    items,
    page: { hasMore, ...(nextCursor === undefined ? {} : { nextCursor }) },
  },
});
const command = ({
  mode = 'execute',
  key = 'fixture-key',
  source = 'source-v1',
  payload = {},
  request = 'request-1',
} = {}) => ({
  mode,
  idempotencyKey: key,
  ...(source === null ? {} : { expectedSourceVersion: source }),
  requestId: request,
  correlationId: request.replace('request', 'correlation'),
  actor: { type: 'service', id: 'fixture-verifier' },
  payload,
  operation: 'profile.rename',
  targetId: 'default',
});
const context = ({ status = 'supported', modes, requiresSourceVersion = true } = {}) => ({
  capability: { status, modes: modes ?? ['validate', 'dry-run', 'execute'] },
  currentSourceVersion: 'source-v1',
  requiresSourceVersion,
  idempotencyScope: 'service:client:tenant:hermes-main:profile.rename',
});
const event = (sequence, eventId, sourceVersion = 'source-v1', payload = { state: 'fixture' }) => ({
  contractVersion: 'hermes-control/v1',
  frameworkId: 'hermes-main',
  frameworkVersion: '0.20.0',
  frameworkCommit: commit,
  eventId,
  sequence,
  sourceVersion,
  type: 'profile.updated',
  classification: 'durable',
  occurredAt: '2026-08-20T04:00:00.000Z',
  payload,
});
const eventPage = (items, { sourceVersion = 'source-v1', hasMore = false, nextCursor } = {}) =>
  page(items, hasMore, nextCursor, { sourceVersion });
const eventContext = ({
  stateGroup,
  requestCursor = null,
  limit = 10,
  consumerId = 'unify-projection',
}) => ({
  stateGroup,
  consumerId,
  acceptedConsumerId: 'unify-projection',
  requestCursor,
  limit,
});

const reads = [
  {
    name: 'read-terminal-page',
    schema: 'HermesProfilesResponseSchema',
    limit: 2,
    requestCursor: null,
    response: page([profile(1)]),
    expected: {
      accepted: true,
      reasonCode: 'READ_PAGE_ACCEPTED',
      count: 1,
      hasMore: false,
    },
  },
  {
    name: 'read-bounded-next-page',
    schema: 'HermesProfilesResponseSchema',
    limit: 2,
    requestCursor: 'cursor-0',
    response: page([profile(1), profile(2)], true, 'cursor-1'),
    expected: {
      accepted: true,
      reasonCode: 'READ_PAGE_ACCEPTED',
      count: 2,
      hasMore: true,
      nextCursor: 'cursor-1',
    },
  },
  {
    name: 'read-over-bound',
    schema: 'HermesProfilesResponseSchema',
    limit: 1,
    response: page([profile(1), profile(2)]),
    expected: { accepted: false, reasonCode: 'PAGE_BOUND_EXCEEDED', ownerDispatch: false },
  },
  {
    name: 'read-missing-next-cursor',
    schema: 'HermesProfilesResponseSchema',
    limit: 2,
    requestCursor: 'cursor-0',
    response: page([profile(1)], true),
    expected: { accepted: false, reasonCode: 'NEXT_CURSOR_REQUIRED' },
  },
  {
    name: 'read-cursor-stall',
    schema: 'HermesProfilesResponseSchema',
    limit: 2,
    requestCursor: 'cursor-0',
    response: page([profile(1)], true, 'cursor-0'),
    expected: { accepted: false, reasonCode: 'CURSOR_STALL' },
  },
  {
    name: 'read-provenance-mismatch',
    schema: 'HermesProfilesResponseSchema',
    limit: 2,
    response: page([profile(1)], false, undefined, { frameworkCommit: '0'.repeat(40) }),
    expected: { accepted: false, reasonCode: 'FRAMEWORK_COMMIT_MISMATCH' },
  },
  {
    name: 'read-secret-field-denied',
    schema: 'HermesCollectionResponseSchema',
    limit: 2,
    response: page([{ password: 'fixture-redacted' }]),
    expected: { accepted: false, reasonCode: 'SECRET_FIELD_DENIED' },
  },
  {
    name: 'read-terminal-cursor-forbidden',
    schema: 'HermesProfilesResponseSchema',
    limit: 2,
    requestCursor: 'cursor-0',
    response: page([profile(1)], false, 'cursor-1'),
    expected: { accepted: false, reasonCode: 'TERMINAL_CURSOR_FORBIDDEN' },
  },
];

const commands = [
  {
    name: 'command-validate-no-dispatch',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'validate',
    command: command({ mode: 'validate', key: 'validate-key' }),
    context: context(),
    expected: {
      accepted: true,
      reasonCode: 'NON_EXECUTING_MODE',
      status: 'validated',
      ownerDispatch: false,
    },
  },
  {
    name: 'command-dry-run-no-dispatch',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'dry-run',
    command: command({ mode: 'dry-run', key: 'dry-run-key' }),
    context: context(),
    expected: {
      accepted: true,
      reasonCode: 'NON_EXECUTING_MODE',
      status: 'dry-run',
      ownerDispatch: false,
    },
  },
  {
    name: 'command-execute-would-dispatch-once',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'replay',
    command: command({ key: 'replay-key', payload: { newId: 'alica' } }),
    context: context(),
    expected: {
      accepted: true,
      reasonCode: 'EXECUTION_WOULD_DISPATCH',
      status: 'completed',
      ownerDispatch: true,
      replayed: false,
    },
  },
  {
    name: 'command-idempotent-replay-no-dispatch',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'replay',
    command: command({ key: 'replay-key', payload: { newId: 'alica' }, request: 'request-2' }),
    context: context(),
    expected: {
      accepted: true,
      reasonCode: 'IDEMPOTENT_REPLAY',
      ownerDispatch: false,
      replayed: true,
    },
  },
  {
    name: 'command-idempotency-conflict',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'replay',
    command: command({ key: 'replay-key', payload: { newId: 'different' }, request: 'request-3' }),
    context: context(),
    expected: { accepted: false, reasonCode: 'IDEMPOTENCY_CONFLICT', ownerDispatch: false },
  },
  {
    name: 'command-stale-source-rejected',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'stale',
    command: command({ key: 'stale-key', source: 'source-old' }),
    context: context(),
    expected: { accepted: false, reasonCode: 'SOURCE_VERSION_MISMATCH' },
  },
  {
    name: 'command-missing-source-rejected',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'missing',
    command: command({ key: 'missing-key', source: null }),
    context: context(),
    expected: { accepted: false, reasonCode: 'SOURCE_VERSION_REQUIRED' },
  },
  {
    name: 'command-capability-unsupported',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'unsupported',
    command: command({ key: 'unsupported-key' }),
    context: context({ status: 'unsupported', modes: [] }),
    expected: { accepted: false, reasonCode: 'CAPABILITY_UNSUPPORTED' },
  },
  {
    name: 'command-capability-unavailable',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'unavailable',
    command: command({ key: 'unavailable-key' }),
    context: context({ status: 'unavailable', modes: [] }),
    expected: { accepted: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
  },
  {
    name: 'command-capability-forbidden',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'forbidden',
    command: command({ key: 'forbidden-key' }),
    context: context({ status: 'forbidden', modes: [] }),
    expected: { accepted: false, reasonCode: 'CAPABILITY_FORBIDDEN' },
  },
  {
    name: 'command-mode-forbidden',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'mode',
    command: command({ key: 'mode-key' }),
    context: context({ modes: ['validate', 'dry-run'] }),
    expected: { accepted: false, reasonCode: 'CAPABILITY_MODE_FORBIDDEN' },
  },
  {
    name: 'command-secret-field-denied',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'secret',
    command: command({ key: 'secret-key', payload: { password: 'fixture-redacted' } }),
    context: context(),
    expected: { accepted: false, reasonCode: 'SECRET_FIELD_DENIED' },
  },
  {
    name: 'command-secret-reference-allowed-in-dry-run',
    schema: 'HermesModelManagementCommandSchema',
    ledgerGroup: 'secret-reference',
    command: {
      ...command({
        mode: 'dry-run',
        key: 'secret-reference-key',
        payload: { secretReference: 'secret://fixture/reference' },
      }),
      operation: 'provider.credential.set',
      targetId: 'fixture-provider',
    },
    context: context(),
    expected: { accepted: true, reasonCode: 'NON_EXECUTING_MODE', ownerDispatch: false },
  },
  {
    name: 'command-schema-invalid',
    schema: 'HermesProfileCommandSchema',
    ledgerGroup: 'invalid',
    command: Object.fromEntries(
      Object.entries(command({ key: 'invalid-key' })).filter(([key]) => key !== 'idempotencyKey'),
    ),
    context: context(),
    expected: { accepted: false, reasonCode: 'COMMAND_SCHEMA_INVALID' },
  },
];

const events = [
  {
    name: 'events-contiguous-page',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'flow' }),
    response: eventPage([event(0, 'event-0'), event(1, 'event-1')], {
      hasMore: true,
      nextCursor: 'cursor-1',
    }),
    expected: {
      accepted: true,
      reasonCode: 'EVENT_PAGE_ACCEPTED',
      cursorAdvanced: true,
      held: false,
    },
  },
  {
    name: 'events-duplicate-idempotent',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'flow', requestCursor: 'cursor-1' }),
    response: eventPage([event(1, 'event-1')], { hasMore: true, nextCursor: 'cursor-2' }),
    expected: {
      accepted: true,
      reasonCode: 'EVENT_DUPLICATE_IDEMPOTENT',
      duplicates: 1,
      cursorAdvanced: true,
    },
  },
  {
    name: 'events-duplicate-conflict',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'flow', requestCursor: 'cursor-2' }),
    response: eventPage([event(1, 'event-1', 'source-v1', { state: 'changed' })]),
    expected: {
      accepted: false,
      reasonCode: 'EVENT_DUPLICATE_CONFLICT',
      held: true,
      cursorAdvanced: false,
    },
  },
  {
    name: 'events-reorder-base',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'reorder' }),
    response: eventPage([event(0, 'reorder-0'), event(1, 'reorder-1')]),
    expected: { accepted: true, reasonCode: 'EVENT_PAGE_ACCEPTED' },
  },
  {
    name: 'events-reorder-held',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'reorder' }),
    response: eventPage([event(0, 'reorder-new')]),
    expected: { accepted: false, reasonCode: 'EVENT_REORDER', held: true },
  },
  {
    name: 'events-gap-base',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'gap' }),
    response: eventPage([event(0, 'gap-0')]),
    expected: { accepted: true, reasonCode: 'EVENT_PAGE_ACCEPTED' },
  },
  {
    name: 'events-gap-held',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'gap' }),
    response: eventPage([event(2, 'gap-2')]),
    expected: { accepted: false, reasonCode: 'EVENT_GAP', held: true },
  },
  {
    name: 'events-cursor-stall',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'stall', requestCursor: 'cursor-stall' }),
    response: eventPage([], { hasMore: true, nextCursor: 'cursor-stall' }),
    expected: { accepted: false, reasonCode: 'CURSOR_STALL', held: true },
  },
  {
    name: 'events-reset-base',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'reset' }),
    response: eventPage([event(0, 'reset-0')]),
    expected: { accepted: true, reasonCode: 'EVENT_PAGE_ACCEPTED' },
  },
  {
    name: 'events-source-reset-held',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'reset' }),
    response: eventPage([event(0, 'reset-new', 'source-v2')], { sourceVersion: 'source-v2' }),
    expected: { accepted: false, reasonCode: 'EVENT_SOURCE_RESET', held: true },
  },
  {
    name: 'events-page-bound-held',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'bound', limit: 1 }),
    response: eventPage([event(0, 'bound-0'), event(1, 'bound-1')]),
    expected: { accepted: false, reasonCode: 'EVENT_PAGE_BOUND_EXCEEDED', held: true },
  },
  {
    name: 'events-secret-field-denied',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'secret' }),
    response: eventPage([event(0, 'secret-0', 'source-v1', { token: 'fixture-redacted' })]),
    expected: { accepted: false, reasonCode: 'SECRET_FIELD_DENIED', held: true },
  },
  {
    name: 'events-second-consumer-forbidden',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'consumer', consumerId: 'second-consumer' }),
    response: eventPage([]),
    expected: { accepted: false, reasonCode: 'SECOND_CONSUMER_FORBIDDEN', held: true },
  },
  {
    name: 'events-terminal-cursor-held',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'terminal', requestCursor: 'cursor-0' }),
    response: eventPage([], { nextCursor: 'cursor-1' }),
    expected: { accepted: false, reasonCode: 'TERMINAL_CURSOR_FORBIDDEN', held: true },
  },
  {
    name: 'events-page-source-mismatch',
    schema: 'HermesEventsResponseSchema',
    context: eventContext({ stateGroup: 'source-mismatch' }),
    response: eventPage([event(0, 'source-mismatch-0', 'source-v2')]),
    expected: { accepted: false, reasonCode: 'EVENT_PAGE_SOURCE_MISMATCH', held: true },
  },
];

const document = {
  schemaVersion: 'alica-hermes-contract-fixtures/v1',
  contractVersion: 'hermes-control/v1',
  projectionSchemaVersion: 'alica-hermes-projection-schema/v0.1',
  target: {
    frameworkId: 'hermes-main',
    frameworkVersion: '0.20.0',
    frameworkCommit: commit,
  },
  mode: 'static-fixture-only',
  mutationPerformed: false,
  liveAccessPerformed: false,
  ownerDispatchPerformed: false,
  schemaRefs: [
    ...new Set([...reads, ...commands, ...events].map((fixture) => fixture.schema)),
  ].sort(),
  reads,
  commands,
  events,
};
const generated = await format(JSON.stringify(document), { parser: 'json' });
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== generated) {
    throw new Error('Hermes conformance fixtures are stale; run the generator');
  }
  process.stdout.write(
    `Hermes conformance fixtures current: reads=${reads.length} commands=${commands.length} events=${events.length}\n`,
  );
} else {
  writeFileSync(outputPath, generated, { encoding: 'utf8', mode: 0o644 });
  process.stdout.write(`Generated ${outputPath}\n`);
}
