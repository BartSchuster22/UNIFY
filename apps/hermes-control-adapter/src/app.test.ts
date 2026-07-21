import { afterEach, describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  HERMES_CONTROL_VERSION,
  HermesBoardsResponseSchema,
  HermesCapabilitiesResponseSchema,
  HermesControlErrorResponseSchema,
  HermesEventsResponseSchema,
  HermesIdentityResponseSchema,
  HermesProfilesResponseSchema,
  HermesProvidersResponseSchema,
  HermesReconcileResultSchema,
  HermesSessionsResponseSchema,
  HermesTasksResponseSchema,
  HermesVersionResponseSchema,
  HermesWorkResultSchema,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkScope,
  type HermesControlCommand,
} from '@aquiero/contracts';
import { buildHermesControlAdapter } from './app.js';
import { MemoryAdapterEventStore } from './event-store.js';
import type { AdapterSource } from './types.js';

const apps: ReturnType<typeof buildHermesControlAdapter>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const source: AdapterSource = {
  conversationsConfigured: () => true,
  profiles: async () => ({
    items: [
      { id: 'default', displayName: 'Default', active: true, gatewayStatus: 'running' },
      { id: 'test-agent', displayName: 'test-agent', active: false, gatewayStatus: 'running' },
    ],
    sourceVersion: 'sha256:profiles',
  }),
  providers: async () => ({
    items: [
      {
        id: 'openai-codex',
        displayName: 'OpenAI Codex',
        credentialStatus: 'configured',
        selected: true,
      },
    ],
    sourceVersion: 'sha256:providers',
  }),
  projects: async () => ({
    items: [{ id: 'board-1', name: 'Project 1', boardId: 'board-1', archived: false }],
    sourceVersion: 'sha256:projects',
  }),
  boards: async () => ({
    items: [
      { id: 'board-1', name: 'Board 1', archived: false, isCurrent: true, counts: {}, total: 0 },
    ],
    sourceVersion: 'sha256:boards',
  }),
  tasks: async (boardId) => ({
    items: [{ id: 'task-1', boardId, title: 'Task', status: 'ready' }],
    sourceVersion: 'sha256:tasks',
  }),
  cronjobs: async () => ({ items: [], sourceVersion: 'sha256:cronjobs' }),
  executeWork: async (command) => ({ operation: command.operation, targetId: command.targetId }),
  sessions: async () => ({
    items: [{ id: 'session-1', title: 'Session' }],
    sourceVersion: 'sha256:sessions',
  }),
  messages: async (sessionId) => ({
    items: [{ id: 'message-1', sessionId, role: 'user', content: 'hello' }],
    sourceVersion: 'sha256:messages',
  }),
  health: async () => ({ cli: 'healthy', conversations: 'healthy' }),
};

function create(
  testSource = source,
  scopes: readonly FrameworkScope[] = ['control:read', 'control:execute', 'control:events'],
  events = new MemoryAdapterEventStore(),
) {
  const app = buildHermesControlAdapter({
    frameworkId: 'hermes-dev',
    displayName: 'Hermes Dev',
    instanceId: 'instance-1',
    bearerToken: 'test-token-with-enough-entropy',
    scopes: [...scopes],
    source: testSource,
    events,
    upstreamBaseCommit: 'a41d280f95c69f67380358b305b62345934ecaf3',
    pythonVersion: '3.11.15',
    releaseId: 'test',
  });
  apps.push(app);
  return app;
}

const auth = { authorization: 'Bearer test-token-with-enough-entropy' };

function command(overrides: Partial<HermesControlCommand> = {}): HermesControlCommand {
  return {
    mode: 'execute',
    idempotencyKey: 'idem-1',
    requestId: 'request-1',
    correlationId: 'correlation-1',
    actor: { type: 'service', id: 'unify-test' },
    payload: { families: ['profiles', 'providers', 'work', 'conversations'] },
    ...overrides,
  };
}

describe('Hermes control adapter', () => {
  it('authenticates every control route and emits frozen identity/version/capabilities', async () => {
    const app = create();
    const denied = await app.inject({ method: 'GET', url: '/control/v1/identity' });
    expect(denied.statusCode).toBe(401);
    expect(Value.Check(HermesControlErrorResponseSchema, denied.json())).toBe(true);

    const identity = await app.inject({
      method: 'GET',
      url: '/control/v1/identity',
      headers: auth,
    });
    const version = await app.inject({ method: 'GET', url: '/control/v1/version', headers: auth });
    const capabilities = await app.inject({
      method: 'GET',
      url: '/control/v1/capabilities',
      headers: auth,
    });
    expect(Value.Check(HermesIdentityResponseSchema, identity.json())).toBe(true);
    expect(Value.Check(HermesVersionResponseSchema, version.json())).toBe(true);
    expect(Value.Check(HermesCapabilitiesResponseSchema, capabilities.json())).toBe(true);
    expect(version.json().data).toMatchObject({
      release: PINNED_HERMES_RELEASE,
      commit: PINNED_HERMES_COMMIT,
      dirty: false,
    });
    expect(capabilities.json().data.capabilities['profiles.execute']).toMatchObject({
      status: 'unsupported',
    });
    expect(capabilities.json().data.capabilities['conversations.delivery.execute']).toMatchObject({
      status: 'unsupported',
      reasonCode: 'SECOND_CONSUMER_FORBIDDEN',
    });
  });

  it('serves typed authoritative read projections with source-bound cursor pagination', async () => {
    const app = create();
    const cases = [
      ['/control/v1/profiles?limit=1', HermesProfilesResponseSchema],
      ['/control/v1/providers', HermesProvidersResponseSchema],
      ['/control/v1/work/boards', HermesBoardsResponseSchema],
      ['/control/v1/work/boards/board-1/tasks', HermesTasksResponseSchema],
      ['/control/v1/conversations/sessions', HermesSessionsResponseSchema],
    ] as const;
    for (const [url, schema] of cases) {
      const reply = await app.inject({ method: 'GET', url, headers: auth });
      expect(reply.statusCode, url).toBe(200);
      expect(Value.Check(schema, reply.json()), url).toBe(true);
    }
    const first = await app.inject({
      method: 'GET',
      url: '/control/v1/profiles?limit=1',
      headers: auth,
    });
    const cursor = first.json().data.page.nextCursor as string;
    const second = await app.inject({
      method: 'GET',
      url: `/control/v1/profiles?limit=1&cursor=${encodeURIComponent(cursor)}`,
      headers: auth,
    });
    expect(second.json().data.items[0].id).toBe('test-agent');
    const stale = Buffer.from(JSON.stringify({ offset: 1, version: 'other' })).toString(
      'base64url',
    );
    const rejected = await app.inject({
      method: 'GET',
      url: `/control/v1/profiles?cursor=${stale}`,
      headers: auth,
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('source_version_mismatch');
  });

  it('accepts the complete Work command schema and returns a typed non-mutating validation result', async () => {
    const app = create();
    const reply = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/work',
      headers: auth,
      payload: {
        ...command({ mode: 'validate', payload: { boardId: 'board-1', title: 'Verify' } }),
        operation: 'task.create',
        targetId: 'task-validation-only',
      },
    });
    expect(reply.statusCode).toBe(200);
    expect(Value.Check(HermesWorkResultSchema, reply.json())).toBe(true);
    expect(reply.json().data).toMatchObject({
      status: 'validated',
      operation: 'task.create',
      targetId: 'task-validation-only',
      replayed: false,
    });
  });

  it('reports source outage as unavailable rather than authoritative empty data', async () => {
    const unavailableSource: AdapterSource = {
      ...source,
      sessions: async () => {
        const { SourceUnavailableError } = await import('./source.js');
        throw new SourceUnavailableError('Hermes API is unavailable');
      },
    };
    const app = create(unavailableSource);
    const reply = await app.inject({
      method: 'GET',
      url: '/control/v1/conversations/sessions',
      headers: auth,
    });
    expect(reply.statusCode).toBe(503);
    expect(reply.json().error).toMatchObject({ code: 'capability_unavailable', retryable: true });
  });

  it('reconciles without writing Hermes, deduplicates source versions, and replays idempotently', async () => {
    const store = new MemoryAdapterEventStore();
    const app = create(source, ['control:read', 'control:execute', 'control:events'], store);
    const first = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: command(),
    });
    expect(first.statusCode).toBe(200);
    expect(Value.Check(HermesReconcileResultSchema, first.json())).toBe(true);
    expect(first.json().data).toMatchObject({
      status: 'completed',
      replayed: false,
      emittedEvents: 4,
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: command(),
    });
    expect(replay.json().data).toMatchObject({ replayed: true, emittedEvents: 4 });

    const anotherKey = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: command({ idempotencyKey: 'idem-2' }),
    });
    expect(anotherKey.json().data.emittedEvents).toBe(0);

    const conflict = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: command({ payload: { families: ['profiles'] } }),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('idempotency_conflict');

    const events = await app.inject({
      method: 'GET',
      url: '/control/v1/events?limit=2',
      headers: auth,
    });
    expect(events.statusCode).toBe(200);
    expect(Value.Check(HermesEventsResponseSchema, events.json())).toBe(true);
    expect(events.json().data.items).toHaveLength(2);
    expect(events.json().data.page.hasMore).toBe(true);
    expect(store.audits).toHaveLength(4);
    expect(store.audits.map((audit) => audit.outcome)).toEqual([
      'success',
      'success',
      'success',
      'failure',
    ]);
    expect(store.audits[0]?.safeMetadata).toEqual({ status: 'completed', mode: 'execute' });
  });

  it('enforces scopes, validates commands, and rejects stale expected versions', async () => {
    const readOnly = create(source, ['control:read']);
    const forbidden = await readOnly.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: command(),
    });
    expect(forbidden.statusCode).toBe(403);

    const app = create();
    const invalid = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: { ...command(), mode: 'unsafe' },
    });
    expect(invalid.statusCode).toBe(400);
    const stale = await app.inject({
      method: 'POST',
      url: '/control/v1/commands/reconcile',
      headers: auth,
      payload: command({ expectedSourceVersion: 'sha256:stale' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('source_version_mismatch');
  });

  it('never identifies a legacy application as source authority', async () => {
    const app = create();
    const reply = await app.inject({ method: 'GET', url: '/control/v1/identity', headers: auth });
    const body = JSON.stringify(reply.json()).toLowerCase();
    expect(reply.json()).toMatchObject({
      contractVersion: HERMES_CONTROL_VERSION,
      frameworkId: 'hermes-dev',
    });
    for (const legacy of ['agency', 'dmm', 'worker', 'chat'])
      expect(body).not.toContain(`"${legacy}"`);
  });
});
