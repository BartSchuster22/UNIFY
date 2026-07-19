import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayClient } from './index.js';

afterEach(() => vi.unstubAllGlobals());

describe('GatewayClient', () => {
  it('uses the same-origin Gateway and includes credentials', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            userId: 'u1',
            username: 'u',
            displayName: 'U',
            roles: [],
            permissions: [],
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new GatewayClient();
    await client.me();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends CSRF and idempotency without exposing a downstream credential', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'aquiero_csrf=csrf-value',
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            replayed: false,
            operation: {
              operationId: 'o',
              operationType: 'chat.send',
              state: 'verified',
              updatedAt: 'now',
            },
            result: {},
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new GatewayClient().mutate(
      {
        operationType: 'chat.send',
        target: { owner: 'chat', kind: 'chat-session', nativeId: 's1' },
        payload: { content: 'hello' },
        mode: 'execute',
        confirmed: false,
      },
      'idem-1',
    );
    const init = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
    const headers = new Headers(init.headers);
    expect(headers.get('x-csrf-token')).toBe('csrf-value');
    expect(headers.get('idempotency-key')).toBe('idem-1');
    expect(headers.has('authorization')).toBe(false);
  });

  it('returns a structured Gateway error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'DENIED', message: 'Denied' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(new GatewayClient().me()).rejects.toMatchObject({
      status: 403,
      failure: { code: 'DENIED' },
    });
  });
});
