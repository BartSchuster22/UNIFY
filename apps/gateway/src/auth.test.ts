import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { hashPassword, sha256 } from './auth/crypto.js';
import type {
  AuthStore,
  LoginThrottle,
  NewSession,
  PrincipalRecord,
  SessionRecord,
  SessionSummary,
  UserRecord,
} from './auth/types.js';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
} from '@aquiero/contracts';
import { FrameworkRegistryService } from './framework-registry/service.js';
import type { FrameworkRegistrationRecord } from './framework-registry/types.js';
import type { HermesGatewayService } from './hermes-control/service.js';

class MemoryAuthStore implements AuthStore {
  readonly timezones = new Map<string, string>();
  async getTimezone(userId: string) {
    return this.timezones.get(userId) ?? null;
  }
  async setTimezone(userId: string, timezone: string) {
    this.timezones.set(userId, timezone);
  }
  readonly users = new Map<string, UserRecord>();
  readonly principals = new Map<string, PrincipalRecord>();
  readonly throttles = new Map<string, LoginThrottle>();
  readonly sessions = new Map<
    string,
    NewSession & { id: string; createdAt: Date; lastSeenAt: Date; revokedAt: Date | null }
  >();
  async ready() {
    return true;
  }
  async findUserByUsername(username: string) {
    return (
      [...this.users.values()].find((user) => user.username.toLowerCase() === username) ?? null
    );
  }
  async getPrincipal(userId: string) {
    return this.principals.get(userId) ?? null;
  }
  async getLoginThrottle(subjectHash: string) {
    return this.throttles.get(subjectHash) ?? null;
  }
  async recordLoginFailure(subjectHash: string, blockedUntil: Date | null) {
    const old = this.throttles.get(subjectHash);
    this.throttles.set(subjectHash, { failedCount: (old?.failedCount ?? 0) + 1, blockedUntil });
  }
  async clearLoginFailures(subjectHash: string) {
    this.throttles.delete(subjectHash);
  }
  async createSession(session: NewSession) {
    const id = `session-${this.sessions.size + 1}`;
    const now = new Date();
    this.sessions.set(id, { ...session, id, createdAt: now, lastSeenAt: now, revokedAt: null });
    return id;
  }
  async findActiveSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    const found = [...this.sessions.values()].find(
      (item) => item.tokenHash === tokenHash && !item.revokedAt && item.expiresAt > now,
    );
    if (!found) return null;
    const principal = this.principals.get(found.userId);
    return principal
      ? { ...principal, sessionId: found.id, csrfHash: found.csrfHash, expiresAt: found.expiresAt }
      : null;
  }
  async listSessions(userId: string): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .filter((item) => item.userId === userId)
      .map((item) => ({
        id: item.id,
        userId: item.userId,
        deviceLabel: item.deviceLabel,
        createdAt: item.createdAt,
        lastSeenAt: item.lastSeenAt,
        expiresAt: item.expiresAt,
        revokedAt: item.revokedAt,
      }));
  }
  async revokeSession(sessionId: string, _reason: string, now: Date) {
    const found = this.sessions.get(sessionId);
    if (!found || found.revokedAt) return false;
    found.revokedAt = now;
    return true;
  }
  async touchSession(sessionId: string, now: Date) {
    const found = this.sessions.get(sessionId);
    if (found) found.lastSeenAt = now;
  }
}

const pepper = 'test-only-pepper';
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('correct-horse-battery', pepper);
});

function fixtureStore() {
  const store = new MemoryAuthStore();
  store.users.set('viewer', {
    id: 'viewer',
    username: 'viewer',
    displayName: 'Viewer',
    passwordHash,
    status: 'active',
  });
  store.principals.set('viewer', {
    userId: 'viewer',
    username: 'viewer',
    displayName: 'Viewer',
    roles: ['Viewer'],
    permissions: ['frameworks.read', 'profiles.read', 'models.read'],
  });
  store.users.set('admin', {
    id: 'admin',
    username: 'admin',
    displayName: 'Administrator',
    passwordHash,
    status: 'active',
  });
  store.principals.set('admin', {
    userId: 'admin',
    username: 'admin',
    displayName: 'Administrator',
    roles: ['Administrator'],
    permissions: ['users.manage', 'frameworks.read', 'settings.manage'],
  });
  return store;
}

function cookieValue(setCookies: string[], name: string) {
  const entry = setCookies.find((value) => value.startsWith(`${name}=`));
  return entry?.split(';', 1)[0]?.split('=', 2)[1];
}
async function login(app: ReturnType<typeof buildApp>, username = 'viewer') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password: 'correct-horse-battery' },
  });
  const cookies = response.headers['set-cookie'];
  const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  return {
    response,
    session: cookieValue(list, 'aquiero_session') ?? '',
    csrf: response.headers['x-csrf-token'] as string,
  };
}

describe('named-user session security', () => {
  it('protects self-service preferences with authentication, CSRF and account isolation', async () => {
    const store = fixtureStore();
    const app = buildApp({ authStore: store, authPepper: pepper, secureCookies: false });
    const url = '/api/v1/auth/preferences';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const viewer = await login(app);
    const headers = {
      cookie: `aquiero_session=${viewer.session}; aquiero_csrf=${viewer.csrf}`,
      'x-csrf-token': viewer.csrf,
    };
    expect((await app.inject({ method: 'GET', url, headers })).json()).toEqual({ timezone: null });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers: { cookie: headers.cookie },
          payload: { timezone: 'UTC' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'PUT', url, headers, payload: { timezone: 'Atlantic/Canary' } }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers })).json()).toEqual({
      timezone: 'Atlantic/Canary',
    });
    expect(store.timezones.has('admin')).toBe(false);
    expect(
      (await app.inject({ method: 'PUT', url, headers, payload: { timezone: 'invalid-zone' } }))
        .statusCode,
    ).toBe(422);
    const other = await login(app, 'admin');
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { cookie: `aquiero_session=${other.session}` },
        })
      ).json(),
    ).toEqual({ timezone: null });
    await app.close();
  });
  it('enforces framework registration RBAC/CSRF and never returns service-auth references', async () => {
    const records = new Map<string, FrameworkRegistrationRecord>();
    const meta = {
      contractVersion: HERMES_CONTROL_VERSION,
      frameworkId: 'hermes-dev',
      frameworkVersion: PINNED_HERMES_RELEASE,
      frameworkCommit: PINNED_HERMES_COMMIT,
      sourceVersion: `git:${PINNED_HERMES_COMMIT}`,
      observedAt: '2026-07-21T12:00:00.000Z',
    };
    const registry = new FrameworkRegistryService(
      {
        async ready() {
          return true;
        },
        async list() {
          return [...records.values()];
        },
        async get(id) {
          return records.get(id) ?? null;
        },
        async upsert(value) {
          records.set(value.frameworkId, value);
          return value;
        },
        async remove(id) {
          return records.delete(id);
        },
      },
      {
        async inspect() {
          return {
            identity: {
              ...meta,
              data: { runtime: 'hermes-agent', instanceId: 'pinned', displayName: 'Hermes' },
            },
            version: {
              ...meta,
              data: {
                release: PINNED_HERMES_RELEASE,
                commit: PINNED_HERMES_COMMIT,
                dirty: false,
                pythonVersion: '3.11.15',
              },
            },
            capabilities: { ...meta, data: { capabilities: {} } },
          };
        },
      },
      () => 'fixture-token',
    );
    const app = buildApp({
      authStore: fixtureStore(),
      authPepper: pepper,
      secureCookies: false,
      frameworkRegistry: registry,
    });
    const payload = {
      frameworkId: 'hermes-dev',
      displayName: 'Hermes Dev',
      baseUrl: 'http://127.0.0.1:18799',
      serviceAuthReference: 'env:HERMES_CONTROL_TOKEN',
      scopes: ['control:read'],
      expectedContractVersion: HERMES_CONTROL_VERSION,
      expectedFrameworkVersion: PINNED_HERMES_RELEASE,
      expectedFrameworkCommit: PINNED_HERMES_COMMIT,
      enabled: true,
    };
    const viewer = await login(app, 'viewer');
    const denied = await app.inject({
      method: 'PUT',
      url: '/api/v1/frameworks/hermes-dev',
      headers: {
        cookie: `aquiero_session=${viewer.session}; aquiero_csrf=${viewer.csrf}`,
        'x-csrf-token': viewer.csrf,
      },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const admin = await login(app, 'admin');
    const allowed = await app.inject({
      method: 'PUT',
      url: '/api/v1/frameworks/hermes-dev',
      headers: {
        cookie: `aquiero_session=${admin.session}; aquiero_csrf=${admin.csrf}`,
        'x-csrf-token': admin.csrf,
      },
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).not.toContain('HERMES_CONTROL_TOKEN');
    await app.close();
  });

  it('authenticates a named user and does not return session tokens in JSON', async () => {
    const app = buildApp({ authStore: fixtureStore(), authPepper: pepper, secureCookies: false });
    const result = await login(app);
    expect(result.response.statusCode).toBe(200);
    expect(result.response.json()).toMatchObject({ userId: 'viewer', roles: ['Viewer'] });
    expect(result.response.body).not.toContain(result.session);
    expect(result.session).not.toBe('');
    await app.close();
  });

  it('requires matching cookie/header CSRF and revokes logout immediately', async () => {
    const app = buildApp({ authStore: fixtureStore(), authPepper: pepper, secureCookies: false });
    const result = await login(app);
    const cookie = `aquiero_session=${result.session}; aquiero_csrf=${result.csrf}`;
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(rejected.statusCode).toBe(403);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'x-csrf-token': result.csrf },
    });
    expect(logout.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    await app.close();
  });

  it('enforces RBAC on revoking another user session', async () => {
    const store = fixtureStore();
    const app = buildApp({ authStore: store, authPepper: pepper, secureCookies: false });
    const viewer = await login(app, 'viewer');
    const admin = await login(app, 'admin');
    const adminSessionId =
      [...store.sessions.values()].find((item) => item.userId === 'admin')?.id ?? '';
    const viewerCookie = `aquiero_session=${viewer.session}; aquiero_csrf=${viewer.csrf}`;
    const denied = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sessions/${adminSessionId}`,
      headers: { cookie: viewerCookie, 'x-csrf-token': viewer.csrf },
    });
    expect(denied.statusCode).toBe(403);
    const viewerSessionId =
      [...store.sessions.values()].find((item) => item.userId === 'viewer')?.id ?? '';
    const adminCookie = `aquiero_session=${admin.session}; aquiero_csrf=${admin.csrf}`;
    const allowed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sessions/${viewerSessionId}`,
      headers: { cookie: adminCookie, 'x-csrf-token': admin.csrf },
    });
    expect(allowed.statusCode).toBe(204);
    await app.close();
  });

  it('throttles repeated invalid credentials without revealing usernames', async () => {
    const app = buildApp({ authStore: fixtureStore(), authPepper: pepper, secureCookies: false });
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'viewer', password: 'definitely-wrong' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe('Invalid username or password');
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'viewer', password: 'correct-horse-battery' },
    });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it('sets defensive headers and rejects unapproved browser origins', async () => {
    const app = buildApp({
      authStore: fixtureStore(),
      authPepper: pepper,
      secureCookies: false,
      allowedOrigins: ['https://ui.example'],
    });
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { origin: 'https://ui.example' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['x-frame-options']).toBe('DENY');
    expect(allowed.headers['x-request-id']).toBeTruthy();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ORIGIN_DENIED');
    await app.close();
  });

  it('routes profile/provider reads only through Hermes and leaves legacy owner routes disabled', async () => {
    const hermesGateway = {
      async profiles(frameworkId: string) {
        return {
          meta: { owner: 'hermes', frameworkId, sourceVersion: 'profiles:v1' },
          items: [{ id: 'default', owner: 'hermes', frameworkId }],
          page: { hasMore: false },
        };
      },
      async providers(frameworkId: string) {
        return {
          meta: { owner: 'hermes', frameworkId, sourceVersion: 'providers:v1' },
          items: [{ id: 'openai-codex', owner: 'hermes', frameworkId }],
          page: { hasMore: false },
        };
      },
    } as unknown as HermesGatewayService;
    const app = buildApp({
      authStore: fixtureStore(),
      authPepper: pepper,
      secureCookies: false,
      hermesGateway,
    });
    const viewer = await login(app);
    const cookie = `aquiero_session=${viewer.session}; aquiero_csrf=${viewer.csrf}`;
    const profiles = await app.inject({
      method: 'GET',
      url: '/api/v1/frameworks/hermes-main/profiles',
      headers: { cookie },
    });
    expect(profiles.statusCode).toBe(200);
    expect(profiles.json()).toMatchObject({
      meta: { owner: 'hermes', frameworkId: 'hermes-main' },
      items: [{ owner: 'hermes' }],
    });
    const agents = await app.inject({
      method: 'GET',
      url: '/api/v1/frameworks/hermes-main/agents',
      headers: { cookie },
    });
    expect(agents.statusCode).toBe(200);
    expect(agents.json()).toMatchObject({
      meta: { owner: 'hermes', frameworkId: 'hermes-main' },
      items: [
        {
          id: 'default',
          kind: 'agent',
          agentId: 'hermes-main:default',
          nativeProfileId: 'default',
          owner: 'hermes',
          frameworkId: 'hermes-main',
        },
      ],
    });
    const providers = await app.inject({
      method: 'GET',
      url: '/api/v1/frameworks/hermes-main/providers',
      headers: { cookie },
    });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toMatchObject({ items: [{ owner: 'hermes' }] });
    const legacyProfiles = await app.inject({
      method: 'GET',
      url: '/api/v1/profiles/agency-context',
      headers: { cookie },
    });
    expect(legacyProfiles.statusCode).toBe(404);
    const legacyModels = await app.inject({
      method: 'GET',
      url: '/api/v1/models/legacy-context',
      headers: { cookie },
    });
    expect(legacyModels.statusCode).toBe(404);
    await app.close();
  });

  it('enforces federation routes with session auth, CSRF, RBAC, and native worker-only execution', async () => {
    const store = fixtureStore();
    const admin = store.principals.get('admin')!;
    store.principals.set('admin', { ...admin, permissions: [...admin.permissions, 'work.manage'] });
    const records = new Map<string, unknown>();
    const now = new Date('2026-08-24T00:00:00.000Z');
    const federationLeaseStore = {
      async ready() {
        return true;
      },
      async claim(input: Record<string, unknown>) {
        if (records.has('lease')) return { kind: 'replayed', lease: records.get('lease') };
        const lease = {
          id: 'lease-route-1',
          sourceFrameworkId: input.sourceFrameworkId,
          sourceBoardId: input.sourceBoardId,
          sourceTaskId: input.sourceTaskId,
          workerFrameworkId: input.workerFrameworkId,
          workerBoardId: input.workerBoardId,
          workerProfileId: input.workerProfileId,
          workerTaskId: null,
          status: 'pending',
          stage: 'pending',
          attempt: 1,
          leaseExpiresAt: now,
          heartbeatAt: now,
          requestHash: input.requestHash,
          result: null,
          error: null,
          createdBy: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        };
        records.set('lease', lease);
        return { kind: 'created', lease };
      },
      async advance(
        _id: string,
        stage: string,
        status: string,
        patch: Record<string, unknown> = {},
      ) {
        const lease = {
          ...(records.get('lease') as Record<string, unknown>),
          stage,
          status,
          ...patch,
        };
        records.set('lease', lease);
        return lease;
      },
      async get() {
        return records.get('lease') ?? null;
      },
      async list() {
        return records.has('lease') ? [records.get('lease')] : [];
      },
    };
    const work = vi.fn(async (...args: unknown[]) => {
      const operation = String(args[1]);
      return {
        data: {
          status: 'completed',
          operation,
          result: { taskRun: { profileId: 'reviewer', result: 'native worker result' } },
        },
      };
    });
    const app = buildApp({
      authStore: store,
      authPepper: pepper,
      secureCookies: false,
      hermesGateway: { work, ready: async () => true } as never,
      federationLeaseStore: federationLeaseStore as never,
    });
    const payload = {
      sourceFrameworkId: 'hermes-alica',
      sourceBoardId: 'alica',
      sourceTaskId: 'ALICA-1',
      sourceSourceVersion: 'tasks:v1',
      workerFrameworkId: 'hermes-herman',
      workerProfileId: 'reviewer',
      prompt: 'Run this natively',
      workerTimeoutSeconds: 60,
    };

    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/federation/leases', payload })).statusCode,
    ).toBe(401);

    const viewer = await login(app, 'viewer');
    const viewerCookie = `aquiero_session=${viewer.session}; aquiero_csrf=${viewer.csrf}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/federation/leases',
          headers: { cookie: viewerCookie, 'idempotency-key': 'route-key' },
          payload,
        })
      ).statusCode,
    ).toBe(403);

    const adminLogin = await login(app, 'admin');
    const adminCookie = `aquiero_session=${adminLogin.session}; aquiero_csrf=${adminLogin.csrf}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/federation/leases',
          headers: { cookie: adminCookie, 'idempotency-key': 'route-key' },
          payload,
        })
      ).statusCode,
    ).toBe(403);

    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/federation/leases',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminLogin.csrf,
        'idempotency-key': 'route-key-forged',
      },
      payload: { ...payload, result: 'forged result' },
    });
    expect(forged.statusCode).toBe(400);
    expect(work).not.toHaveBeenCalled();

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/federation/leases',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminLogin.csrf,
        'idempotency-key': 'route-key',
      },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(work.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['hermes-alica', 'task.start', 'ALICA-1'],
      ['hermes-herman', 'task.run', 'reviewer'],
      ['hermes-alica', 'task.complete', 'ALICA-1'],
    ]);
    expect(work.mock.calls.map((call) => call[1])).not.toContain('task.create');
    await app.close();
  });

  it('stores only hashes of session and CSRF tokens', async () => {
    const store = fixtureStore();
    const app = buildApp({ authStore: store, authPepper: pepper, secureCookies: false });
    const result = await login(app);
    const stored = [...store.sessions.values()][0];
    expect(stored?.tokenHash).toBe(sha256(result.session));
    expect(stored?.csrfHash).toBe(sha256(result.csrf));
    expect(stored?.tokenHash).not.toBe(result.session);
    await app.close();
  });
});
