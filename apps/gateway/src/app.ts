import cookie from '@fastify/cookie';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AuthError, AuthService } from './auth/service.js';
import type { AuthStore, SessionRecord } from './auth/types.js';
import { GovernanceError, GovernanceService } from './governance/service.js';
import type { GovernanceStore, OperationRecord } from './governance/types.js';
export interface AppOptions {
  authStore: AuthStore;
  authPepper: string;
  secureCookies?: boolean;
  release?: string;
  logger?: boolean;
  governanceStore?: GovernanceStore;
  allowedOrigins?: readonly string[];
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
  void app.register(cookie);
  app.addHook('onRequest', async (request) => {
    const origin = request.headers.origin;
    if (origin && !(options.allowedOrigins ?? []).includes(origin))
      throw new AuthError('ORIGIN_DENIED', 403, 'Origin is not allowed');
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const domainError =
      error instanceof AuthError || error instanceof GovernanceError ? error : null;
    const status = domainError?.statusCode ?? 500;
    if (!domainError) request.log.error({ err: error }, 'request failed');
    void reply.status(status).send({
      error: {
        code: domainError?.code ?? 'INTERNAL_ERROR',
        message: domainError?.message ?? 'Internal server error',
        requestId: request.id,
        retryable: status === 429 || status >= 500,
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
      (!options.governanceStore || (await options.governanceStore.ready()));
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
  function publicOperation(operation: OperationRecord) {
    if (!operation.targetFramework || !operation.targetKind || !operation.targetId)
      throw new GovernanceError('OPERATION_TARGET_INVALID', 500, 'Operation target is invalid');
    return {
      operationId: operation.id,
      operationType: operation.action,
      actorId: operation.actorUserId,
      target: {
        owner: operation.targetFramework,
        frameworkId: operation.targetFramework,
        kind: operation.targetKind,
        resourceId: operation.targetId,
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
