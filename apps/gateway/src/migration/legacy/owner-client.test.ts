import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationOwnerClient, mutationDefinitions } from './owner-client.js';

const config = { memoryUrl: 'https://memory.example', memoryToken: 'token' };
const input = {
  operationType: 'memory.record.write',
  target: { owner: 'memory-v4' as const, kind: 'memory-record', nativeId: 'record-1' },
  payload: {
    entityType: 'project',
    entityId: 'unify',
    topic: 'phase-9',
    title: 'Evidence',
    content: 'Native conversations',
    role: 'evidence',
    lifecycle: 'working',
  },
  mode: 'execute' as const,
  confirmed: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('MutationOwnerClient migration quarantine', () => {
  it('contains no legacy chat mutation definitions', () => {
    expect(Object.keys(mutationDefinitions)).toEqual(['memory.record.write']);
    expect(Object.keys(mutationDefinitions).some((item) => item.startsWith('chat.'))).toBe(false);
  });

  it('requires only MemoryV4 runtime configuration', () => {
    expect(() =>
      MutationOwnerClient.fromEnv({
        MEMORY_V4_URL: config.memoryUrl,
        MEMORY_V4_TOKEN: config.memoryToken,
      }),
    ).not.toThrow();
    expect(() => MutationOwnerClient.fromEnv({})).toThrow('MEMORY_V4_URL');
  });

  it('validates the restricted MemoryV4 evidence scope', () => {
    const owner = new MutationOwnerClient(config);
    expect(owner.validate(input).owner).toBe('memory-v4');
    expect(() =>
      owner.validate({ ...input, payload: { ...input.payload, role: 'canonical' } }),
    ).toThrowError(/Only active\/working/);
  });

  it('executes a bounded authenticated MemoryV4 write', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer token' });
      return Response.json({ id: 'record-1' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new MutationOwnerClient(config).execute(input);
    expect(result).toEqual({ id: 'record-1' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/entities/project/unify/records');
  });
});
