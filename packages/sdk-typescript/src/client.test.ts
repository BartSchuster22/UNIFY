import { describe, expect, it } from 'vitest';
import { GatewayClient } from './client.js';

describe('GatewayClient', () => {
  it('uses same-origin credentials and CSRF header', async () => {
    let captured: RequestInit | undefined;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      captured = init;
      return new Response(null, { status: 204 });
    };
    const client = new GatewayClient({
      baseUrl: '/api/v1',
      fetch,
      csrfToken: () => 'csrf',
    });
    await client.request('/auth/logout', { method: 'POST' });
    expect(captured?.credentials).toBe('include');
    expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf');
  });
});
