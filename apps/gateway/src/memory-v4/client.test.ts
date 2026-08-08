import { describe, expect, it, vi } from 'vitest';
import { MemoryV4Adapter, MemoryV4AdapterError } from './client.js';
import { MEMORY_V4_CONTRACT_VERSION, memoryRoute, validateScopePath } from './types.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-memoryv4-contract-version': MEMORY_V4_CONTRACT_VERSION,
      ...headers,
    },
  });

function adapter(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof MemoryV4Adapter>[0]> = {},
) {
  return new MemoryV4Adapter({
    baseUrl: 'https://memory.invalid',
    bearerToken: 'service-token',
    scopePath: 'tenant:acme',
    retries: 0,
    fetchImpl,
    ...overrides,
  });
}

function route(method: string, path: string) {
  const value = memoryRoute(method, path);
  if (!value) throw new Error('test route missing');
  return value;
}

describe('MemoryV4 adapter contract', () => {
  it('exposes only the locked endpoint and permission matrix', () => {
    expect(memoryRoute('GET', '/records/rec-1')).toMatchObject({ permission: 'memory.read' });
    expect(memoryRoute('POST', '/records/rec-1/promote')).toMatchObject({
      permission: 'memory.promote',
    });
    expect(memoryRoute('POST', '/records/rec-1/transition')).toMatchObject({
      permission: 'memory.admin',
    });
    expect(memoryRoute('GET', '/audit/events')).toMatchObject({ permission: 'audit.read' });
    expect(memoryRoute('DELETE', '/records/rec-1')).toBeNull();
    expect(memoryRoute('GET', '/../openapi.json')).toBeNull();
    expect(memoryRoute('POST', '/unknown')).toBeNull();
    expect(() => validateScopePath('tenant:acme/project:\u0007bad')).toThrow(/invalid/);
    expect(
      () =>
        new MemoryV4Adapter({
          baseUrl: 'http://memory.internal',
          bearerToken: 'service-token',
          scopePath: 'tenant:acme',
        }),
    ).toThrow(/requires HTTPS/);
  });

  it('delegates the named actor, pins scope, and never forwards caller credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/records');
      expect(url.searchParams.get('scope_path')).toBe('tenant:acme');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer service-token');
      expect(headers.get('x-memoryv4-actor')).toBe('unify:user-1');
      expect(headers.get('x-request-id')).toBe('request-1');
      return json({ records: [], next_cursor: null });
    });
    const result = await adapter(fetchImpl).execute({
      method: 'GET',
      path: '/records',
      route: route('GET', '/records'),
      actorUserId: 'user-1',
      requestId: 'request-1',
      query: { limit: 25 },
    });
    expect(result.body).toEqual({ records: [], next_cursor: null });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('injects governed mutation scope and preserves concurrency and replay evidence', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        scope_path: 'tenant:acme',
        role: 'working',
      });
      const headers = new Headers(init?.headers);
      expect(headers.get('idempotency-key')).toBe('idem-0001');
      expect(headers.get('if-match')).toBe('"3"');
      expect(headers.get('x-memoryv4-reason')).toBe('operator approved');
      return json({ id: 'rec-1' }, 201, { 'idempotency-replayed': 'false' });
    });
    const result = await adapter(fetchImpl).execute({
      method: 'POST',
      path: '/records',
      route: route('POST', '/records'),
      actorUserId: 'user-1',
      requestId: 'request-2',
      body: { role: 'working' },
      idempotencyKey: 'idem-0001',
      ifMatch: '"3"',
      reason: 'operator approved',
    });
    expect(result).toMatchObject({ statusCode: 201, idempotencyReplayed: 'false' });
  });

  it('fails closed on scope escape, missing idempotency, and contract drift', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'x-memoryv4-contract-version': '2.0.0',
          },
        }),
    );
    const client = adapter(fetchImpl);
    await expect(
      client.execute({
        method: 'GET',
        path: '/search',
        route: route('GET', '/search'),
        actorUserId: 'user-1',
        requestId: 'request-3',
        query: { q: 'secret', scope_path: 'tenant:other' },
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_SCOPE_FORBIDDEN', statusCode: 403 });
    await expect(
      client.execute({
        method: 'POST',
        path: '/records',
        route: route('POST', '/records'),
        actorUserId: 'user-1',
        requestId: 'request-4',
        body: {},
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_IDEMPOTENCY_REQUIRED', statusCode: 428 });
    await expect(
      client.execute({
        method: 'GET',
        path: '/records',
        route: route('GET', '/records'),
        actorUserId: 'user-1',
        requestId: 'request-5',
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_CONTRACT_INVALID', statusCode: 502 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('normalizes upstream errors and retries only safe or idempotent requests', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      if (calls === 1)
        return json(
          { error: { code: 'storage_unavailable', message: 'persistent storage is unavailable' } },
          503,
        );
      return json({ records: [], next_cursor: null });
    });
    const client = adapter(fetchImpl, { retries: 1, sleep: async () => undefined });
    await expect(
      client.execute({
        method: 'GET',
        path: '/records',
        route: route('GET', '/records'),
        actorUserId: 'user-1',
        requestId: 'request-6',
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const rejected = adapter(
      vi.fn<typeof fetch>(async () =>
        json({ error: { code: 'forbidden', message: 'scope denied' } }, 403),
      ),
    );
    await expect(
      rejected.execute({
        method: 'GET',
        path: '/records',
        route: route('GET', '/records'),
        actorUserId: 'user-1',
        requestId: 'request-7',
      }),
    ).rejects.toEqual(expect.any(MemoryV4AdapterError));
    await expect(
      rejected.execute({
        method: 'GET',
        path: '/records',
        route: route('GET', '/records'),
        actorUserId: 'user-1',
        requestId: 'request-8',
      }),
    ).rejects.toMatchObject({ code: 'forbidden', statusCode: 403, retryable: false });
  });
});
