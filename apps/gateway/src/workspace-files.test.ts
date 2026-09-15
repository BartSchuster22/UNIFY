import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { sha256 } from './auth/crypto.js';
import type {
  AuthStore,
  LoginThrottle,
  SessionRecord,
  SessionSummary,
  UserRecord,
} from './auth/types.js';
import { MemoryV4Adapter } from './memory-v4/client.js';
import { MEMORY_V4_CONTRACT_VERSION } from './memory-v4/types.js';

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

import type { GovernanceStore } from './governance/types.js';
import type { HermesGatewayService } from './hermes-control/service.js';
const headers = {
  cookie: `aquiero_session=${sessionToken}; aquiero_csrf=${csrfToken}`,
  'x-csrf-token': csrfToken,
};
const url = '/api/v1/frameworks/hermes-test/work/files';
function fixture(permissions = ['work.read', 'work.manage', 'memory.write']) {
  const workspaceFiles = vi.fn(async (_f: string, input: Record<string, unknown>) =>
    input.action === 'read'
      ? {
          directory: '/workspace/project',
          name: 'notes.txt',
          text: 'explicit test document',
          sha256: 'file-sha',
          version: 'file-version',
        }
      : { directory: '/workspace', saved: true },
  );
  const projects = vi.fn(async () => ({
    items: [{ id: 'project', defaultWorkspacePath: '/workspace/project' }],
  }));
  const audit = vi.fn(async () => 'audit-id');
  const upstream = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ id: 'memory-record' }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'x-memoryv4-contract-version': MEMORY_V4_CONTRACT_VERSION,
        },
      }),
  );
  const app = buildApp({
    authStore: new FixedAuthStore(permissions),
    authPepper: 'test-pepper',
    secureCookies: false,
    governanceStore: { appendAudit: audit } as unknown as GovernanceStore,
    hermesGateway: { workspaceFiles, projects } as unknown as HermesGatewayService,
    memoryV4Adapter: new MemoryV4Adapter({
      baseUrl: 'https://memory.invalid',
      bearerToken: 'fixture-token',
      scopePath: 'tenant:acme',
      retries: 0,
      fetchImpl: upstream,
    }),
  });
  return { app, workspaceFiles, projects, audit, upstream };
}
describe('governed workspace file API', () => {
  it('requires a session, CSRF and work.manage for writes', async () => {
    const f = fixture(['work.read']);
    const payload = { action: 'mkdir', directory: '/workspace', name: 'new', confirmed: true };
    expect((await f.app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect(
      (await f.app.inject({ method: 'POST', url, headers: { cookie: headers.cookie }, payload }))
        .statusCode,
    ).toBe(403);
    expect((await f.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(403);
    expect(f.workspaceFiles).not.toHaveBeenCalled();
    await f.app.close();
  });
  it('requires explicit confirmation and audits metadata without file contents', async () => {
    const f = fixture();
    const payload = {
      action: 'upload',
      directory: '/workspace',
      name: 'notes.txt',
      contentBase64: 'SECRET_FIXTURE_BYTES',
      actorUserId: 'forged',
    };
    expect((await f.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(428);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, confirmed: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(f.workspaceFiles).toHaveBeenCalledWith(
      'hermes-test',
      expect.objectContaining({ actorUserId: 'user-7' }),
    );
    expect(f.audit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain('SECRET_FIXTURE_BYTES');
    expect(f.upstream).not.toHaveBeenCalled();
    await f.app.close();
  });
  it('fails closed when write admission cannot be audited', async () => {
    const f = fixture();
    f.audit.mockRejectedValue(new Error('offline'));
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { action: 'mkdir', directory: '/workspace', name: 'new', confirmed: true },
        })
      ).statusCode,
    ).toBe(500);
    expect(f.workspaceFiles).not.toHaveBeenCalled();
    await f.app.close();
  });
  it('lets readers list without allowing arbitrary read-content or other actions', async () => {
    const f = fixture(['work.read']);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { action: 'list', directory: '/workspace' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers,
          payload: { action: 'read', directory: '/workspace' },
        })
      ).statusCode,
    ).toBe(400);
    expect(f.upstream).not.toHaveBeenCalled();
    await f.app.close();
  });
  it('imports only explicitly confirmed saved-project text, with source provenance and deterministic idempotency', async () => {
    const f = fixture();
    const payload = {
      directory: '/workspace/project',
      name: 'notes.txt',
      projectId: 'project',
      expectedVersion: 'file-version',
      confirmed: true,
    };
    const response = await f.app.inject({ method: 'POST', url: url + '/memory', headers, payload });
    expect(response.statusCode, response.body).toBe(201);
    await f.app.inject({ method: 'POST', url: url + '/memory', headers, payload });
    const init = f.upstream.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      scope_path: 'tenant:acme/framework:hermes-test/project:project',
      role: 'evidence',
      lifecycle: 'working',
      write_policy: 'author_only',
      content: 'explicit test document',
      provenance: { source_sha256: 'file-sha' },
    });
    expect(new Headers(init.headers).get('idempotency-key')).toBe(
      new Headers(f.upstream.mock.calls[1]![1]!.headers).get('idempotency-key'),
    );
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain('explicit test document');
    await f.app.close();
  });
  it('rejects memory import outside the saved project workspace', async () => {
    const f = fixture();
    const payload = {
      directory: '/workspace/project-other',
      name: 'notes.txt',
      projectId: 'project',
      expectedVersion: 'file-version',
      confirmed: true,
    };
    expect(
      (await f.app.inject({ method: 'POST', url: url + '/memory', headers, payload })).statusCode,
    ).toBe(403);
    expect(f.workspaceFiles).not.toHaveBeenCalled();
    expect(f.upstream).not.toHaveBeenCalled();
    await f.app.close();
  });
  it('requires separate memory permission and confirmation', async () => {
    const f = fixture(['work.read', 'work.manage']);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: url + '/memory',
          headers,
          payload: { confirmed: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(f.upstream).not.toHaveBeenCalled();
    await f.app.close();
    const allowed = fixture();
    expect(
      (
        await allowed.app.inject({
          method: 'POST',
          url: url + '/memory',
          headers,
          payload: { projectId: 'project' },
        })
      ).statusCode,
    ).toBe(400);
    expect(allowed.upstream).not.toHaveBeenCalled();
    await allowed.app.close();
  });
});
