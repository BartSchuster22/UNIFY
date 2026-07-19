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
      warnings: [],
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

const pepper = 'integration-route-test-pepper';
let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hashPassword('correct-horse-battery', pepper);
});

async function authenticated(permissions: string[], governanceStore?: GovernanceStore) {
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
    integrations: new IntegrationService([new AgencyAdapter()]),
    ...(governanceStore ? { governanceStore } : {}),
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'reader', password: 'correct-horse-battery' },
  });
  const cookies = login.headers['set-cookie'];
  const cookie = (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((item) => item.split(';', 1)[0])
    .join('; ');
  return { app, cookie };
}

describe('read-only integration routes', () => {
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
  });

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
