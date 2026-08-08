import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryMutation } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'aquiero_csrf=; Max-Age=0; path=/';
});

describe('MemoryV4 mutation transport', () => {
  it('adds CSRF, idempotency, version and reason governance headers without exposing credentials', async () => {
    document.cookie = 'aquiero_csrf=csrf-proof; path=/';
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'rec_1', version: 4 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('crypto', { randomUUID: () => '7f5b658b-5b27-470d-9548-e7c67d226ff5' });

    await memoryMutation('/memory/records/rec_1', 'PATCH', {
      body: { title: 'Reviewed' },
      version: 3,
      reason: 'Operator reviewed evidence',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(path).toBe('/api/v1/memory/records/rec_1');
    expect(init.method).toBe('PATCH');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify({ title: 'Reviewed' }));
    expect(headers.get('x-csrf-token')).toBe('csrf-proof');
    expect(headers.get('idempotency-key')).toBe('7f5b658b-5b27-470d-9548-e7c67d226ff5');
    expect(headers.get('if-match')).toBe('3');
    expect(headers.get('x-memoryv4-reason')).toBe('Operator reviewed evidence');
    expect(
      [
        headers.get('authorization'),
        headers.get('memoryv4-token'),
        headers.get('x-memoryv4-token'),
      ].filter(Boolean),
    ).toEqual([]);
  });
});
