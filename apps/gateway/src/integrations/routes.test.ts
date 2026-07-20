import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/crypto.js';
import type {
  AuthStore,
  LoginThrottle,
  NewSession,
  PrincipalRecord,
  SessionRecord,
  SessionSummary,
  UserRecord,
} from '../auth/types.js';
import { IntegrationService } from './service.js';
import type { IntegrationSnapshot, SourceAdapter } from './types.js';
import type { GovernanceStore } from '../governance/types.js';
import { MutationOwnerClient } from '../mutations/owner-client.js';
import type { NotificationDraft, NotificationStore } from '../notifications/postgres-store.js';
import { CutoverPolicy } from '../cutover/policy.js';

class Notifications implements NotificationStore {
  state: NotificationDraft['state'] = 'unread';
  async ready() {
    return true;
  }
  async sync(_userId: string, notifications: NotificationDraft[]) {
    return new Map(notifications.map((item) => [item.id, this.state]));
  }
  async acknowledge(_userId: string, _notificationId: string, allowedOwners: string[]) {
    if (!allowedOwners.includes('agency')) return null;
    this.state = 'acknowledged';
    return 'agency';
  }
}

class Store implements AuthStore {
  user!: UserRecord;
  principal!: PrincipalRecord;
  session?: NewSession & { id: string; createdAt: Date; lastSeenAt: Date; revokedAt: Date | null };
  async ready() {
    return true;
  }
  async findUserByUsername(username: string) {
    return username === this.user.username ? this.user : null;
  }
  async getPrincipal(userId: string) {
    return userId === this.principal.userId ? this.principal : null;
  }
  async getLoginThrottle(): Promise<LoginThrottle | null> {
    return null;
  }
  async recordLoginFailure() {}
  async clearLoginFailures() {}
  async createSession(value: NewSession) {
    const now = new Date();
    this.session = { ...value, id: 's1', createdAt: now, lastSeenAt: now, revokedAt: null };
    return 's1';
  }
  async findActiveSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    if (!this.session || this.session.tokenHash !== tokenHash || this.session.expiresAt <= now)
      return null;
    return {
      ...this.principal,
      sessionId: 's1',
      csrfHash: this.session.csrfHash,
      expiresAt: this.session.expiresAt,
    };
  }
  async listSessions(): Promise<SessionSummary[]> {
    return [];
  }
  async revokeSession() {
    return false;
  }
  async touchSession() {}
}

class AgencyAdapter implements SourceAdapter {
  readonly id = 'agency-test';
  readonly owners: Array<'agency'> = ['agency'];
  async snapshot(): Promise<IntegrationSnapshot> {
    const at = new Date().toISOString();
    return {
      adapterId: this.id,
      owners: this.owners,
      status: 'current',
      observedAt: at,
      warnings: [{ code: 'AGENCY_ATTENTION', message: 'Agency needs attention' }],
      resources: [
        {
          resource: {
            canonicalId: 'agency:framework:aA',
            kind: 'framework',
            owner: 'agency',
            nativeId: 'h',
            observedAt: at,
          },
          truth: 'current',
          authoritative: true,
          adapterId: this.id,
          fetchedAt: at,
          title: 'Hermes',
          searchableText: 'Hermes framework',
          data: { id: 'h' },
        },
        {
          resource: {
            canonicalId: 'agency:framework:aQ',
            kind: 'framework',
            owner: 'agency',
            nativeId: 'i',
            observedAt: at,
          },
          truth: 'current',
          authoritative: true,
          adapterId: this.id,
          fetchedAt: at,
          title: 'Isolated',
          searchableText: 'Isolated framework',
          data: { id: 'i' },
        },
      ],
    };
  }
}

class LargeAgencyAdapter implements SourceAdapter {
  readonly id = 'agency-large-fixture';
  readonly owners: Array<'agency'> = ['agency'];
  async snapshot(): Promise<IntegrationSnapshot> {
    const at = new Date().toISOString();
    return {
      adapterId: this.id,
      owners: this.owners,
      status: 'current',
      observedAt: at,
      warnings: [],
      resources: Array.from({ length: 10_000 }, (_, index) => ({
        resource: {
          canonicalId: `agency:framework:${String(index).padStart(5, '0')}`,
          kind: 'framework',
          owner: 'agency' as const,
          nativeId: String(index),
          observedAt: at,
        },
        truth: 'current' as const,
        authoritative: true,
        adapterId: this.id,
        fetchedAt: at,
        title: `Framework ${index}`,
        searchableText: `Framework fixture ${index}`,
        data: { id: index },
      })),
    };
  }
}

const pepper = 'integration-route-test-pepper';
let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hashPassword('correct-horse-battery', pepper);
});

async function authenticated(
  permissions: string[],
  governanceStore?: GovernanceStore,
  mutationOwners?: MutationOwnerClient,
  notificationStore?: NotificationStore,
  cutoverPolicy = CutoverPolicy.fromEnv({
    DEPLOYMENT_MODE: 'mutation-canary',
    MUTATION_DOMAINS: 'profiles,dmm,worker,chat,memory-v4',
    MUTATION_ACCEPTANCE_REFS:
      'profiles=test/PROFILES,dmm=test/DMM,worker=test/WORKER,chat=test/CHAT,memory-v4=test/MEMORY',
  }),
  adapter: SourceAdapter = new AgencyAdapter(),
) {
  const store = new Store();
  store.user = {
    id: 'u1',
    username: 'reader',
    displayName: 'Reader',
    passwordHash,
    status: 'active',
  };
  store.principal = {
    userId: 'u1',
    username: 'reader',
    displayName: 'Reader',
    roles: ['Viewer'],
    permissions,
  };
  const app = buildApp({
    authStore: store,
    authPepper: pepper,
    secureCookies: false,
    integrations: new IntegrationService([adapter]),
    ...(governanceStore ? { governanceStore } : {}),
    ...(mutationOwners ? { mutationOwners } : {}),
    ...(notificationStore ? { notificationStore } : {}),
    cutoverPolicy,
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'reader', password: 'correct-horse-battery' },
  });
  const csrf = String(login.headers['x-csrf-token'] ?? '');
  const sessionToken = login.cookies.find((item) => item.name === 'aquiero_session')?.value ?? '';
  const cookie = `aquiero_session=${sessionToken}; aquiero_csrf=${csrf}`;
  return { app, cookie, csrf };
}

function mutationFixture(): { governance: GovernanceStore; owners: MutationOwnerClient } {
  const unused = async (): Promise<never> => {
    throw new Error('mutation execution must not be reached');
  };
  const governance: GovernanceStore = {
    ready: async () => true,
    claimOperation: unused,
    getOperation: async () => null,
    listOperations: async () => [],
    listAudit: async () => [],
    transition: unused,
    addEvidence: unused,
    appendAudit: async () => 'audit-login',
  };
  const owners = new MutationOwnerClient({
    agencyUrl: 'http://agency.invalid',
    agencyUsername: 'u',
    agencyPassword: 'p',
    dmmUrl: 'http://dmm.invalid',
    dmmUsername: 'u',
    dmmPassword: 'p',
    workerUrl: 'http://worker.invalid',
    workerToken: 'token',
    chatUrl: 'http://chat.invalid',
    chatPassword: 'p',
    memoryUrl: 'http://memory.invalid',
    memoryToken: 'token',
  });
  return { governance, owners };
}

describe('read-only integration routes', () => {
  it('enforces mutation CSRF before operation-specific RBAC', async () => {
    const fixture = mutationFixture();
    const { app, cookie, csrf } = await authenticated([], fixture.governance, fixture.owners);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/chat/download?path=/uploads/file.txt' }))
        .statusCode,
    ).toBe(401);
    const request = {
      method: 'POST' as const,
      url: '/api/v1/mutations',
      headers: { cookie, 'idempotency-key': 'route-policy-test' },
      payload: {
        operationType: 'dmm.credential.validate',
        target: { owner: 'dmm', kind: 'provider', nativeId: 'missing' },
        payload: {},
        mode: 'validate',
        confirmed: false,
      },
    };
    expect(csrf).not.toBe('');
    const csrfRejected = await app.inject(request);
    expect(csrfRejected.statusCode).toBe(403);
    expect(csrfRejected.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    const rbacRejected = await app.inject({
      ...request,
      headers: { ...request.headers, 'x-csrf-token': csrf },
    });
    expect(rbacRejected.statusCode).toBe(403);
    expect(rbacRejected.json()).toMatchObject({ error: { code: 'AUTH_FORBIDDEN' } });
    await app.close();
  });

  it('enforces fail-closed read-only rollout and reports per-domain cutover state', async () => {
    const fixture = mutationFixture();
    const readOnly = CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'read-only' });
    const { app, cookie, csrf } = await authenticated(
      ['chat.use', 'audit.read'],
      fixture.governance,
      fixture.owners,
      undefined,
      readOnly,
    );
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/cutover/status',
      headers: { cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      mode: 'read-only',
      legacyServicesRetained: true,
      domains: expect.arrayContaining([
        expect.objectContaining({ domain: 'chat', executeEnabled: false }),
      ]),
    });
    const execution = await app.inject({
      method: 'POST',
      url: '/api/v1/mutations',
      headers: {
        cookie,
        'x-csrf-token': csrf,
        'idempotency-key': 'read-only-rejection',
      },
      payload: {
        operationType: 'chat.message.send',
        target: { owner: 'chat', kind: 'chat-session', nativeId: 'session-1' },
        payload: { blocks: [{ type: 'text', text: 'must not execute' }] },
        mode: 'execute',
        confirmed: false,
      },
    });
    expect(execution.statusCode).toBe(403);
    expect(execution.json()).toMatchObject({ error: { code: 'DEPLOYMENT_READ_ONLY' } });
    await app.close();
  });

  it('returns provenance-rich resources and unified search to an authorized named user', async () => {
    const { app, cookie } = await authenticated(['frameworks.read']);
    const resources = await app.inject({
      method: 'GET',
      url: '/api/v1/resources?owner=agency&refresh=true&limit=1',
      headers: { cookie },
    });
    expect(resources.statusCode).toBe(200);
    expect(resources.json()).toMatchObject({
      items: [{ authoritative: true, resource: { owner: 'agency', kind: 'framework' } }],
      meta: { freshness: 'current', page: { hasMore: true } },
    });
    const cursor = resources.json().meta.page.nextCursor as string;
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/resources?owner=agency&limit=1&cursor=${encodeURIComponent(cursor)}`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      items: [{ title: 'Isolated' }],
      meta: { page: { hasMore: false } },
    });
    const search = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=Hermes',
      headers: { cookie },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(1);
    await app.close();
  }, 30_000);

  it('bounds a 10,000-resource owner snapshot at the API pagination boundary', async () => {
    const { app, cookie } = await authenticated(
      ['frameworks.read'],
      undefined,
      undefined,
      undefined,
      undefined,
      new LargeAgencyAdapter(),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/resources?owner=agency&refresh=true&limit=500',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(500);
    expect(response.json().meta.page).toMatchObject({ hasMore: true });
    expect(response.payload.length).toBeLessThan(1_000_000);
    await app.close();
  }, 30_000);

  it('enforces owner-specific RBAC and shadow-comparison permission', async () => {
    const { app, cookie } = await authenticated(['frameworks.read']);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/resources?owner=dmm', headers: { cookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/shadow', headers: { cookie } })).statusCode,
    ).toBe(403);
    await app.close();
  });

  it('persists notification acknowledgement behind CSRF and owner RBAC', async () => {
    const notifications = new Notifications();
    const { app, cookie, csrf } = await authenticated(
      ['frameworks.read'],
      undefined,
      undefined,
      notifications,
    );
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie },
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json()).toMatchObject({
      items: [{ source: 'agency', state: 'unread', deepLink: '/?view=notifications' }],
    });
    const id = String(inbox.json().items[0].id);
    const url = `/api/v1/notifications/${encodeURIComponent(id)}/acknowledge`;
    expect((await app.inject({ method: 'POST', url, headers: { cookie } })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie, 'x-csrf-token': csrf },
        })
      ).statusCode,
    ).toBe(204);
    const refreshed = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie },
    });
    expect(refreshed.json()).toMatchObject({ items: [{ state: 'acknowledged' }] });
    await app.close();
  });

  it('lists operation and audit history for authorized UNIUI views', async () => {
    const now = new Date('2026-07-19T12:00:00.000Z');
    const governanceStore: GovernanceStore = {
      ready: async () => true,
      claimOperation: async () => {
        throw new Error('not used');
      },
      getOperation: async () => null,
      listOperations: async () => [
        {
          id: 'op-1',
          actorUserId: 'u1',
          action: 'framework.inspect',
          targetFramework: 'agency',
          targetKind: 'framework',
          targetId: 'h',
          state: 'verified',
          mode: 'verify',
          policyDecision: 'allowed',
          sourceVersion: null,
          requestHash: 'a'.repeat(64),
          idempotencyKey: 'op-key',
          result: null,
          error: null,
          evidenceIds: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      listAudit: async () => [
        {
          id: 'audit-1',
          eventType: 'auth.login',
          actorId: 'u1',
          outcome: 'success',
          requestId: 'r1',
          correlationId: 'r1',
          operationId: null,
          frameworkId: null,
          resource: null,
          safeMetadata: {},
          previousEventHash: null,
          eventHash: 'b'.repeat(64),
          occurredAt: now,
        },
      ],
      transition: async () => null,
      addEvidence: async () => 'e1',
      appendAudit: async () => 'a1',
    };
    const { app, cookie } = await authenticated(['operations.read', 'audit.read'], governanceStore);
    const operations = await app.inject({
      method: 'GET',
      url: '/api/v1/operations',
      headers: { cookie },
    });
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { cookie },
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toMatchObject({
      items: [{ operationId: 'op-1', state: 'verified' }],
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toMatchObject({
      items: [{ id: 'audit-1', eventType: 'auth.login' }],
    });
    await app.close();
  });
});
