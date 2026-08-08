import cookie from '@fastify/cookie';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AuthError, AuthService } from './auth/service.js';
import type { AuthStore, SessionRecord } from './auth/types.js';
import { GovernanceError, GovernanceService } from './governance/service.js';
import type { GovernanceStore, OperationRecord } from './governance/types.js';
import {
  FrameworkRegistrationInputSchema,
  type FrameworkRegistrationInput,
} from '@aquiero/contracts';
import { MutationService } from './mutations/service.js';
import type { NotificationStore } from './notifications/postgres-store.js';
import { FixedWindowRateLimiter } from './security/rate-limiter.js';
import { FrameworkRegistryError } from './framework-registry/service.js';
import type { FrameworkRegistryService } from './framework-registry/service.js';
import type { HermesGatewayService } from './hermes-control/service.js';
import { MemoryV4AdapterError, type MemoryV4Adapter } from './memory-v4/client.js';
import { memoryRoute } from './memory-v4/types.js';
export interface AppOptions {
  authStore: AuthStore;
  authPepper: string;
  secureCookies?: boolean;
  release?: string;
  logger?: boolean;
  governanceStore?: GovernanceStore;
  allowedOrigins?: readonly string[];
  notificationStore?: NotificationStore;
  requestRateLimit?: number;
  frameworkRegistry?: FrameworkRegistryService;
  hermesGateway?: HermesGatewayService;
  memoryV4Adapter?: MemoryV4Adapter;
}
const SESSION_COOKIE = 'aquiero_session';
const CSRF_COOKIE = 'aquiero_csrf';
export function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.x-csrf-token',
              'res.headers.set-cookie',
            ],
            censor: '[REDACTED]',
          },
        }
      : false,
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    bodyLimit: 1024 * 1024,
  });
  const auth = new AuthService({ store: options.authStore, pepper: options.authPepper });
  const governance = options.governanceStore
    ? new GovernanceService(options.governanceStore)
    : null;
  const mutations =
    governance && options.hermesGateway
      ? new MutationService(governance, options.hermesGateway)
      : null;
  const requestLimiter = new FixedWindowRateLimiter(options.requestRateLimit ?? 600, 60_000);
  void app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    const isHealth =
      request.url === '/api/v1/health/live' || request.url === '/api/v1/health/ready';
    const rate = isHealth
      ? { allowed: true, retryAfterSeconds: 0 }
      : requestLimiter.consume(request.ip);
    if (!rate.allowed) {
      reply.header('retry-after', String(rate.retryAfterSeconds));
      throw new AuthError('RATE_LIMITED', 429, 'Request rate limit exceeded');
    }
    const origin = request.headers.origin;
    if (origin && !(options.allowedOrigins ?? []).includes(origin))
      throw new AuthError('ORIGIN_DENIED', 403, 'Origin is not allowed');
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const domainError =
      error instanceof AuthError ||
      error instanceof GovernanceError ||
      error instanceof FrameworkRegistryError ||
      error instanceof MemoryV4AdapterError
        ? error
        : null;
    const status = domainError?.statusCode ?? 500;
    const retryable =
      domainError instanceof MemoryV4AdapterError
        ? domainError.retryable
        : status === 429 || status >= 500;
    if (!domainError) request.log.error({ err: error }, 'request failed');
    void reply.status(status).send({
      error: {
        code: domainError?.code ?? 'INTERNAL_ERROR',
        message: domainError?.message ?? 'Internal server error',
        requestId: request.id,
        retryable,
      },
    });
  });
  async function session(request: FastifyRequest): Promise<SessionRecord> {
    return auth.authenticate(request.cookies[SESSION_COOKIE]);
  }
  async function mutationSession(request: FastifyRequest): Promise<SessionRecord> {
    const current = await session(request);
    const header = request.headers['x-csrf-token'];
    auth.verifyCsrf(
      current,
      Array.isArray(header) ? header[0] : header,
      request.cookies[CSRF_COOKIE],
    );
    return current;
  }
  const cookieOptions = {
    path: '/',
    secure: options.secureCookies ?? true,
    sameSite: 'strict' as const,
  };
  app.get('/api/v1/health/live', async () => ({
    status: 'ok',
    release: options.release ?? 'development',
  }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    const ready =
      (await options.authStore.ready()) &&
      (!options.governanceStore || (await options.governanceStore.ready())) &&
      (!options.notificationStore || (await options.notificationStore.ready())) &&
      (!options.frameworkRegistry || (await options.frameworkRegistry.ready())) &&
      (!options.hermesGateway || (await options.hermesGateway.ready()));
    return reply
      .status(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', release: options.release ?? 'development' });
  });
  app.post<{ Body: { username?: string; password?: string; deviceLabel?: string } }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 200 },
            password: { type: 'string', minLength: 12, maxLength: 1024 },
            deviceLabel: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await auth.login(request.body.username ?? '', request.body.password ?? '', {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        deviceLabel: request.body.deviceLabel,
      });
      await governance?.audit({
        actorUserId: result.principal.userId,
        sessionId: result.sessionId,
        action: 'auth.login',
        outcome: 'success',
        requestId: request.id,
      });
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        ...cookieOptions,
        httpOnly: true,
        expires: result.expiresAt,
      });
      reply.setCookie(CSRF_COOKIE, result.csrfToken, {
        ...cookieOptions,
        httpOnly: false,
        expires: result.expiresAt,
      });
      reply.header('x-csrf-token', result.csrfToken);
      return result.principal;
    },
  );
  app.get('/api/v1/auth/me', async (request) => {
    const current = await session(request);
    return {
      userId: current.userId,
      username: current.username,
      displayName: current.displayName,
      roles: current.roles,
      permissions: current.permissions,
    };
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const current = await mutationSession(request);
    await auth.revokeSession(current.sessionId, 'logout');
    await governance?.audit({
      actorUserId: current.userId,
      sessionId: current.sessionId,
      action: 'auth.logout',
      outcome: 'success',
      requestId: request.id,
    });
    clear(reply);
    return reply.status(204).send();
  });
  app.get('/api/v1/sessions', async (request) => {
    const current = await session(request);
    return { items: await auth.listSessions(current.userId) };
  });
  app.delete<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId',
    async (request, reply) => {
      const current = await mutationSession(request);
      const own = (await auth.listSessions(current.userId)).some(
        (item) => item.id === request.params.sessionId,
      );
      if (!own) auth.requirePermission(current, 'users.manage');
      const revoked = await auth.revokeSession(request.params.sessionId, 'operator_revocation');
      if (!revoked)
        return reply.status(404).send({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found',
            requestId: request.id,
            retryable: false,
          },
        });
      await governance?.audit({
        actorUserId: current.userId,
        sessionId: current.sessionId,
        action: 'session.revoke',
        target: { sessionId: request.params.sessionId },
        outcome: 'success',
        requestId: request.id,
      });
      if (request.params.sessionId === current.sessionId) clear(reply);
      return reply.status(204).send();
    },
  );
  app.get<{ Params: { operationId: string } }>(
    '/api/v1/operations/:operationId',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'operations.read');
      if (!options.governanceStore)
        throw new GovernanceError('GOVERNANCE_UNAVAILABLE', 503, 'Governance store unavailable');
      const operation = await options.governanceStore.getOperation(request.params.operationId);
      if (!operation) throw new GovernanceError('OPERATION_NOT_FOUND', 404, 'Operation not found');
      return publicOperation(operation);
    },
  );
  type ReadQuery = {
    owner?: string;
    kind?: string;
    refresh?: string | boolean;
    cursor?: string;
    limit?: string | number;
  };
  type FrameworkPageQuery = Pick<ReadQuery, 'cursor' | 'limit' | 'refresh'>;
  app.get<{ Querystring: Pick<ReadQuery, 'cursor' | 'limit'> }>(
    '/api/v1/operations',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'operations.read');
      if (!options.governanceStore)
        throw new GovernanceError('GOVERNANCE_UNAVAILABLE', 503, 'Governance store unavailable');
      const operations = (await options.governanceStore.listOperations(500)).map(publicOperation);
      const page = paginate(operations, request.query, (operation) => operation.operationId);
      return { items: page.items, meta: meta(request.id, [], page.page) };
    },
  );
  app.get<{ Querystring: Pick<ReadQuery, 'cursor' | 'limit'> }>(
    '/api/v1/audit',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'audit.read');
      if (!options.governanceStore)
        throw new GovernanceError('GOVERNANCE_UNAVAILABLE', 503, 'Governance store unavailable');
      const records = (await options.governanceStore.listAudit(500)).map((record) => ({
        ...record,
        occurredAt: record.occurredAt.toISOString(),
      }));
      const page = paginate(records, request.query, (record) => record.id);
      return { items: page.items, meta: meta(request.id, [], page.page) };
    },
  );

  app.post<{ Body: unknown }>(
    '/api/v1/mutations',
    { bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const current = await mutationSession(request);
      if (!mutations)
        throw new GovernanceError(
          'MUTATIONS_UNAVAILABLE',
          503,
          'Mutation execution is unavailable',
        );
      const input = mutations.parse(request.body);
      auth.requirePermission(current, mutations.permission(input));

      const rawKey = request.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
      const result = await mutations.run(current.userId, idempotencyKey, input);
      return reply.status(result.replayed ? 200 : 201).send({
        replayed: result.replayed,
        operation: publicOperation(result.operation),
        result: result.result,
      });
    },
  );
  app.get('/api/v1/memory/status', async (request) => {
    const current = await session(request);
    auth.requirePermission(current, 'memory.read');
    if (!options.memoryV4Adapter)
      throw new MemoryV4AdapterError(
        'MEMORY_ADAPTER_UNAVAILABLE',
        503,
        'MemoryV4 adapter is not configured',
        true,
      );
    return options.memoryV4Adapter.probe(current.userId, request.id);
  });

  app.all<{
    Params: { '*': string };
    Querystring: Record<string, unknown>;
    Body: unknown;
  }>('/api/v1/memory/*', { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    const current = await session(request);
    const path = `/${request.params['*']}`;
    const route = memoryRoute(request.method, path);
    if (!route)
      throw new MemoryV4AdapterError(
        'MEMORY_ROUTE_NOT_FOUND',
        404,
        'MemoryV4 adapter route is not available',
      );
    if (route.mutation) {
      const header = request.headers['x-csrf-token'];
      auth.verifyCsrf(
        current,
        Array.isArray(header) ? header[0] : header,
        request.cookies[CSRF_COOKIE],
      );
    }
    auth.requirePermission(current, route.permission);
    if (!options.memoryV4Adapter)
      throw new MemoryV4AdapterError(
        'MEMORY_ADAPTER_UNAVAILABLE',
        503,
        'MemoryV4 adapter is not configured',
        true,
      );
    const rawIdempotency = request.headers['idempotency-key'];
    const rawMatch = request.headers['if-match'];
    const rawReason = request.headers['x-memoryv4-reason'];
    try {
      const result = await options.memoryV4Adapter.execute({
        method: request.method as 'GET' | 'POST' | 'PATCH',
        path,
        route,
        actorUserId: current.userId,
        requestId: request.id,
        query: request.query,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(typeof rawIdempotency === 'string' ? { idempotencyKey: rawIdempotency } : {}),
        ...(typeof rawMatch === 'string' ? { ifMatch: rawMatch } : {}),
        ...(typeof rawReason === 'string' ? { reason: rawReason } : {}),
      });
      if (result.idempotencyReplayed)
        reply.header('idempotency-replayed', result.idempotencyReplayed);
      reply.header('x-memoryv4-contract-version', result.contractVersion);
      if (route.mutation)
        await governance?.audit({
          actorUserId: current.userId,
          sessionId: current.sessionId,
          action: `memory.adapter.${request.method.toLowerCase()}`,
          outcome: 'success',
          requestId: request.id,
          target: { path },
          details: { upstreamStatus: result.statusCode },
        });
      return reply.status(result.statusCode).send(result.body);
    } catch (error) {
      if (route.mutation)
        await governance?.audit({
          actorUserId: current.userId,
          sessionId: current.sessionId,
          action: `memory.adapter.${request.method.toLowerCase()}`,
          outcome:
            error instanceof MemoryV4AdapterError && error.statusCode < 500 ? 'denied' : 'failure',
          requestId: request.id,
          target: { path },
          details: {
            code: error instanceof MemoryV4AdapterError ? error.code : 'MEMORY_ADAPTER_FAILED',
          },
        });
      throw error;
    }
  });

  app.get('/api/v1/frameworks', async (request) => {
    const current = await session(request);
    auth.requirePermission(current, 'frameworks.read');
    if (!options.frameworkRegistry)
      throw new FrameworkRegistryError(
        'FRAMEWORK_REGISTRY_UNAVAILABLE',
        503,
        'Framework registry is unavailable',
      );
    return { items: await options.frameworkRegistry.list() };
  });
  app.get<{ Params: { frameworkId: string } }>(
    '/api/v1/frameworks/:frameworkId',
    async (request, reply) => {
      const current = await session(request);
      auth.requirePermission(current, 'frameworks.read');
      if (!options.frameworkRegistry)
        throw new FrameworkRegistryError(
          'FRAMEWORK_REGISTRY_UNAVAILABLE',
          503,
          'Framework registry is unavailable',
        );
      const item = await options.frameworkRegistry.get(request.params.frameworkId);
      return (
        item ??
        reply.status(404).send({
          error: {
            code: 'FRAMEWORK_NOT_FOUND',
            message: 'Framework not found',
            requestId: request.id,
            retryable: false,
          },
        })
      );
    },
  );
  app.put<{ Params: { frameworkId: string }; Body: FrameworkRegistrationInput }>(
    '/api/v1/frameworks/:frameworkId',
    { schema: { body: FrameworkRegistrationInputSchema } },
    async (request) => {
      const current = await mutationSession(request);
      auth.requirePermission(current, 'settings.manage');
      if (request.params.frameworkId !== request.body.frameworkId)
        throw new FrameworkRegistryError(
          'FRAMEWORK_ID_MISMATCH',
          422,
          'Path and body framework IDs differ',
        );
      if (!options.frameworkRegistry)
        throw new FrameworkRegistryError(
          'FRAMEWORK_REGISTRY_UNAVAILABLE',
          503,
          'Framework registry is unavailable',
        );
      const item = await options.frameworkRegistry.register(request.body);
      await governance?.audit({
        actorUserId: current.userId,
        sessionId: current.sessionId,
        action: 'framework.register',
        outcome: 'success',
        requestId: request.id,
        target: { frameworkId: item.frameworkId },
        details: { contractVersion: item.contractVersion, frameworkCommit: item.frameworkCommit },
      });
      return item;
    },
  );
  app.delete<{ Params: { frameworkId: string } }>(
    '/api/v1/frameworks/:frameworkId',
    async (request, reply) => {
      const current = await mutationSession(request);
      auth.requirePermission(current, 'settings.manage');
      if (!options.frameworkRegistry)
        throw new FrameworkRegistryError(
          'FRAMEWORK_REGISTRY_UNAVAILABLE',
          503,
          'Framework registry is unavailable',
        );
      const removed = await options.frameworkRegistry.remove(request.params.frameworkId);
      if (!removed)
        return reply.status(404).send({
          error: {
            code: 'FRAMEWORK_NOT_FOUND',
            message: 'Framework not found',
            requestId: request.id,
            retryable: false,
          },
        });
      await governance?.audit({
        actorUserId: current.userId,
        sessionId: current.sessionId,
        action: 'framework.unregister',
        outcome: 'success',
        requestId: request.id,
        target: { frameworkId: request.params.frameworkId },
      });
      return reply.status(204).send();
    },
  );
  app.get<{ Params: { frameworkId: string } }>(
    '/api/v1/frameworks/:frameworkId/health',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'frameworks.read');
      return requireHermesGateway().health(request.params.frameworkId);
    },
  );
  app.get<{ Params: { frameworkId: string } }>(
    '/api/v1/frameworks/:frameworkId/capabilities',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'frameworks.read');
      return requireHermesGateway().capabilities(request.params.frameworkId);
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/profiles',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'profiles.read');
      return requireHermesGateway().profiles(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/providers',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'models.read');
      return requireHermesGateway().providers(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/models',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'models.read');
      return requireHermesGateway().models(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/work/projects',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'work.read');
      return requireHermesGateway().projects(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/work/boards',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'work.read');
      return requireHermesGateway().boards(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{
    Params: { frameworkId: string; boardId: string };
    Querystring: FrameworkPageQuery;
  }>('/api/v1/frameworks/:frameworkId/work/boards/:boardId/tasks', async (request) => {
    const current = await session(request);
    auth.requirePermission(current, 'work.read');
    return requireHermesGateway().tasks(
      request.params.frameworkId,
      request.params.boardId,
      frameworkPageQuery(request.query),
    );
  });
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/work/cronjobs',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'work.read');
      return requireHermesGateway().cronjobs(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/conversations/sessions',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'chat.read');
      return requireHermesGateway().sessions(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{
    Params: { frameworkId: string; sessionId: string };
    Querystring: FrameworkPageQuery;
  }>(
    '/api/v1/frameworks/:frameworkId/conversations/sessions/:sessionId/messages',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'chat.read');
      return requireHermesGateway().messages(
        request.params.frameworkId,
        request.params.sessionId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Params: { frameworkId: string }; Querystring: FrameworkPageQuery }>(
    '/api/v1/frameworks/:frameworkId/events',
    async (request) => {
      const current = await session(request);
      auth.requirePermission(current, 'operations.read');
      return requireHermesGateway().events(
        request.params.frameworkId,
        frameworkPageQuery(request.query),
      );
    },
  );
  app.get<{ Querystring: Pick<ReadQuery, 'cursor' | 'limit'> }>(
    '/api/v1/notifications',
    async (request) => {
      const current = await session(request);
      if (!options.notificationStore)
        throw new GovernanceError(
          'NOTIFICATIONS_UNAVAILABLE',
          503,
          'Notification state is unavailable',
        );
      const notifications = await options.notificationStore.list(
        current.userId,
        notificationOwners(current),
      );
      const page = paginate(notifications, request.query, (item) => item.id);
      return { items: page.items, meta: meta(request.id, [], page.page) };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/notifications/:id/acknowledge',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 2048 } },
        },
      },
    },
    async (request, reply) => {
      const current = await mutationSession(request);
      if (!options.notificationStore)
        throw new GovernanceError(
          'NOTIFICATIONS_UNAVAILABLE',
          503,
          'Notification state is unavailable',
        );
      const source = await options.notificationStore.acknowledge(
        current.userId,
        request.params.id,
        notificationOwners(current),
      );
      if (!source)
        throw new GovernanceError('NOTIFICATION_NOT_FOUND', 404, 'Notification was not found');
      await governance?.audit({
        actorUserId: current.userId,
        sessionId: current.sessionId,
        action: 'notification.acknowledge',
        outcome: 'success',
        requestId: request.id,
        target: { owner: source, notificationId: request.params.id },
      });
      return reply.status(204).send();
    },
  );

  function requireHermesGateway(): HermesGatewayService {
    if (!options.hermesGateway)
      throw new GovernanceError(
        'HERMES_GATEWAY_UNAVAILABLE',
        503,
        'Hermes framework gateway is unavailable',
      );
    return options.hermesGateway;
  }
  function frameworkPageQuery(query: FrameworkPageQuery) {
    let limit: number | undefined;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new GovernanceError(
          'INVALID_PAGE_LIMIT',
          400,
          'Page limit must be an integer from 1 to 500',
        );
    }
    return {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(query.refresh === true || query.refresh === 'true' ? { refresh: true } : {}),
    };
  }
  function notificationOwners(current: SessionRecord): string[] {
    const owners: string[] = [];
    if (
      ['frameworks.read', 'profiles.read', 'models.read', 'work.read', 'chat.read'].some(
        (permission) => current.permissions.includes(permission),
      )
    )
      owners.push('hermes');
    if (current.permissions.includes('operations.read')) owners.push('gateway');
    return owners;
  }
  function paginate<T>(
    items: T[],
    query: { cursor?: string; limit?: string | number },
    key: (item: T) => string,
  ): { items: T[]; page: { nextCursor?: string; hasMore: boolean } } {
    const requested = Number(query.limit ?? 100);
    if (!Number.isInteger(requested) || requested < 1 || requested > 500)
      throw new AuthError('INVALID_PAGE_LIMIT', 400, 'Page limit must be an integer from 1 to 500');
    let start = 0;
    if (query.cursor) {
      let cursorKey = '';
      try {
        const decoded = Buffer.from(query.cursor, 'base64url').toString('utf8');
        if (!decoded.startsWith('v1:')) throw new Error('version');
        cursorKey = decoded.slice(3);
      } catch {
        throw new AuthError('INVALID_CURSOR', 400, 'Pagination cursor is invalid');
      }
      const index = items.findIndex((item) => key(item) === cursorKey);
      if (index < 0)
        throw new AuthError('INVALID_CURSOR', 400, 'Pagination cursor is no longer valid');
      start = index + 1;
    }
    const selected = items.slice(start, start + requested);
    const hasMore = start + selected.length < items.length;
    const last = selected.at(-1);
    return {
      items: selected,
      page: {
        hasMore,
        ...(hasMore && last
          ? { nextCursor: Buffer.from(`v1:${key(last)}`).toString('base64url') }
          : {}),
      },
    };
  }
  function meta(
    requestId: string,
    snapshots: Array<{
      observedAt: string;
      status: string;
      warnings: Array<{ code: string; message: string }>;
    }> = [],
    page?: { nextCursor?: string; hasMore: boolean },
  ) {
    const warnings = snapshots.flatMap((snapshot) => snapshot.warnings);
    const observedAt = snapshots
      .map((snapshot) => snapshot.observedAt)
      .sort()
      .at(0);
    const freshness = snapshots.some(
      (snapshot) => snapshot.status === 'unavailable' || snapshot.status === 'failed',
    )
      ? snapshots.some((snapshot) => snapshot.status === 'current' || snapshot.status === 'partial')
        ? 'partial'
        : 'unavailable'
      : snapshots.some((snapshot) => snapshot.status === 'partial')
        ? 'partial'
        : 'current';
    return {
      requestId,
      correlationId: requestId,
      source: { owner: 'gateway' as const, adapterId: 'unify-read-federation-v1' },
      sourceStatus: snapshots.length ? 'observed' : 'cached',
      freshness,
      ...(observedAt ? { observedAt } : {}),
      generatedAt: new Date().toISOString(),
      warnings,
      ...(page ? { page } : {}),
    };
  }

  function publicOperation(operation: OperationRecord) {
    if (!operation.targetFramework || !operation.targetKind || !operation.targetId)
      throw new GovernanceError('OPERATION_TARGET_INVALID', 500, 'Operation target is invalid');
    return {
      operationId: operation.id,
      operationType: operation.action,
      actorId: operation.actorUserId,
      target: {
        canonicalId: `${operation.targetFramework}:${operation.targetKind}:${Buffer.from(
          operation.targetId,
        ).toString('base64url')}`,
        owner: operation.targetFramework,
        frameworkId: operation.targetFramework,
        kind: operation.targetKind,
        nativeId: operation.targetId,
        observedAt: operation.updatedAt.toISOString(),
      },
      payloadHash: operation.requestHash,
      mode: operation.mode,
      idempotencyKey: operation.idempotencyKey,
      ...(operation.sourceVersion ? { sourceVersion: operation.sourceVersion } : {}),
      policyDecision: operation.policyDecision,
      state: operation.state,
      createdAt: operation.createdAt.toISOString(),
      updatedAt: operation.updatedAt.toISOString(),
      evidenceIds: operation.evidenceIds,
    };
  }
  function clear(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    reply.clearCookie(CSRF_COOKIE, cookieOptions);
  }
  return app;
}
