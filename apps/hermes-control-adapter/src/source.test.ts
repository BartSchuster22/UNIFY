import { describe, expect, it, vi } from 'vitest';
import {
  HermesNativeSource,
  isVerifiedAssistantInferenceMessage,
  SecondConsumerForbiddenError,
  validateApiBaseUrl,
  validateBaseProfileDisplayName,
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
  it('requires a non-empty assistant response before inference can be verified', () => {
    expect(isVerifiedAssistantInferenceMessage({ role: 'user', id: 'accepted-user-message' })).toBe(
      false,
    );
    expect(isVerifiedAssistantInferenceMessage({ role: 'assistant', content: '' })).toBe(false);
    expect(
      isVerifiedAssistantInferenceMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
      }),
    ).toBe(true);
    expect(isVerifiedAssistantInferenceMessage({ sender: 'agent', content: 'OK' })).toBe(true);
  });

  it('adapts profiles and provider credential status without exposing credential fragments', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list': `Profile          Model          Gateway      Alias\n ───────────────  ─────────────  ───────────  ─────\n ◆default         gpt-5.6-sol    running      —\n  test-agent      gpt-5.5        stopped      test-agent\n`,
        'profile describe default': 'Base operations Agent',
        'profile describe test-agent': "(no description set for 'test-agent')",
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
        description: 'Base operations Agent',
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

  it('maps the immutable default profile ID to the configured framework base-agent name', async () => {
    const output = ' ◆default         gpt-5.6-sol    running      —\n';
    for (const baseProfileDisplayName of ['Alica', 'Herman']) {
      const source = new HermesNativeSource({
        runner: new FixtureRunner({ 'profile list': output }),
        baseProfileDisplayName,
      });
      expect((await source.profiles()).items[0]).toMatchObject({
        id: 'default',
        displayName: baseProfileDisplayName,
      });
    }
    expect(validateBaseProfileDisplayName(' Herman ')).toBe('Herman');
    expect(() => validateBaseProfileDisplayName('invalid\nname')).toThrow(
      'Base profile display name is invalid',
    );
  });

  it('parses profile IDs that fill the native table column and leave one separator space', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list':
          ' Profile          Model                        Gateway      Alias        Distribution\n  alica-p7-canary —                            stopped      —            —\n',
        'profile describe alica-p7-canary': 'Governed canary',
      }),
    });
    await expect(source.profiles()).resolves.toMatchObject({
      items: [
        {
          id: 'alica-p7-canary',
          displayName: 'alica-p7-canary',
          active: false,
          gatewayStatus: 'stopped',
          description: 'Governed canary',
        },
      ],
    });
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

  it('reconciles a profile command error against authoritative native truth', async () => {
    let profiles = ' ◆default         gpt-5.6-sol    running      —\n';
    const runner: CommandRunner = {
      async run(args) {
        const command = args.join(' ');
        if (command === 'profile list') return profiles;
        if (command === 'profile describe default') return '(no description set)';
        if (command === 'profile describe recovered-agent') return 'Recovered Agent';
        if (command.startsWith('profile create recovered-agent ')) {
          profiles += '  recovered-agent gpt-5.6-sol    stopped      —\n';
          throw new Error('native command connection closed after apply');
        }
        throw new Error(`Missing fixture: ${command}`);
      },
    };
    const source = new HermesNativeSource({ runner });
    await expect(
      source.executeProfile({
        mode: 'execute',
        idempotencyKey: 'profile-create-reconciled',
        requestId: 'request-reconciled',
        correlationId: 'correlation-reconciled',
        actor: { type: 'service', id: 'unify-core' },
        operation: 'profile.create',
        targetId: 'recovered-agent',
        payload: { description: 'Recovered Agent' },
      }),
    ).resolves.toEqual({
      profile: {
        id: 'recovered-agent',
        created: true,
        reconciledAfterCommandError: true,
      },
    });
  });

  it('renames profiles natively, rejects occupied destinations, and supports safe replay', async () => {
    const rename = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list': ' ◆seed            gpt-5.6-sol    running      —\n',
        'profile rename seed alica': '',
      }),
    });
    await expect(
      rename.executeProfile({
        mode: 'execute',
        idempotencyKey: 'profile-rename-idempotency',
        requestId: 'request-rename',
        correlationId: 'correlation-rename',
        actor: { type: 'service', id: 'unify-core' },
        operation: 'profile.rename',
        targetId: 'seed',
        payload: { newId: 'alica' },
      }),
    ).resolves.toEqual({
      profile: { fromId: 'seed', id: 'alica', renamed: true, alreadyRenamed: false },
    });

    const replay = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list': ' ◆alica         gpt-5.6-sol    running      —\n',
      }),
    });
    await expect(
      replay.executeProfile({
        mode: 'execute',
        idempotencyKey: 'profile-rename-replay',
        requestId: 'request-replay',
        correlationId: 'correlation-replay',
        actor: { type: 'service', id: 'unify-core' },
        operation: 'profile.rename',
        targetId: 'seed',
        payload: { newId: 'alica' },
      }),
    ).resolves.toEqual({
      profile: { fromId: 'seed', id: 'alica', renamed: false, alreadyRenamed: true },
    });

    const conflict = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list':
          ' ◆seed            gpt-5.6-sol    running      —\n  alica           gpt-5.6-sol    stopped      —\n',
      }),
    });
    await expect(
      conflict.executeProfile({
        mode: 'execute',
        idempotencyKey: 'profile-rename-conflict',
        requestId: 'request-conflict',
        correlationId: 'correlation-conflict',
        actor: { type: 'service', id: 'unify-core' },
        operation: 'profile.rename',
        targetId: 'seed',
        payload: { newId: 'alica' },
      }),
    ).rejects.toThrow('destination already exists');

    const builtIn = new HermesNativeSource({
      runner: new FixtureRunner({
        'profile list': ' ◆default         gpt-5.6-sol    running      —\n',
      }),
    });
    await expect(
      builtIn.executeProfile({
        mode: 'execute',
        idempotencyKey: 'profile-rename-default',
        requestId: 'request-default',
        correlationId: 'correlation-default',
        actor: { type: 'service', id: 'unify-core' },
        operation: 'profile.rename',
        targetId: 'default',
        payload: { newId: 'alica' },
      }),
    ).rejects.toThrow('built-in default profile');
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

  it('treats starting an already-ready native task as reconciled idempotent success', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({
        'kanban --board alpha list --json --archived --sort updated': JSON.stringify([
          { id: 'task-1', title: 'Ready task', status: 'ready', priority: 50 },
        ]),
      }),
    });
    await expect(
      source.executeWork({
        mode: 'execute',
        idempotencyKey: 'start-ready-1',
        requestId: 'request-start-ready',
        correlationId: 'correlation-start-ready',
        actor: { type: 'user', id: 'user-1' },
        operation: 'task.start',
        targetId: 'task-1',
        payload: { boardId: 'alpha' },
      }),
    ).resolves.toMatchObject({ task: { id: 'task-1', status: 'ready' } });
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

  it('routes profile-bound sessions and bounded inline messages to the native API', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/sessions'))
        return Response.json({ session: { id: 's-new', source: 'api_server' } });
      if (url.endsWith('/api/sessions/s-1'))
        return Response.json({ session: { id: 's-1', source: 'api_server' } });
      if (url.endsWith('/api/sessions/s-1/chat'))
        return Response.json({ message: { id: 'm-new' } });
      return new Response('{}', { status: 404 });
    });
    const source = new HermesNativeSource({
      runner: new FixtureRunner({}),
      apiBaseUrl: 'https://hermes.test',
      fetchImpl,
    });
    const base = {
      mode: 'execute' as const,
      requestId: 'request-chat',
      correlationId: 'correlation-chat',
      actor: { type: 'service' as const, id: 'unify-core' },
    };
    await source.executeConversation({
      ...base,
      idempotencyKey: 'create-session-key',
      operation: 'session.create',
      targetId: 'new',
      payload: {
        title: 'Governed session',
        profileId: 'default',
        model: 'gpt-5.6-sol',
      },
    });
    await source.executeConversation({
      ...base,
      idempotencyKey: 'send-message-key',
      operation: 'message.send',
      targetId: 's-1',
      payload: {
        message: [
          { type: 'text', text: 'Inspect this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
        ],
      },
    });
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string | URL | Request, RequestInit | undefined]
    >;
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      title: 'Governed session',
      profile: 'default',
      model: 'gpt-5.6-sol',
    });
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
      message: [
        { type: 'text', text: 'Inspect this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
      ],
    });
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

  it('maps the existing Hermes management inventory and never exposes key environment names', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({}),
      managementBaseUrl: 'http://127.0.0.1:29119',
      managementToken: 'private-token',
      fetchImpl: async (input, init) => {
        expect(init?.headers).toMatchObject({ 'x-hermes-session-token': 'private-token' });
        return Response.json({
          provider: 'openrouter',
          model: 'openai/gpt-5',
          providers: [
            {
              slug: 'openrouter',
              name: 'OpenRouter',
              auth_type: 'api_key',
              authenticated: true,
              key_env: 'OPENROUTER_API_KEY',
              models: ['openai/gpt-5'],
              capabilities: { 'openai/gpt-5': { reasoning: true } },
            },
          ],
        });
      },
    });

    expect((await source.providers()).items[0]).toMatchObject({
      id: 'openrouter',
      authType: 'api_key',
      authMethod: 'api_key',
      credentialStatus: 'configured',
      connectionState: 'connected',
      setupSupported: true,
      credentialMutable: true,
      deploymentReadiness: 'ready',
      readinessReasonCodes: [],
      selected: true,
      modelCount: 1,
    });
    expect((await source.models()).items[0]).toMatchObject({
      id: 'openai/gpt-5',
      providerId: 'openrouter',
      selected: true,
    });
    expect(JSON.stringify(await source.providers())).not.toContain('OPENROUTER_API_KEY');
  });

  it('exposes truthful setup contracts and fails closed for non-generic providers', async () => {
    const source = new HermesNativeSource({
      runner: new FixtureRunner({}),
      managementBaseUrl: 'http://127.0.0.1:29119',
      managementToken: 'private-token',
      fetchImpl: async () =>
        Response.json({
          provider: '',
          model: '',
          providers: [
            { slug: 'openai-codex', name: 'OpenAI Codex', authenticated: false, models: [] },
            { slug: 'vertex', name: 'Google Vertex AI', authenticated: false, models: [] },
            { slug: 'moa', name: 'Mixture of Agents', authenticated: true, models: ['default'] },
            { slug: 'future-provider', name: 'Future Provider', authenticated: false, models: [] },
          ],
        }),
    });

    const items = (await source.providers()).items;
    expect(items.find((item) => item.id === 'openai-codex')).toMatchObject({
      authType: 'oauth',
      authMethod: 'oauth_device_code',
      credentialMutable: true,
      setupSupported: true,
      connectionState: 'disconnected',
      deploymentReadiness: 'needs_configuration',
    });
    expect(items.find((item) => item.id === 'vertex')).toMatchObject({
      authMethod: 'cloud_identity',
      credentialMutable: true,
      setupSupported: true,
      setupFields: expect.arrayContaining([
        expect.objectContaining({ id: 'project', type: 'project', secret: false }),
        expect.objectContaining({ id: 'credentials', type: 'secret_file', secret: true }),
      ]),
      prerequisites: expect.arrayContaining([
        expect.objectContaining({ id: 'google-adc', kind: 'cloud_identity', status: 'unknown' }),
        expect.objectContaining({ id: 'google-project', kind: 'provider', status: 'unknown' }),
      ]),
    });
    expect(items.find((item) => item.id === 'moa')).toMatchObject({
      authMethod: 'composite',
      credentialMutable: true,
      deploymentReadiness: 'needs_selection',
      readinessReasonCodes: ['NO_DEFAULT_MODEL_SELECTED'],
    });
    expect(items.find((item) => item.id === 'future-provider')).toMatchObject({
      authMethod: 'unknown',
      credentialMutable: false,
      setupSupported: false,
      deploymentReadiness: 'unsupported',
      readinessReasonCodes: ['SETUP_CONTRACT_UNKNOWN'],
    });
    expect(JSON.stringify(items)).not.toMatch(/API_KEY|TOKEN|secret-file-path/i);
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
