import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { sha256 } from '../auth/crypto.js';
import type {
  AuthStore,
  LoginThrottle,
  SessionRecord,
  SessionSummary,
  UserRecord,
} from '../auth/types.js';
import { MemoryV4Adapter } from './client.js';
import { MEMORY_V4_CONTRACT_VERSION } from './types.js';

const sessionToken = 'opaque-session';
const csrfToken = 'opaque-csrf';

class FixedAuthStore implements AuthStore {
  constructor(private readonly permissions: string[]) {}
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
  async findActiveSession(tokenHash: string): Promise<SessionRecord | null> {
    return tokenHash === sha256(sessionToken)
      ? {
          userId: 'user-7',
          username: 'operator',
          displayName: 'Operator',
          roles: ['Operator'],
          permissions: this.permissions,
          sessionId: 'session-7',
          csrfHash: sha256(csrfToken),
          expiresAt: new Date(Date.now() + 60_000),
        }
      : null;
  }
  async listSessions(): Promise<SessionSummary[]> {
    return [];
  }
  async revokeSession() {
    return false;
  }
  async touchSession() {}
}

const upstream = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-memoryv4-contract-version': MEMORY_V4_CONTRACT_VERSION,
      'idempotency-replayed': 'false',
    },
  });

function fixture(permissions: string[], fetchImpl: typeof fetch) {
  return buildApp({
    authStore: new FixedAuthStore(permissions),
    authPepper: 'test-pepper',
    secureCookies: false,
    memoryV4Adapter: new MemoryV4Adapter({
      baseUrl: 'https://memory.invalid',
      bearerToken: 'adapter-token',
      scopePath: 'tenant:acme',
      retries: 0,
      fetchImpl,
    }),
  });
}

const cookie = `aquiero_session=${sessionToken}; aquiero_csrf=${csrfToken}`;

describe('UNIFY MemoryV4 gateway routes', () => {
  it('requires a named session and exact read permission', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => upstream({ records: [] }));
    const app = fixture(['memory.read'], fetchImpl);
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/memory/records' });
    expect(anonymous.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/memory/records?limit=5',
      headers: { cookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['x-memoryv4-contract-version']).toBe(MEMORY_V4_CONTRACT_VERSION);
    const calledUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get('scope_path')).toBe('tenant:acme');
    await app.close();

    const deniedApp = fixture([], fetchImpl);
    const denied = await deniedApp.inject({
      method: 'GET',
      url: '/api/v1/memory/records',
      headers: { cookie },
    });
    expect(denied.statusCode).toBe(403);
    await deniedApp.close();
  });

  it('enforces CSRF, mutation RBAC, idempotency, and delegated actor identity', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-memoryv4-actor')).toBe('unify:user-7');
      expect(headers.get('idempotency-key')).toBe('create-record-7');
      expect(headers.get('authorization')).toBe('Bearer adapter-token');
      return upstream({ id: 'record-7' }, 201);
    });
    const app = fixture(['memory.read', 'memory.write'], fetchImpl);
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/records',
      headers: { cookie, 'idempotency-key': 'create-record-7' },
      payload: { role: 'working', title: 'Adapter test', body: 'governed' },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/records',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { role: 'working', title: 'Adapter test', body: 'governed' },
    });
    expect(missingKey.statusCode).toBe(428);
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/records',
      headers: {
        cookie,
        'x-csrf-token': csrfToken,
        'idempotency-key': 'create-record-7',
      },
      payload: { role: 'working', title: 'Adapter test', body: 'governed' },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.headers['idempotency-replayed']).toBe('false');
    expect(fetchImpl).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects request bodies above the bounded MemoryV4 adapter envelope', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => upstream({ id: 'should-not-run' }, 201));
    const app = fixture(['memory.write'], fetchImpl);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/records',
      headers: {
        cookie,
        'x-csrf-token': csrfToken,
        'idempotency-key': 'oversized-record',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ content: 'x'.repeat(6 * 1024 * 1024 + 1) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the permitted size',
        requestId: expect.any(String),
        retryable: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not expose arbitrary MemoryV4 or administrative paths', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => upstream({}));
    const app = fixture(['memory.read', 'memory.admin'], fetchImpl);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/memory/records/record-1',
      headers: { cookie, 'x-csrf-token': csrfToken, 'idempotency-key': 'delete-1' },
    });
    expect(response.statusCode).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });
});
