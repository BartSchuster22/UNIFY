import { describe, expect, it, vi } from 'vitest';
import type { UnifiedResource } from '@aquiero/contracts';
import { ChatReadAdapter, ConfiguredReadAdapter } from './adapters.js';
import { IntegrationService } from './service.js';
import type { IntegrationSnapshot, SourceAdapter } from './types.js';

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function resource(
  id: string,
  owner: 'worker' | 'memory-v4' = 'worker',
  title = id,
): UnifiedResource {
  const now = '2026-07-19T12:00:00.000Z';
  return {
    resource: {
      canonicalId: `${owner}:task:${Buffer.from(id).toString('base64url')}`,
      kind: owner === 'worker' ? 'task' : 'memory-record',
      owner,
      nativeId: id,
      displayLabel: title,
      observedAt: now,
    },
    truth: 'current',
    authoritative: true,
    adapterId: `${owner}-test`,
    fetchedAt: now,
    title,
    searchableText: title,
    data: { id, title },
  };
}

class SequenceAdapter implements SourceAdapter {
  readonly id = 'worker-test';
  readonly owners: Array<'worker'> = ['worker'];
  calls = 0;
  constructor(readonly sequences: UnifiedResource[][]) {}
  async snapshot(): Promise<IntegrationSnapshot> {
    const resources = this.sequences[Math.min(this.calls++, this.sequences.length - 1)] ?? [];
    return {
      adapterId: this.id,
      owners: [...this.owners],
      status: resources.length ? 'current' : 'empty',
      observedAt: new Date().toISOString(),
      resources,
      warnings: [],
    };
  }
}

describe('authoritative read adapters', () => {
  it('logs in, normalizes collision-safe identity, and recursively redacts secrets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/login')) {
        expect(init?.method).toBe('POST');
        return response({ ok: true }, 200, { 'set-cookie': 'sid=opaque; HttpOnly; Path=/' });
      }
      expect(new Headers(init?.headers).get('cookie')).toBe('sid=opaque');
      return response({
        data: {
          providers: [
            { id: 'a/b', name: 'Provider A', credential: { api_token: 'do-not-leak' } },
            { id: 'a:b', name: 'Provider B' },
          ],
        },
      });
    });
    const adapter = new ConfiguredReadAdapter({
      id: 'dmm-test',
      owners: ['dmm'],
      baseUrl: 'https://dmm.invalid',
      auth: {
        type: 'session',
        loginPath: '/api/auth/login',
        body: { username: 'named', password: 'secret' },
      },
      endpoints: [{ path: '/api/providers', key: 'providers', kind: 'provider' }],
      fetch,
    });
    const snapshot = await adapter.snapshot();
    expect(snapshot.status).toBe('current');
    expect(snapshot.resources).toHaveLength(2);
    expect(new Set(snapshot.resources.map((item) => item.resource.canonicalId)).size).toBe(2);
    expect(snapshot.resources[0]?.data).toMatchObject({ credential: '[REDACTED]' });
    expect(JSON.stringify(snapshot.resources)).not.toContain('do-not-leak');
  });

  it('reports partial truth rather than hiding a failed collection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).endsWith('/ok') ? response({ tasks: [{ id: 't1' }] }) : response({}, 503),
    );
    const adapter = new ConfiguredReadAdapter({
      id: 'worker-test',
      owners: ['worker'],
      baseUrl: 'https://worker.invalid',
      auth: { type: 'none' },
      fetch,
      endpoints: [
        { path: '/ok', key: 'tasks', kind: 'task' },
        { path: '/failed', key: 'jobs', kind: 'cronjob' },
      ],
    });
    const snapshot = await adapter.snapshot();
    expect(snapshot.status).toBe('partial');
    expect(snapshot.resources).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(1);
  });

  it('reads chat sessions, messages, and embedded routes without mutations', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/login'))
        return response({ ok: true }, 200, { 'set-cookie': 'sid=x; Path=/' });
      if (url.endsWith('/api/chat/sessions'))
        return response({
          sessions: [{ id: 's1', title: 'Chat', surface: { route_kind: 'telegram' } }],
        });
      return response({ messages: [{ id: 'm1', text: 'hello' }] });
    });
    const adapter = new ChatReadAdapter({
      id: 'chat-test',
      owners: ['chat'],
      baseUrl: 'https://chat.invalid',
      auth: { type: 'session', loginPath: '/auth/login', body: { password: 'test' } },
      endpoints: [{ path: '/api/chat/sessions', key: 'sessions', kind: 'chat-session' }],
      fetch,
    });
    const snapshot = await adapter.snapshot();
    expect(snapshot.resources.map((item) => item.resource.kind)).toEqual([
      'chat-session',
      'chat-message',
      'chat-route',
    ]);
    expect(
      fetch.mock.calls.every(
        (call) =>
          call[1]?.method !== 'PUT' && call[1]?.method !== 'PATCH' && call[1]?.method !== 'DELETE',
      ),
    ).toBe(true);
  });
});

describe('unified federation and shadow comparison', () => {
  it('unifies search, events, notifications, and detects owner drift', async () => {
    const adapter = new SequenceAdapter([
      [resource('task-1', 'worker', 'Release checklist')],
      [resource('task-1', 'worker', 'Changed checklist'), resource('task-2')],
    ]);
    const service = new IntegrationService([adapter]);
    const read = await service.read({ refresh: true });
    expect(read.resources).toHaveLength(1);
    expect(await service.search('release')).toHaveLength(1);
    expect(service.events()[0]).toMatchObject({
      type: 'source.snapshot.observed',
      source: { owner: 'worker' },
    });
    const comparisons = await service.shadow();
    expect(comparisons[0]).toMatchObject({
      status: 'mismatch',
      unexpected: [resource('task-2').resource.canonicalId],
    });
    expect(comparisons[0]?.changed).toEqual([resource('task-1').resource.canonicalId]);
    expect(comparisons[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await service.notifications()).toEqual([]);
  });

  it('emits truthful unavailable status and a synthesized notification', async () => {
    const adapter = new ConfiguredReadAdapter({
      id: 'memory-test',
      owners: ['memory-v4'],
      auth: { type: 'none' },
      endpoints: [],
    });
    const service = new IntegrationService([adapter]);
    const result = await service.read({ refresh: true });
    expect(result.snapshots[0]).toMatchObject({ status: 'unavailable' });
    expect(await service.notifications()).toMatchObject([
      { source: 'memory-v4', severity: 'error' },
    ]);
  });
});
