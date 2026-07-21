import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
} from '@aquiero/contracts';
import { describe, expect, it, vi } from 'vitest';
import { HermesControlClient, HermesControlClientError } from './client.js';

const meta = {
  contractVersion: HERMES_CONTROL_VERSION,
  frameworkId: 'hermes-main',
  frameworkVersion: PINNED_HERMES_RELEASE,
  frameworkCommit: PINNED_HERMES_COMMIT,
  sourceVersion: 'profiles:v1',
  observedAt: '2026-07-21T12:00:00.000Z',
};
const profileResponse = {
  ...meta,
  data: {
    items: [
      {
        id: 'default',
        displayName: 'Herman',
        active: true,
        gatewayStatus: 'running',
        model: 'gpt-5.6-sol',
        provider: 'OpenAI Codex',
      },
    ],
    page: { hasMore: false },
  },
};

function client(fetchImpl: typeof fetch) {
  return new HermesControlClient({
    baseUrl: 'http://127.0.0.1:18799',
    bearerToken: 'test-control-secret',
    fetchImpl,
    retries: 1,
    sleep: async () => undefined,
  });
}

describe('HermesControlClient', () => {
  it('uses bearer service auth and preserves opaque pagination safely', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-control-secret');
      return Response.json(profileResponse);
    });
    const result = await client(fetchMock as unknown as typeof fetch).profiles({
      cursor: 'opaque+/cursor',
      limit: 25,
    });
    expect(result.data.items[0]?.displayName).toBe('Herman');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('cursor=opaque%2B%2Fcursor');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=25');
  });

  it('rejects malformed upstream contracts without leaking the service token', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ...profileResponse, data: { items: [{}], page: {} } }),
    ) as unknown as typeof fetch;
    const request = client(fetchImpl).profiles();
    await expect(request).rejects.toMatchObject({
      code: 'FRAMEWORK_CONTRACT_INVALID',
      statusCode: 502,
    });
    await expect(request.catch((error: unknown) => String(error))).resolves.not.toContain(
      'test-control-secret',
    );
  });

  it('does not retry authentication failures', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          contractVersion: HERMES_CONTROL_VERSION,
          frameworkId: 'hermes-main',
          error: {
            code: 'unauthenticated',
            message: 'Authentication required',
            requestId: 'request-1',
            retryable: false,
          },
        },
        { status: 401 },
      ),
    ) as unknown as typeof fetch;
    await expect(client(fetchImpl).profiles()).rejects.toBeInstanceOf(HermesControlClientError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries bounded transient failures and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(Response.json(profileResponse)) as unknown as typeof fetch;
    await expect(client(fetchImpl).profiles()).resolves.toMatchObject({
      data: { items: [{ id: 'default' }] },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
