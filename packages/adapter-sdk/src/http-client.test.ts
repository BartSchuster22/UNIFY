import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';
import { ResilientHttpClient } from './http-client.js';

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const noSleep = async () => undefined;

describe('ResilientHttpClient contract', () => {
  it('propagates correlation headers and parses JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ ok: true }));
    const client = new ResilientHttpClient({
      baseUrl: 'https://framework.invalid/',
      fetch,
      defaultHeaders: { 'x-correlation-id': 'corr-1' },
    });
    await expect(client.request({ path: '/health' })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://framework.invalid/health',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-correlation-id': 'corr-1' }),
      }),
    );
  });

  it('retries safe reads on retryable status and honors bounded retry-after', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ error: {} }, 503, { 'retry-after': '999' }))
      .mockResolvedValueOnce(json({ value: 42 }));
    const sleep = vi.fn(async () => undefined);
    const client = new ResilientHttpClient({ baseUrl: 'https://x', fetch, retries: 2, sleep });
    await expect(client.request({ path: '/resource' })).resolves.toEqual({ value: 42 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('does not retry an unsafe mutation without an idempotency key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, 503));
    const client = new ResilientHttpClient({
      baseUrl: 'https://x',
      fetch,
      retries: 3,
      sleep: noSleep,
    });
    await expect(
      client.request({ method: 'POST', path: '/action', body: {} }),
    ).rejects.toMatchObject({ code: 'ADAPTER_HTTP_503', retryable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent mutation and forwards its key', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ operationId: 'op-1' }));
    const client = new ResilientHttpClient({
      baseUrl: 'https://x',
      fetch,
      retries: 1,
      sleep: noSleep,
    });
    await expect(
      client.request({ method: 'POST', path: '/action', body: {}, idempotencyKey: 'idem-1' }),
    ).resolves.toEqual({ operationId: 'op-1' });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://x/action',
      expect.objectContaining({
        headers: expect.objectContaining({ 'idempotency-key': 'idem-1' }),
      }),
    );
  });

  it('distinguishes caller cancellation from timeout', async () => {
    const hanging = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const client = new ResilientHttpClient({
      baseUrl: 'https://x',
      fetch: hanging,
      retries: 0,
      timeoutMs: 10,
    });
    await expect(client.request({ path: '/slow' })).rejects.toMatchObject({
      code: 'ADAPTER_TIMEOUT',
      category: 'timeout',
    });
    const controller = new AbortController();
    const pending = client.request({ path: '/cancel', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: 'ADAPTER_CANCELLED',
      category: 'cancelled',
      retryable: false,
    });
  });

  it('normalizes protocol and authorization failures', async () => {
    const textFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response('html', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    await expect(
      new ResilientHttpClient({ baseUrl: 'https://x', fetch: textFetch }).request({ path: '/' }),
    ).rejects.toMatchObject({ code: 'ADAPTER_PROTOCOL', category: 'protocol' });
    const forbidden = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ error: { code: 'UPSTREAM_DENIED' } }, 403));
    await expect(
      new ResilientHttpClient({ baseUrl: 'https://x', fetch: forbidden }).request({ path: '/' }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_DENIED',
      category: 'authorization',
      retryable: false,
    });
  });
});

describe('CircuitBreaker', () => {
  it('opens, rejects, admits one half-open probe, then closes on success', () => {
    let now = 1_000;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: () => now });
    breaker.beforeRequest();
    breaker.failure();
    expect(breaker.state).toBe('closed');
    breaker.beforeRequest();
    breaker.failure();
    expect(breaker.state).toBe('open');
    expect(() => breaker.beforeRequest()).toThrowError(/circuit is open/);
    now += 101;
    breaker.beforeRequest();
    expect(breaker.state).toBe('half_open');
    expect(() => breaker.beforeRequest()).toThrowError(/probe is in flight/);
    breaker.success();
    expect(breaker.state).toBe('closed');
  });
});
