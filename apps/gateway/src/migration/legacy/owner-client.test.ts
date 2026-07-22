import { afterEach, describe, expect, it, vi } from 'vitest';

const realtimeWs = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string;
    options: unknown;
    sent: string[];
    readyState: number;
    emit: (event: string, ...args: unknown[]) => void;
    close: () => void;
  }>,
}));
vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = MockWebSocket.CONNECTING;
    sent: string[] = [];
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor(
      public url: string,
      public options: unknown,
    ) {
      realtimeWs.instances.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    emit(event: string, ...args: unknown[]) {
      if (event === 'open') this.readyState = MockWebSocket.OPEN;
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    send(value: string) {
      this.sent.push(value);
    }
    close() {
      this.readyState = 3;
    }
  }
  return { default: MockWebSocket };
});

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

afterEach(() => {
  vi.unstubAllGlobals();
  realtimeWs.instances.length = 0;
});

describe('MutationOwnerClient', () => {
  it('reads only the fixed Agency profile inventory and encoded profile context paths', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        calls.push(url);
        if (url.endsWith('/api/auth/login'))
          return new Response('{}', { headers: { 'set-cookie': 'agency=session; Secure' } });
        return Response.json({ ok: true });
      }),
    );
    const owners = new MutationOwnerClient(config);
    await owners.agencyProfileInventory();
    await owners.agencyProfileContext('hermes-main', 'default');
    for (const path of [
      '/api/frameworks',
      '/api/framework-profiles',
      '/api/agents?visibility=all',
      '/api/frameworks/hermes-main/capabilities',
      '/api/frameworks/hermes-main/models/selectable',
      '/api/frameworks/hermes-main/profiles/default',
    ])
      expect(
        calls.some((url) => url.endsWith(path)),
        path,
      ).toBe(true);
    await expect(owners.agencyProfileContext('../unsafe', 'default')).rejects.toMatchObject({
      code: 'MUTATION_TARGET_INVALID',
      statusCode: 422,
    });
  });

  it('reads the fixed DMM provider, model and credential-status inventory without arbitrary proxy paths', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        calls.push(url);
        if (url.endsWith('/api/auth/login'))
          return new Response(JSON.stringify({ data: { csrfToken: 'csrf' } }), {
            headers: { 'content-type': 'application/json', 'set-cookie': 'dmm=session; Secure' },
          });
        return Response.json({ ok: true, data: {} });
      }),
    );
    await new MutationOwnerClient(config).dmmInventory();
    for (const path of [
      '/api/providers',
      '/api/providers/requirements',
      '/api/credentials',
      '/api/models',
      '/api/normalized-state',
    ])
      expect(
        calls.some((url) => url.endsWith(path)),
        path,
      ).toBe(true);
  });

  it('reads CHAT agents, sessions and one validated session message history', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        calls.push(url);
        if (url.endsWith('/auth/login'))
          return new Response('{}', { headers: { 'set-cookie': 'chat=session; Secure' } });
        if (url.endsWith('/messages'))
          return Response.json({
            ok: true,
            messages: Array.from({ length: 505 }, (_, index) => ({ id: `m${index}` })),
          });
        if (url.endsWith('/api/chat/sessions'))
          return Response.json({
            ok: true,
            sessions: [
              { id: 'ses_123', source: 'dashboard_native', title: 'Internal' },
              { id: 'ses_external', source: 'telegram', title: 'Telegram' },
            ],
          });
        if (url.endsWith('/api/agents'))
          return Response.json({
            ok: true,
            agents: [
              {
                id: 'hermes.herman',
                capabilities: { text: true, external_channels: true },
                channel_bindings: [{ channel: 'telegram' }],
              },
            ],
          });
        return Response.json({ ok: true });
      }),
    );
    const owners = new MutationOwnerClient(config);
    const workspace = await owners.chatWorkspace('ses_123');
    const history = workspace.messages as {
      messages: Array<{ id: string }>;
      total: number;
      truncated: boolean;
    };
    expect(history).toMatchObject({ total: 505, truncated: true });
    expect(history.messages).toHaveLength(500);
    expect(history.messages[0]?.id).toBe('m5');
    expect(workspace.sessions).toEqual({
      ok: true,
      sessions: [{ id: 'ses_123', source: 'dashboard_native', title: 'Internal' }],
    });
    expect(workspace.agents).toEqual({
      ok: true,
      agents: [
        {
          id: 'hermes.herman',
          capabilities: { text: true },
        },
      ],
    });
    await expect(owners.chatWorkspace('ses_external')).rejects.toMatchObject({
      code: 'CHAT_SESSION_NOT_FOUND',
      statusCode: 404,
    });
    for (const path of ['/api/agents', '/api/chat/sessions', '/api/chat/sessions/ses_123/messages'])
      expect(
        calls.some((url) => url.endsWith(path)),
        path,
      ).toBe(true);
    await expect(owners.chatWorkspace('../unsafe')).rejects.toMatchObject({
      code: 'MUTATION_TARGET_INVALID',
      statusCode: 422,
    });
  });

  it('bridges authenticated CHAT websocket events and subscribes with replay state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        if (String(request).endsWith('/auth/login'))
          return new Response('{}', { headers: { 'set-cookie': 'chat=session; Secure' } });
        return Response.json({ ok: true });
      }),
    );
    const owners = new MutationOwnerClient(config);
    const frames: unknown[] = [];
    const disconnects: string[] = [];
    const stop = await owners.openChatRealtime(
      (frame) => frames.push(frame),
      (reason) => disconnects.push(reason),
      'event-42',
    );
    const socket = realtimeWs.instances.at(-1)!;
    expect(String(socket.url)).toBe('wss://chat.test/api/realtime');
    expect(socket.options).toEqual({ headers: { cookie: 'chat=session' } });
    socket.emit('open');
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'subscribe',
      topics: ['chat:*'],
      last_event_id: 'event-42',
    });
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'message.created',
          session_id: 'ses_123',
          source: 'dashboard_native',
        }),
      ),
    );
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'message.created',
          session_id: 'ses_external',
          source: 'telegram',
        }),
      ),
    );
    expect(frames).toEqual([
      { type: 'message.created', session_id: 'ses_123', source: 'dashboard_native' },
    ]);
    stop();
    socket.emit('close');
    expect(disconnects).toEqual([]);
  });

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
        if (url.endsWith('/api/chat/sessions') && init.method === 'GET')
          return Response.json({
            ok: true,
            sessions: [{ id: 'session-1', source: 'dashboard_native', title: 'Internal' }],
          });
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
        input('chat.session.create', 'chat', 'chat-session', 'new', {
          agent_id: 'hermes.herman',
          title: 'New session',
        }),
        'POST',
        '/api/chat/sessions',
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

  it('rejects external CHAT session creation before contacting CHAT', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const owners = new MutationOwnerClient(config);
    await expect(
      owners.execute(
        input('chat.session.create', 'chat', 'chat-session', 'new', {
          agent_id: 'hermes.herman',
          title: 'Telegram session',
          source: 'telegram',
          external_identity: 'telegram:123',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CHAT_EXCLUDED', statusCode: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects message delivery to an external CHAT session', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init: RequestInit = {}) => {
        const url = String(request);
        calls.push(`${init.method ?? 'GET'} ${url}`);
        if (url.endsWith('/auth/login'))
          return new Response('{}', { headers: { 'set-cookie': 'chat=session; Secure' } });
        if (url.endsWith('/api/chat/sessions'))
          return Response.json({
            ok: true,
            sessions: [{ id: 'ses_external', source: 'telegram', title: 'Telegram' }],
          });
        if (url.endsWith('/api/agents')) return Response.json({ ok: true, agents: [] });
        return Response.json({ ok: true });
      }),
    );
    const owners = new MutationOwnerClient(config);
    await expect(
      owners.execute(
        input('chat.message.send', 'chat', 'chat-session', 'ses_external', {
          blocks: [{ kind: 'text', text: 'must not send externally' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND', statusCode: 404 });
    expect(calls.some((call) => call.includes('/ses_external/messages'))).toBe(false);
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
