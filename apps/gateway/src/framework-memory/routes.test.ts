import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type {
  AuthStore,
  LoginThrottle,
  SessionRecord,
  SessionSummary,
  UserRecord,
} from '../auth/types.js';
import {
  FrameworkRegistryError,
  type FrameworkRegistryService,
} from '../framework-registry/service.js';
import { MemoryV4Adapter } from '../memory-v4/client.js';
import { MEMORY_V4_CONTRACT_VERSION } from '../memory-v4/types.js';
import type { AuditInput, GovernanceStore, OperationRecord } from '../governance/types.js';

class AuditGovernanceStore implements GovernanceStore {
  readonly audits: AuditInput[] = [];
  async ready() {
    return true;
  }
  async claimOperation(): Promise<never> {
    throw new Error('unused');
  }
  async getOperation(): Promise<OperationRecord | null> {
    return null;
  }
  async listOperations(): Promise<OperationRecord[]> {
    return [];
  }
  async listAudit() {
    return [];
  }
  async transition(): Promise<OperationRecord | null> {
    return null;
  }
  async addEvidence() {
    return 'unused';
  }
  async appendAudit(input: AuditInput) {
    this.audits.push(input);
    return `audit-${this.audits.length}`;
  }
}

class UnusedAuthStore implements AuthStore {
  async ready() {
    return true;
  }
  async findUserByUsername(): Promise<UserRecord | null> {
    return null;
  }
  async getPrincipal() {
    return null;
  }
  async getLoginThrottle(): Promise<LoginThrottle | null> {
    return null;
  }
  async recordLoginFailure() {}
  async clearLoginFailures() {}
  async createSession() {
    return 'unused';
  }
  async findActiveSession(): Promise<SessionRecord | null> {
    return null;
  }
  async listSessions(): Promise<SessionSummary[]> {
    return [];
  }
  async revokeSession() {
    return false;
  }
  async touchSession() {}
}

const token = 'framework-token-with-adequate-length';
const upstream = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-memoryv4-contract-version': MEMORY_V4_CONTRACT_VERSION,
      'idempotency-replayed': 'false',
    },
  });

function registry(write = true): FrameworkRegistryService {
  return {
    async ready() {
      return true;
    },
    async authenticateBearer(value: string | undefined, scope: 'memory:read' | 'memory:write') {
      if (value !== token)
        throw new FrameworkRegistryError(
          'FRAMEWORK_AUTH_INVALID',
          401,
          'Framework service authentication is invalid',
        );
      if (scope === 'memory:write' && !write)
        throw new FrameworkRegistryError(
          'FRAMEWORK_SCOPE_DENIED',
          403,
          'Framework registration does not grant the required scope',
        );
      return {
        frameworkId: 'hermes-alica',
        scopes: ['memory:read', ...(write ? (['memory:write'] as const) : [])],
      };
    },
  } as FrameworkRegistryService;
}

function fixture(fetchImpl: typeof fetch, write = true, governanceStore?: GovernanceStore) {
  return buildApp({
    authStore: new UnusedAuthStore(),
    authPepper: 'test-pepper',
    secureCookies: false,
    frameworkRegistry: registry(write),
    ...(governanceStore ? { governanceStore } : {}),
    memoryV4Adapter: new MemoryV4Adapter({
      baseUrl: 'https://memory.invalid',
      bearerToken: 'memory-adapter-token',
      scopePath: 'org:aquiero',
      retries: 0,
      fetchImpl,
    }),
  });
}

const authorization = { authorization: `Bearer ${token}` };

describe('framework-facing governed memory tools', () => {
  it('fails closed without a valid registered framework bearer', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const app = fixture(fetchImpl);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/framework-tools/memory/search',
      payload: { q: 'release' },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('FRAMEWORK_AUTH_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('searches through the Gateway with injected scope and delegated framework identity', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-memoryv4-actor')).toBe('unify:framework:hermes-alica');
      expect(headers.get('authorization')).toBe('Bearer memory-adapter-token');
      return upstream({ results: [], next_cursor: null });
    });
    const app = fixture(fetchImpl);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/framework-tools/memory/search',
      headers: authorization,
      payload: { q: 'release', limit: 10 },
    });
    expect(response.statusCode).toBe(200);
    const called = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(called.pathname).toBe('/search');
    expect(called.searchParams.get('scope_path')).toBe('org:aquiero');
    expect(called.searchParams.get('q')).toBe('release');
    await app.close();
  });

  it('forces framework-created records into author-only active working governance', async () => {
    const auditStore = new AuditGovernanceStore();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        role: 'active',
        lifecycle: 'working',
        write_policy: 'author_only',
        provenance: {
          source: 'unify-framework-tool',
          framework_id: 'hermes-alica',
        },
      });
      expect(new Headers(init?.headers).get('idempotency-key')).toBe('framework-operation-0001');
      return upstream({ id: 'rec_1', version: 1 }, 201);
    });
    const app = fixture(fetchImpl, true, auditStore);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/framework-tools/memory/remember',
      headers: { ...authorization, 'idempotency-key': 'framework-operation-0001' },
      payload: { title: 'Observed fact', content: 'Framework evidence' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('false');
    expect(auditStore.audits).toHaveLength(1);
    expect(auditStore.audits[0]).toMatchObject({
      action: 'framework.memory.remember',
      outcome: 'success',
      target: { frameworkId: 'hermes-alica', resource: 'memory' },
      details: {
        authentication: 'framework-service',
        requiredScope: 'memory:write',
        upstreamStatus: 201,
      },
    });
    expect(JSON.stringify(auditStore.audits[0])).not.toContain('Framework evidence');
    expect(JSON.stringify(auditStore.audits[0])).not.toContain('memory-adapter-token');
    await app.close();
  });

  it('requires write scope, idempotency, and optimistic concurrency for updates', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('if-match')).toBe('3');
      expect(headers.get('idempotency-key')).toBe('framework-update-0001');
      return upstream({ id: 'rec_1', version: 4 });
    });
    const deniedApp = fixture(fetchImpl, false);
    const denied = await deniedApp.inject({
      method: 'POST',
      url: '/api/v1/framework-tools/memory/update',
      headers: { ...authorization, 'idempotency-key': 'framework-update-0001' },
      payload: { record_id: 'rec_1', expected_version: 3, patch: { content: 'new' } },
    });
    expect(denied.statusCode).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    await deniedApp.close();

    const app = fixture(fetchImpl);
    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/framework-tools/memory/update',
      headers: authorization,
      payload: { record_id: 'rec_1', expected_version: 3, patch: { content: 'new' } },
    });
    expect(missingKey.statusCode).toBe(428);
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/framework-tools/memory/update',
      headers: { ...authorization, 'idempotency-key': 'framework-update-0001' },
      payload: { record_id: 'rec_1', expected_version: 3, patch: { content: 'new' } },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('does not expose promote, supersede, transition, or arbitrary proxy endpoints', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const app = fixture(fetchImpl);
    for (const path of ['promote', 'supersede', 'transition', 'proxy']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/framework-tools/memory/${path}`,
        headers: authorization,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });
});
