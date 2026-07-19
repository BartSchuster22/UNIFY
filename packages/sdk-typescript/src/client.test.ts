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
  it('sends governed mutations with an idempotency key', async () => {
    let capturedUrl = '';
    let captured: RequestInit | undefined;
    const client = new GatewayClient({
      fetch: async (input, init) => {
        capturedUrl = String(input);
        captured = init;
        return new Response('{}');
      },
      csrfToken: () => 'csrf',
    });
    await client.executeMutation(
      {
        operationType: 'chat.message.send',
        target: { owner: 'chat', kind: 'chat-session', nativeId: 'session-1' },
        payload: { blocks: [{ kind: 'text', text: 'hello' }] },
        mode: 'execute',
        confirmed: false,
      },
      'mutation-key',
    );
    expect(capturedUrl).toBe('/api/v1/mutations');
    const headers = new Headers(captured?.headers);
    expect(headers.get('idempotency-key')).toBe('mutation-key');
    expect(headers.get('x-csrf-token')).toBe('csrf');
    expect(captured?.credentials).toBe('include');
  });
  it('only downloads canonical Chat upload paths with same-origin credentials', async () => {
    let capturedUrl = '';
    let captured: RequestInit | undefined;
    const client = new GatewayClient({
      fetch: async (input, init) => {
        capturedUrl = String(input);
        captured = init;
        return new Response('file');
      },
    });
    await client.downloadChatUpload('/uploads/file.pdf');
    expect(capturedUrl).toBe('/api/v1/chat/download?path=%2Fuploads%2Ffile.pdf');
    expect(captured?.credentials).toBe('include');
    await expect(client.downloadChatUpload('../secret')).rejects.toThrow(/invalid/i);
  });
});
