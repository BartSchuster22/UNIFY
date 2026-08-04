import cookie from '@fastify/cookie';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import {
  LoginInputSchema,
  MfaEnrollmentConfirmInputSchema,
  MfaEnrollmentStartInputSchema,
  MfaRemovalInputSchema,
  PasswordChangeInputSchema,
  ServiceCredentialCreateInputSchema,
} from '../contracts/v1/schemas.js';
import { canonicalIdSchema } from '../contracts/v1/primitives.js';
import type { AuthenticationService } from './service.js';
import type {
  AuthenticatedPrincipal,
  RequestContext,
  SessionAuthentication,
  UserPrincipal,
} from './types.js';
import { AuthenticationError } from './types.js';
import { Type } from '@sinclair/typebox';

export const SESSION_COOKIE = 'unify_session';
export const CSRF_COOKIE = 'unify_csrf';

export interface AuthenticationHttpOptions {
  readonly service: AuthenticationService;
  readonly secureCookies?: boolean;
  readonly cookiePath?: string;
}

const REQUEST_ID_PATTERN = /^req_[0-9A-HJKMNP-TV-Z]{26}$/u;
const CORRELATION_ID_PATTERN = /^cor_[0-9A-HJKMNP-TV-Z]{26}$/u;
const requestIds = new WeakMap<FastifyRequest, { requestId: string; correlationId: string }>();

function idsFor(request: FastifyRequest): { requestId: string; correlationId: string } {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const suppliedRequestId = request.headers['x-request-id'];
  const suppliedCorrelationId = request.headers['x-correlation-id'];
  const ids = {
    requestId:
      typeof suppliedRequestId === 'string' && REQUEST_ID_PATTERN.test(suppliedRequestId)
        ? suppliedRequestId
        : `req_${ulid()}`,
    correlationId:
      typeof suppliedCorrelationId === 'string' &&
      CORRELATION_ID_PATTERN.test(suppliedCorrelationId)
        ? suppliedCorrelationId
        : `cor_${ulid()}`,
  };
  requestIds.set(request, ids);
  return ids;
}

function contextFor(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    remoteAddress: request.ip,
    ...(userAgent ? { userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent } : {}),
    ...(typeof request.headers['x-device-label'] === 'string'
      ? { deviceLabel: request.headers['x-device-label'] }
      : {}),
    ...idsFor(request),
  };
}

function principalResponse(principal: UserPrincipal): Record<string, unknown> {
  return {
    contractVersion: 'core.v1',
    id: principal.id,
    username: principal.username,
    displayName: principal.displayName,
    roles: principal.roles,
    permissions: principal.permissions,
    mfaVerified: principal.mfaVerified,
  };
}

function errorCode(error: AuthenticationError): string {
  if (error.statusCode === 401)
    return error.code === 'AUTH_REQUIRED' ? 'authentication_required' : 'authentication_failed';
  if (error.code === 'CSRF_INVALID') return 'csrf_failed';
  if (error.statusCode === 403) return 'authorization_denied';
  if (error.statusCode === 404) return 'resource_not_found';
  if (error.statusCode === 409) return 'resource_conflict';
  if (error.statusCode === 422) return 'validation_failed';
  if (error.statusCode === 429) return 'rate_limited';
  if (error.statusCode === 503) return 'service_unavailable';
  return 'internal_error';
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: AuthenticationError): void {
  const { requestId, correlationId } = idsFor(request);
  if (error.retryAfterSeconds) reply.header('Retry-After', String(error.retryAfterSeconds));
  reply.status(error.statusCode).send({
    error: {
      contractVersion: 'core.v1',
      code: errorCode(error),
      status: error.statusCode,
      message: error.message,
      requestId,
      correlationId,
      retryable: error.statusCode === 429 || error.statusCode === 503,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  });
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function strictBodyKeys(keys: readonly string[]): (request: FastifyRequest) => Promise<void> {
  const allowed = new Set(keys);
  return async (request) => {
    if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body))
      return;
    if (Object.keys(request.body).some((key) => !allowed.has(key))) {
      throw new AuthenticationError('AUTH_VALIDATION_FAILED', 422, 'Request validation failed');
    }
  };
}

export const authenticationHttpPlugin: FastifyPluginAsync<AuthenticationHttpOptions> = async (
  app,
  options,
) => {
  const service = options.service;
  const cookiePath = options.cookiePath ?? '/core/v1';
  const secure = options.secureCookies ?? true;
  await app.register(cookie);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthenticationError) {
      sendError(request, reply, error);
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      (error as { validation?: unknown }).validation
    ) {
      sendError(
        request,
        reply,
        new AuthenticationError('AUTH_VALIDATION_FAILED', 422, 'Request validation failed'),
      );
      return;
    }
    app.log.error({ err: error }, 'authentication request failed');
    sendError(
      request,
      reply,
      new AuthenticationError('AUTH_INTERNAL', 503, 'Authentication service unavailable'),
    );
  });

  async function sessionFor(
    request: FastifyRequest,
    csrfRequired = false,
    allowPasswordChangeRequired = false,
  ): Promise<SessionAuthentication> {
    const session = await service.authenticateSession(request.cookies[SESSION_COOKIE]);
    if (csrfRequired) {
      const header = request.headers['x-csrf-token'];
      service.verifyCsrf(
        session,
        typeof header === 'string' ? header : undefined,
        request.cookies[CSRF_COOKIE],
      );
    }
    if (session.passwordChangeRequired && !allowPasswordChangeRequired) {
      throw new AuthenticationError(
        'AUTH_PASSWORD_CHANGE_REQUIRED',
        403,
        'Password change required',
      );
    }
    return session;
  }

  async function principalForRead(request: FastifyRequest): Promise<AuthenticatedPrincipal> {
    if (request.cookies[SESSION_COOKIE]) return sessionFor(request);
    const authorization = request.headers.authorization;
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (value?.startsWith('Bearer '))
      return service.authenticateService(value.slice(7), contextFor(request));
    throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
  }

  function setAuthenticationCookies(
    reply: FastifyReply,
    sessionToken: string,
    csrfToken: string,
    expiresAt: Date,
  ): void {
    const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
    const shared = { secure, sameSite: 'strict' as const, path: cookiePath, maxAge };
    reply.setCookie(SESSION_COOKIE, sessionToken, { ...shared, httpOnly: true });
    reply.setCookie(CSRF_COOKIE, csrfToken, { ...shared, httpOnly: false });
  }

  function clearAuthenticationCookies(reply: FastifyReply): void {
    const shared = { secure, sameSite: 'strict' as const, path: cookiePath };
    reply.clearCookie(SESSION_COOKIE, { ...shared, httpOnly: true });
    reply.clearCookie(CSRF_COOKIE, { ...shared, httpOnly: false });
  }

  app.post(
    '/core/v1/identity/login',
    {
      schema: { body: LoginInputSchema },
      preValidation: strictBodyKeys(['username', 'password', 'mfaCode']),
    },
    async (request, reply) => {
      const body = request.body as { username: string; password: string; mfaCode?: string };
      const result = await service.login(body, contextFor(request));
      setAuthenticationCookies(reply, result.sessionToken, result.csrfToken, result.expiresAt);
      if (result.principal.passwordChangeRequired)
        reply.header('X-Password-Change-Required', 'true');
      return principalResponse(result.principal);
    },
  );

  app.post('/core/v1/identity/logout', async (request, reply) => {
    const session = await sessionFor(request, true, true);
    await service.logout(session, contextFor(request));
    clearAuthenticationCookies(reply);
    reply.status(204).send();
  });

  app.get('/core/v1/identity/principal', async (request, reply) => {
    const session = await sessionFor(request, false, true);
    if (session.passwordChangeRequired) reply.header('X-Password-Change-Required', 'true');
    return principalResponse(session);
  });

  app.get('/core/v1/identity/sessions', async (request) => {
    const session = await sessionFor(request);
    const sessions = await service.listSessions(session);
    return {
      items: sessions.map((item) => ({
        meta: {
          id: item.id,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        },
        userId: item.userId,
        createdAt: item.createdAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        revokedAt: iso(item.revokedAt),
        deviceLabel: item.deviceLabel,
      })),
      page: { nextCursor: null, hasMore: false },
    };
  });

  app.delete(
    '/core/v1/identity/sessions/:sessionId',
    {
      schema: {
        params: Type.Object(
          { sessionId: canonicalIdSchema('session') },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const session = await sessionFor(request, true);
      const { sessionId } = request.params as { sessionId: string };
      await service.revokeSession(session, sessionId, contextFor(request));
      if (sessionId === session.sessionId) clearAuthenticationCookies(reply);
      reply.status(204).send();
    },
  );

  app.post(
    '/core/v1/identity/password-changes',
    {
      schema: { body: PasswordChangeInputSchema },
      preValidation: strictBodyKeys(['currentPassword', 'newPassword', 'revokeOtherSessions']),
    },
    async (request, reply) => {
      const session = await sessionFor(request, true, true);
      const body = request.body as {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions: boolean;
      };
      await service.changePassword(session, body, contextFor(request));
      reply.status(204).send();
    },
  );

  app.post(
    '/core/v1/identity/mfa-enrollments',
    {
      schema: { body: MfaEnrollmentStartInputSchema },
      preValidation: strictBodyKeys(['password']),
    },
    async (request, reply) => {
      const session = await sessionFor(request, true);
      const body = request.body as { password: string };
      const result = await service.startMfaEnrollment(session, body.password, contextFor(request));
      reply.status(201).send({
        enrollmentId: result.enrollmentId,
        provisioningUri: result.provisioningUri,
        recoveryCodes: result.recoveryCodes,
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  app.post(
    '/core/v1/identity/mfa-enrollments/:mfaEnrollmentId/confirmations',
    {
      schema: {
        params: Type.Object(
          { mfaEnrollmentId: canonicalIdSchema('mfaEnrollment') },
          { additionalProperties: false },
        ),
        body: MfaEnrollmentConfirmInputSchema,
      },
      preValidation: strictBodyKeys(['enrollmentId', 'code']),
    },
    async (request, reply) => {
      const session = await sessionFor(request, true);
      const { mfaEnrollmentId } = request.params as { mfaEnrollmentId: string };
      const body = request.body as { enrollmentId: string; code: string };
      if (body.enrollmentId !== mfaEnrollmentId)
        throw new AuthenticationError(
          'AUTH_MFA_ENROLLMENT_MISMATCH',
          422,
          'MFA enrollment ID does not match path',
        );
      await service.confirmMfaEnrollment(session, mfaEnrollmentId, body.code, contextFor(request));
      reply.status(204).send();
    },
  );

  app.post(
    '/core/v1/identity/mfa-removals',
    {
      schema: { body: MfaRemovalInputSchema },
      preValidation: strictBodyKeys(['password', 'code']),
    },
    async (request, reply) => {
      const session = await sessionFor(request, true);
      const body = request.body as { password: string; code: string };
      await service.removeMfa(session, body.password, body.code, contextFor(request));
      reply.status(204).send();
    },
  );

  app.get('/core/v1/identity/service-credentials', async (request) => {
    const principal = await principalForRead(request);
    const credentials = await service.listServiceCredentials(principal, contextFor(request));
    return {
      items: credentials.map((credential) => ({
        id: credential.id,
        serviceId: credential.serviceId,
        label: credential.label,
        scopes: credential.scopes,
        createdAt: credential.createdAt.toISOString(),
        expiresAt: iso(credential.expiresAt),
        revokedAt: iso(credential.revokedAt),
        lastUsedAt: iso(credential.lastUsedAt),
      })),
      page: { nextCursor: null, hasMore: false },
    };
  });

  app.post(
    '/core/v1/identity/service-credentials',
    {
      schema: { body: ServiceCredentialCreateInputSchema },
      preValidation: strictBodyKeys(['serviceId', 'label', 'scopes', 'expiresAt']),
    },
    async (request, reply) => {
      const session = await sessionFor(request, true);
      const body = request.body as {
        serviceId: string;
        label: string;
        scopes: string[];
        expiresAt?: string;
      };
      const issued = await service.issueServiceCredential(
        session,
        {
          serviceId: body.serviceId,
          label: body.label,
          scopes: body.scopes,
          ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
        },
        contextFor(request),
      );
      reply.status(201).send({
        credential: {
          id: issued.credential.id,
          serviceId: issued.credential.serviceId,
          label: issued.credential.label,
          scopes: issued.credential.scopes,
          createdAt: issued.credential.createdAt.toISOString(),
          expiresAt: iso(issued.credential.expiresAt),
          revokedAt: null,
          lastUsedAt: null,
        },
        token: issued.token,
      });
    },
  );

  app.delete(
    '/core/v1/identity/service-credentials/:credentialId',
    {
      schema: {
        params: Type.Object(
          { credentialId: canonicalIdSchema('credential') },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const session = await sessionFor(request, true);
      const { credentialId } = request.params as { credentialId: string };
      await service.revokeServiceCredential(session, credentialId, contextFor(request));
      reply.status(204).send();
    },
  );
};

export function actorFromAuthorization(principal: AuthenticatedPrincipal): {
  principalId: string;
  sessionId?: string;
} {
  return principal.kind === 'user'
    ? { principalId: principal.id, sessionId: principal.sessionId }
    : { principalId: principal.id };
}
