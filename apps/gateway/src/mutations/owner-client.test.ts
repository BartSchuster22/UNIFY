import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationOwnerClient, type MutationInput } from './owner-client.js';

const config = {
  agencyUrl: 'https://agency.test',
  agencyUsername: 'agency-user',
  agencyPassword: 'agency-password',
  dmmUrl: 'https://dmm.test',
  dmmUsername: 'dmm-user',
  dmmPassword: 'dmm-password',
  workerUrl: 'https://worker.test',
  workerToken: 'worker-token',
  chatUrl: 'https://chat.test',
  chatPassword: 'chat-password',
  memoryUrl: 'https://memory.test',
  memoryToken: 'memory-token',
};

function input(
  operationType: string,
  owner: MutationInput['target']['owner'],
  kind: string,
  nativeId: string,
  payload: Record<string, unknown>,
): MutationInput {
  return {
    operationType,
    target: {
      owner,
      kind,
      nativeId,
      ...(owner === 'hermes' ? { frameworkId: 'hermes-main' } : {}),
    },
    payload,
    mode: 'execute',
    confirmed: operationType.endsWith('.delete'),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('MutationOwnerClient', () => {
  it('routes owner mutations with owner authentication and exact native paths', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init: RequestInit = {}) => {
        const url = String(request);
        calls.push({ url, init });
        if (url.endsWith('/api/auth/login')) {
          const dmm = url.startsWith(config.dmmUrl);
          return new Response(dmm ? JSON.stringify({ data: { csrfToken: 'dmm-csrf' } }) : '{}', {
            headers: {
              'content-type': 'application/json',
              'set-cookie': `${dmm ? 'dmm' : 'agency'}=session; Secure`,
            },
          });
        }
        if (url.endsWith('/auth/login'))
          return new Response('{}', { headers: { 'set-cookie': 'chat=session; Secure' } });
        return Response.json({ ok: true });
      }),
    );
    const owners = new MutationOwnerClient(config);
    const cases: Array<[MutationInput, string, string]> = [
      [
        input('profile.create', 'hermes', 'profile', 'new-profile', {
          displayName: 'New profile',
          identityFiles: [{ path: 'SOUL.md', content: 'identity' }],
          modelConfig: { primary: 'openai-codex/gpt-5.5', fallbacks: [] },
        }),
        'POST',
        '/api/frameworks/hermes-main/profiles',
      ],
      [
        input('dmm.credential.save', 'dmm', 'provider', 'openai', { secret: 'credential' }),
        'POST',
        '/api/providers/openai/credential',
      ],
      [
        input('worker.project.create', 'worker', 'project', 'new', { name: 'Project' }),
        'POST',
        '/api/kanban/projects',
      ],
      [
        input('worker.task.comment', 'worker', 'task', 'task-1', { note: 'Comment' }),
        'POST',
        '/api/kanban/tasks/task-1/comments',
      ],
      [
        input('worker.cron.create', 'worker', 'cronjob', 'new', {
          harness: 'hermes',
          title: 'Cron',
          schedule: { kind: 'cron', expression: '0 9 * * *' },
        }),
        'POST',
        '/api/cron/jobs',
      ],
      [
        input('chat.message.send', 'chat', 'chat-session', 'session-1', {
          blocks: [{ kind: 'text', text: 'hello' }],
        }),
        'POST',
        '/api/chat/sessions/session-1/messages',
      ],
      [
        input('chat.upload', 'chat', 'chat-session', 'upload', {
          name: 'a.txt',
          mime: 'text/plain',
          data: 'YQ==',
        }),
        'POST',
        '/api/uploads',
      ],
      [
        input('memory.record.write', 'memory-v4', 'memory-record', 'new', {
          entityType: 'project',
          entityId: 'unify',
          role: 'evidence',
          lifecycle: 'live',
          topic: 'phase5',
          title: 'Evidence',
          content: 'Verified',
        }),
        'POST',
        '/entities/project/unify/records',
      ],
    ];
    for (const [mutation, method, path] of cases) {
      await owners.execute(mutation);
      const call = [...calls].reverse().find((item) => item.url.endsWith(path));
      expect(call, path).toBeDefined();
      expect(call?.init.method).toBe(method);
    }
    const dmm = calls.find((call) => call.url.endsWith('/api/providers/openai/credential'))!;
    expect(dmm.init.headers).toMatchObject({ cookie: 'dmm=session', 'x-csrf-token': 'dmm-csrf' });
    const worker = calls.find((call) => call.url.endsWith('/api/kanban/projects'))!;
    expect(worker.init.headers).toMatchObject({ authorization: 'Bearer worker-token' });
    const memory = calls.find((call) => call.url.endsWith('/entities/project/unify/records'))!;
    expect(memory.init.headers).toMatchObject({ authorization: 'Bearer memory-token' });
  });

  it('rejects malformed base64 before contacting Chat', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const owners = new MutationOwnerClient(config);
    await expect(
      owners.execute(
        input('chat.upload', 'chat', 'chat-session', 'upload', {
          name: 'a.txt',
          mime: 'text/plain',
          data: 'not-base64!',
        }),
      ),
    ).rejects.toMatchObject({ code: 'MUTATION_PAYLOAD_INVALID', statusCode: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects traversal names and active-content Chat uploads before contacting Chat', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const owners = new MutationOwnerClient(config);
    for (const payload of [
      { name: '../payload.txt', mime: 'text/plain', data: 'YQ==' },
      { name: 'payload.svg', mime: 'image/svg+xml', data: 'YQ==' },
      { name: 'payload.html', mime: 'text/html', data: 'YQ==' },
    ]) {
      await expect(
        owners.execute(input('chat.upload', 'chat', 'chat-session', 'upload', payload)),
      ).rejects.toMatchObject({ statusCode: expect.any(Number) });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe or oversized Chat downloads', async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      if (String(request).endsWith('/auth/login'))
        return new Response('{}', { headers: { 'set-cookie': 'chat=session; Secure' } });
      return new Response('too large', {
        headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const owners = new MutationOwnerClient(config);
    await expect(owners.download('../secret')).rejects.toMatchObject({
      code: 'CHAT_DOWNLOAD_PATH_INVALID',
      statusCode: 422,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(owners.download('/uploads/large.bin')).rejects.toMatchObject({
      code: 'CHAT_DOWNLOAD_TOO_LARGE',
      statusCode: 413,
    });
  });

  it('preserves only a safe owner error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        if (String(request).endsWith('/api/auth/login'))
          return new Response('{}', { headers: { 'set-cookie': 'agency=session; Secure' } });
        return Response.json(
          { error: 'profile_protected', secret: 'must-not-leak' },
          { status: 403 },
        );
      }),
    );
    const owners = new MutationOwnerClient(config);
    await expect(
      owners.execute(input('profile.delete', 'hermes', 'profile', 'herman', {})),
    ).rejects.toMatchObject({ code: 'UPSTREAM_PROFILE_PROTECTED', statusCode: 403 });
    try {
      await owners.execute(input('profile.delete', 'hermes', 'profile', 'herman', {}));
    } catch (error) {
      expect(String(error)).not.toContain('must-not-leak');
    }
  });
});
