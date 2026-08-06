import { describe, expect, it } from 'vitest';
import {
  HermesNativeSource,
  SecondConsumerForbiddenError,
  validateApiBaseUrl,
  type CommandRunner,
} from './source.js';

class FixtureRunner implements CommandRunner {
  constructor(private readonly outputs: Record<string, string>) {}
  async run(args: string[]) {
    const key = args.join(' ');
    const value = this.outputs[key];
    if (value === undefined) throw new Error(`Missing fixture: ${key}`);
    return value;
  }
}

describe('HermesNativeSource', () => {
  it('adapts profiles and provider credential status without exposing credential fragments', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list': `Profile          Model          Gateway      Alias\n ───────────────  ─────────────  ───────────  ─────\n ◆default         gpt-5.6-sol    running      —\n  test-agent      gpt-5.5        stopped      test-agent\n`,
        'status --all': `◆ Environment\n  Model:        gpt-5.6-sol\n  Provider:     OpenAI Codex\n◆ API Keys\n  OpenRouter    ✓ sk-sensitive-fragment\n  DeepSeek      ✗ (not set)\n◆ Auth Providers\n  OpenAI Codex  ✓ logged in\n    Auth file: /secret/auth.json\n`,
      }),
    });

    const profiles = await source.profiles();
    expect(profiles.items).toEqual([
      {
        id: 'default',
        displayName: 'Default',
        active: true,
        gatewayStatus: 'running',
        model: 'gpt-5.6-sol',
      },
      {
        id: 'test-agent',
        displayName: 'test-agent',
        active: false,
        gatewayStatus: 'stopped',
        model: 'gpt-5.5',
      },
    ]);
    const providers = await source.providers();
    expect(providers.items).toContainEqual({
      id: 'openai-codex',
      displayName: 'OpenAI Codex',
      credentialStatus: 'configured',
      selected: true,
    });
    expect(JSON.stringify(providers)).not.toContain('sensitive-fragment');
    expect(JSON.stringify(providers)).not.toContain('/secret/auth.json');
  });

  it('executes native profile updates through the supported non-interactive CLI', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list': ' ◆default         gpt-5.6-sol    running      —\n',
        'profile describe default --text Native profile': '',
      }),
    });
    await expect(
      source.executeProfile({
        mode: 'execute',
        idempotencyKey: 'profile-update-idempotency',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        actor: { type: 'service', id: 'unify-core' },
        operation: 'profile.update',
        targetId: 'default',
        payload: { description: 'Native profile' },
      }),
    ).resolves.toEqual({ profile: { id: 'default', updated: true } });
  });

  it('adapts boards/tasks and rejects malformed native identifiers before CLI execution', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'kanban boards list --json --all': JSON.stringify([
          {
            slug: 'project-a',
            name: 'Project A',
            archived: false,
            is_current: true,
            counts: { ready: 2 },
            total: 2,
            updated_at: '2026-07-21T10:00:00Z',
          },
        ]),
        'kanban --board project-a list --json --archived --sort updated': JSON.stringify([
          {
            id: 'task-1',
            title: 'Verify adapter',
            status: 'ready',
            assignee: 'test-agent',
            priority: 1,
            updated_at: '2026-07-21T10:00:00Z',
          },
        ]),
      }),
    });
    expect((await source.boards()).items[0]?.id).toBe('project-a');
    expect((await source.tasks('project-a')).items[0]).toMatchObject({
      id: 'task-1',
      boardId: 'project-a',
      status: 'ready',
    });
    await expect(source.tasks('../escape')).rejects.toThrow('Invalid native identifier');
  });

  it('adapts Hermes projects and cronjobs and executes idempotent native task creation', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'project list --all':
          '  alpha                    Alpha Project  [0 folder(s)]\nphase-14-5-hermes-herman Phase 14.5 hermes-herman  [0 folder(s)]\n',
        'project show alpha':
          '  name: Alpha Project\n  slug: alpha\n  about: Ship Alpha\n  board: alpha\n',
        'project show phase-14-5-hermes-herman':
          '  name: Phase 14.5 hermes-herman\n  slug: phase-14-5-hermes-herman\n  board: phase-14-5-hermes-herman\n',
        'cron list --all': `job-1 [paused]\n  Name: Daily checks\n  Schedule: every 1440m\n  Next run: 2026-07-22T09:00:00+00:00\n  Deliver: local\n`,
        'kanban --board alpha create Verify --body Run checks --assignee herman --priority 75 --idempotency-key idem-1 --json':
          JSON.stringify({
            id: 'task-1',
            title: 'Verify',
            status: 'triage',
          }),
      }),
    });
    expect((await source.projects()).items).toEqual([
      {
        id: 'alpha',
        name: 'Alpha Project',
        description: 'Ship Alpha',
        boardId: 'alpha',
        archived: false,
      },
      {
        id: 'phase-14-5-hermes-herman',
        name: 'Phase 14.5 hermes-herman',
        boardId: 'phase-14-5-hermes-herman',
        archived: false,
      },
    ]);
    expect((await source.cronjobs()).items[0]).toMatchObject({
      id: 'job-1',
      name: 'Daily checks',
      schedule: 'every 1440m',
      status: 'paused',
      deliver: ['local'],
    });
    await expect(
      source.executeWork({
        mode: 'execute',
        idempotencyKey: 'idem-1',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        actor: { type: 'user', id: 'user-1' },
        operation: 'task.create',
        targetId: 'verify',
        payload: {
          boardId: 'alpha',
          title: 'Verify',
          body: 'Run checks',
          assignee: 'herman',
          priority: 'high',
        },
      }),
    ).resolves.toMatchObject({ task: { id: 'task-1', status: 'triage' } });
  });

  it('uses existing Hermes session APIs and fails unavailable rather than returning empty truth', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/sessions'))
        return new Response(
          JSON.stringify({ sessions: [{ session_id: 's-1', title: 'Native', source: 'cli' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      if (url.endsWith('/api/sessions/s-1/messages'))
        return new Response(
          JSON.stringify({ messages: [{ id: 'm-1', role: 'user', content: 'hello' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      if (url.endsWith('/api/sessions/s-1'))
        return Response.json({ session: { id: 's-1', source: 'cli' } });
      return new Response('{}', { status: 404 });
    };
    const source = new HermesNativeSource({
      runner: new FixtureRunner({}),
      apiBaseUrl: 'https://hermes.test',
      fetchImpl,
    });
    expect((await source.sessions()).items[0]?.id).toBe('s-1');
    expect((await source.messages('s-1')).items[0]?.content).toBe('hello');

    const unavailable = new HermesNativeSource({ runner: new FixtureRunner({}) });
    await expect(unavailable.sessions()).rejects.toThrow('not configured');
  });

  it('fails closed for external-channel session lists and message histories', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({}),
      apiBaseUrl: 'https://hermes.test',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/api/sessions'))
          return Response.json({
            data: [
              { id: 'external', source: 'telegram' },
              { id: 'internal', source: 'api_server' },
            ],
          });
        if (url.endsWith('/api/sessions/external'))
          return Response.json({ session: { id: 'external', source: 'telegram' } });
        return new Response('{}', { status: 404 });
      },
    });
    expect((await source.sessions()).items.map((item) => item.id)).toEqual(['internal']);
    await expect(source.messages('external')).rejects.toBeInstanceOf(SecondConsumerForbiddenError);
  });

  it('rejects unsafe Hermes API endpoints before issuing a request', () => {
    expect(validateApiBaseUrl('http://127.0.0.1:8642/')).toBe('http://127.0.0.1:8642');
    expect(validateApiBaseUrl('https://hermes.example')).toBe('https://hermes.example');
    for (const endpoint of [
      'http://hermes.example',
      'https://user:secret@hermes.example',
      'https://hermes.example/api',
      'https://hermes.example?token=value',
      'file:///srv/hermes',
    ])
      expect(() => validateApiBaseUrl(endpoint)).toThrow();
  });
});
