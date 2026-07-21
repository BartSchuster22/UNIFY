import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  HERMES_CONTROL_VERSION,
  HermesControlCommandSchema,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkScope,
  type HermesControlCommand,
} from '@aquiero/contracts';
import { sourceVersion, SourceUnavailableError } from './source.js';
import { IdempotencyBusyError, IdempotencyConflictError } from './event-store.js';
import type { AdapterEventStore, AdapterSource, CapabilityFamily } from './types.js';

export interface HermesControlAdapterOptions {
  frameworkId: string;
  displayName: string;
  instanceId: string;
  bearerToken: string;
  scopes: FrameworkScope[];
  source: AdapterSource;
  events: AdapterEventStore;
  upstreamBaseCommit?: string;
  pythonVersion: string;
  releaseId?: string;
}

class AdapterError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function buildHermesControlAdapter(options: HermesControlAdapterOptions) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const scopes = new Set(options.scopes);
  const auditedRequests = new WeakSet<object>();

  const auditCommand = async (
    request: FastifyRequest,
    outcome: 'success' | 'denied' | 'failure' | 'inconclusive',
    operationId: string | undefined,
    status: string,
  ) => {
    if (auditedRequests.has(request)) return;
    const body = commandAuditFields(request.body);
    await options.events.audit({
      frameworkId: options.frameworkId,
      eventType: 'hermes.adapter.command.reconcile',
      outcome,
      requestId: body.requestId ?? request.id,
      correlationId: body.correlationId ?? request.id,
      ...(body.actorType ? { actorType: body.actorType } : {}),
      ...(body.actorId ? { actorId: body.actorId } : {}),
      ...(operationId ? { operationId } : {}),
      safeMetadata: { status, mode: body.mode ?? 'invalid' },
    });
    auditedRequests.add(request);
  };

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/control/v1/')) return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!constantTimeEqual(token, options.bearerToken))
      throw new AdapterError('unauthenticated', 401, 'Authentication required');
  });

  app.setErrorHandler(async (error, request, reply) => {
    let mapped = mapError(error);
    if (request.url.startsWith('/control/v1/commands/reconcile')) {
      try {
        await auditCommand(
          request,
          mapped.statusCode === 401 || mapped.statusCode === 403 ? 'denied' : 'failure',
          undefined,
          mapped.code,
        );
      } catch {
        mapped = new AdapterError('internal_error', 500, 'Audit persistence unavailable', true);
      }
    }
    void reply.status(mapped.statusCode).send({
      contractVersion: HERMES_CONTROL_VERSION,
      frameworkId: options.frameworkId,
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId: request.id,
        retryable: mapped.retryable,
      },
    });
  });

  app.get('/health', async (_request, reply) => {
    const checks = await options.source.health();
    const eventStore = (await options.events.ready()) ? 'healthy' : 'unavailable';
    const status = Object.values({ ...checks, eventStore }).includes('unavailable')
      ? 'degraded'
      : 'healthy';
    return reply
      .status(status === 'healthy' ? 200 : 503)
      .send({ status, checks: { ...checks, eventStore } });
  });

  app.get('/control/v1/identity', async () =>
    response(options, 'identity', {
      runtime: 'hermes-agent',
      instanceId: options.instanceId,
      displayName: options.displayName,
    }),
  );

  app.get('/control/v1/version', async () =>
    response(options, `git:${PINNED_HERMES_COMMIT}`, {
      release: PINNED_HERMES_RELEASE,
      commit: PINNED_HERMES_COMMIT,
      ...(options.upstreamBaseCommit ? { upstreamBaseCommit: options.upstreamBaseCommit } : {}),
      dirty: false,
      pythonVersion: options.pythonVersion,
    }),
  );

  app.get('/control/v1/health', async () => {
    requireScope(scopes, 'control:read');
    const checks = await options.source.health();
    const eventStore = (await options.events.ready()) ? 'healthy' : 'unavailable';
    const all = { ...checks, eventStore };
    const status = Object.values(all).includes('unavailable')
      ? 'unavailable'
      : Object.values(all).includes('degraded')
        ? 'degraded'
        : 'healthy';
    return response(options, sourceVersion(all), {
      status,
      checks: Object.fromEntries(
        Object.entries(all).map(([name, value]) => [name, { status: value }]),
      ),
    });
  });

  app.get('/control/v1/capabilities', async () => {
    requireScope(scopes, 'control:read');
    const conversations = options.source.conversationsConfigured();
    return response(options, `adapter:${options.releaseId ?? 'development'}`, {
      capabilities: {
        'profiles.read': supported('control:read'),
        'providers.read': supported('control:read'),
        'providers.credentials.status': supported('control:read'),
        'work.boards.read': supported('control:read'),
        'work.tasks.read': supported('control:read'),
        'conversations.sessions.read': conversations
          ? supported('control:read')
          : unavailable('HERMES_API_NOT_CONFIGURED'),
        'conversations.messages.read': conversations
          ? supported('control:read')
          : unavailable('HERMES_API_NOT_CONFIGURED'),
        'control.reconcile': {
          status: scopes.has('control:execute') ? 'supported' : 'forbidden',
          modes: scopes.has('control:execute') ? ['validate', 'dry-run', 'execute'] : [],
          requiredScopes: ['control:execute'],
          ...(!scopes.has('control:execute') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
        },
        'profiles.execute': unsupported('NO_SAFE_EXISTING_HERMES_INTERFACE'),
        'providers.credentials.execute': unsupported('NO_SAFE_EXISTING_HERMES_INTERFACE'),
        'work.execute': unsupported('PHASE_3_NOT_ACCEPTED'),
        'conversations.execute': unsupported('PHASE_3_NOT_ACCEPTED'),
        'conversations.delivery.execute': unsupported('SECOND_CONSUMER_FORBIDDEN'),
      },
    });
  });

  app.get('/control/v1/profiles', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.profiles(), pageQuery(request.query));
  });

  app.get('/control/v1/providers', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.providers(), pageQuery(request.query));
  });

  app.get('/control/v1/work/boards', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.boards(), pageQuery(request.query));
  });

  app.get<{ Params: { boardId: string } }>(
    '/control/v1/work/boards/:boardId/tasks',
    async (request) => {
      requireScope(scopes, 'control:read');
      return collection(
        options,
        await options.source.tasks(request.params.boardId),
        pageQuery(request.query),
      );
    },
  );

  app.get('/control/v1/conversations/sessions', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.sessions(), pageQuery(request.query));
  });

  app.get<{ Params: { sessionId: string } }>(
    '/control/v1/conversations/sessions/:sessionId/messages',
    async (request) => {
      requireScope(scopes, 'control:read');
      return collection(
        options,
        await options.source.messages(request.params.sessionId),
        pageQuery(request.query),
      );
    },
  );

  app.get('/control/v1/events', async (request) => {
    requireScope(scopes, 'control:events');
    const query = pageQuery(request.query);
    const after = parseEventCursor(query.cursor);
    const items = await options.events.list(options.frameworkId, after, query.limit + 1);
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const lastSequence = page.at(-1)?.sequence;
    return response(options, sourceVersion(page.map((event) => event.sourceVersion)), {
      items: page,
      page: {
        hasMore,
        ...(hasMore && lastSequence !== undefined ? { nextCursor: eventCursor(lastSequence) } : {}),
      },
    });
  });

  app.post<{ Body: HermesControlCommand }>(
    '/control/v1/commands/reconcile',
    { schema: { body: HermesControlCommandSchema } },
    async (request) => {
      requireScope(scopes, 'control:execute');
      const command = request.body;
      const families = reconcileFamilies(command.payload.families);
      const operationId = randomUUID();
      if (command.mode === 'validate') {
        const result = response(options, 'validation', {
          operationId,
          status: 'validated',
          replayed: false,
          observedFamilies: families,
          emittedEvents: 0,
        });
        await auditCommand(request, 'success', operationId, 'validated');
        return result;
      }

      const observed = await observeFamilies(options.source, families);
      const aggregateVersion = sourceVersion(
        observed.map(({ family, sourceVersion: version }) => [family, version]),
      );
      if (command.expectedSourceVersion && command.expectedSourceVersion !== aggregateVersion)
        throw new AdapterError(
          'source_version_mismatch',
          409,
          'Expected source version does not match current Hermes observations',
        );
      const result = response(options, aggregateVersion, {
        operationId,
        status: command.mode === 'dry-run' ? 'dry-run' : 'completed',
        replayed: false,
        observedFamilies: families,
        emittedEvents: 0,
      });
      if (command.mode === 'dry-run') {
        await auditCommand(request, 'success', operationId, 'dry-run');
        return result;
      }

      const committed = await options.events.commit({
        frameworkId: options.frameworkId,
        capability: 'control.reconcile',
        idempotencyKey: command.idempotencyKey,
        requestHash: sourceVersion(command),
        command,
        response: result,
        events: observed.map((item) => ({
          family: item.family,
          type: `${item.family}.snapshot.observed`,
          sourceVersion: item.sourceVersion,
          correlationId: command.correlationId,
          operationId,
          payload: { itemCount: item.count },
        })),
      });
      if (committed.replayed) {
        const data = committed.response.data;
        if (data && typeof data === 'object' && !Array.isArray(data))
          (data as Record<string, unknown>).replayed = true;
      }
      await auditCommand(
        request,
        'success',
        operationId,
        committed.replayed ? 'replayed' : 'completed',
      );
      return committed.response;
    },
  );

  return app;
}

function response(options: HermesControlAdapterOptions, version: string, data: unknown) {
  return {
    contractVersion: HERMES_CONTROL_VERSION,
    frameworkId: options.frameworkId,
    frameworkVersion: PINNED_HERMES_RELEASE,
    frameworkCommit: PINNED_HERMES_COMMIT,
    sourceVersion: version,
    observedAt: new Date().toISOString(),
    data,
  };
}

function collection<T>(
  options: HermesControlAdapterOptions,
  snapshot: { items: T[]; sourceVersion: string },
  query: { cursor?: string; limit: number },
) {
  const offset = parseCollectionCursor(query.cursor, snapshot.sourceVersion);
  const items = snapshot.items.slice(offset, offset + query.limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < snapshot.items.length;
  return response(options, snapshot.sourceVersion, {
    items,
    page: {
      hasMore,
      ...(hasMore ? { nextCursor: collectionCursor(nextOffset, snapshot.sourceVersion) } : {}),
    },
  });
}

function pageQuery(value: unknown) {
  const query = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawLimit = Number(query.limit ?? 100);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : undefined;
  return { limit, ...(cursor ? { cursor } : {}) };
}

function collectionCursor(offset: number, version: string) {
  return Buffer.from(JSON.stringify({ offset, version }), 'utf8').toString('base64url');
}

function parseCollectionCursor(cursor: string | undefined, version: string) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (!Number.isInteger(parsed.offset) || Number(parsed.offset) < 0 || parsed.version !== version)
      throw new Error('invalid');
    return Number(parsed.offset);
  } catch {
    throw new AdapterError(
      'source_version_mismatch',
      409,
      'Cursor is invalid or belongs to another source version',
    );
  }
}

function eventCursor(sequence: number) {
  return Buffer.from(String(sequence), 'utf8').toString('base64url');
}

function parseEventCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AdapterError('invalid_request', 400, 'Event cursor is invalid');
  return value;
}

function supported(scope: FrameworkScope) {
  return { status: 'supported' as const, modes: ['read' as const], requiredScopes: [scope] };
}

function unsupported(reasonCode: string) {
  return { status: 'unsupported' as const, modes: [], requiredScopes: [], reasonCode };
}

function unavailable(reasonCode: string) {
  return {
    status: 'unavailable' as const,
    modes: ['read' as const],
    requiredScopes: ['control:read'],
    reasonCode,
  };
}

function requireScope(scopes: Set<FrameworkScope>, scope: FrameworkScope) {
  if (!scopes.has(scope)) throw new AdapterError('forbidden', 403, `Required scope is unavailable`);
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reconcileFamilies(value: unknown): CapabilityFamily[] {
  if (value === undefined) return ['profiles', 'providers', 'work', 'conversations'];
  if (!Array.isArray(value) || value.length === 0)
    throw new AdapterError('invalid_request', 400, 'families must be a non-empty array');
  const allowed = new Set<CapabilityFamily>(['profiles', 'providers', 'work', 'conversations']);
  const result = [...new Set(value)];
  if (
    !result.every(
      (item): item is CapabilityFamily =>
        typeof item === 'string' && allowed.has(item as CapabilityFamily),
    )
  )
    throw new AdapterError('invalid_request', 400, 'families contains an unsupported value');
  return result;
}

async function observeFamilies(source: AdapterSource, families: CapabilityFamily[]) {
  const output: { family: CapabilityFamily; sourceVersion: string; count: number }[] = [];
  for (const family of families) {
    if (family === 'profiles') {
      const value = await source.profiles();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    } else if (family === 'providers') {
      const value = await source.providers();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    } else if (family === 'work') {
      const value = await source.boards();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    } else {
      const value = await source.sessions();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    }
  }
  return output;
}

function commandAuditFields(value: unknown) {
  const body =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const actor =
    body.actor && typeof body.actor === 'object' && !Array.isArray(body.actor)
      ? (body.actor as Record<string, unknown>)
      : {};
  return {
    mode: typeof body.mode === 'string' ? body.mode : undefined,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
    actorType: typeof actor.type === 'string' ? actor.type : undefined,
    actorId: typeof actor.id === 'string' ? actor.id : undefined,
  };
}

function mapError(error: unknown) {
  if (error instanceof AdapterError) return error;
  if (error instanceof SourceUnavailableError)
    return new AdapterError('capability_unavailable', 503, error.message, true);
  if (error instanceof IdempotencyConflictError)
    return new AdapterError('idempotency_conflict', 409, error.message);
  if (error instanceof IdempotencyBusyError)
    return new AdapterError('conflict', 409, error.message, true);
  const candidate = error as { validation?: unknown };
  if (candidate?.validation)
    return new AdapterError('invalid_request', 400, 'Request validation failed');
  return new AdapterError('internal_error', 500, 'Adapter request failed', true);
}
