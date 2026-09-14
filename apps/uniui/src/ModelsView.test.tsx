import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsView } from './ModelsView';
import { FrameworkProvider } from './FrameworkContext';

const framework = {
  frameworkId: 'hermes-main',
  displayName: 'Main Hermes',
  status: 'verified',
  enabled: true,
};
const meta = {
  owner: 'hermes' as const,
  frameworkId: 'hermes-main',
  frameworkVersion: '0.20.0',
  frameworkCommit: 'a'.repeat(40),
  sourceVersion: 'catalogue:v1',
  observedAt: '2026-07-21T12:00:00.000Z',
  freshness: 'current' as const,
};
const supportedCapabilities = {
  meta,
  data: {
    capabilities: {
      'providers.read': { status: 'supported' },
      'providers.credentials.status': { status: 'supported' },
      'providers.credentials.execute': { status: 'supported' },
      'models.read': { status: 'supported' },
      'models.execute': { status: 'supported' },
    },
  },
};
const providers = {
  meta,
  items: [
    {
      id: 'openrouter',
      displayName: 'OpenRouter',
      credentialStatus: 'configured',
      selected: true,
      authType: 'api_key',
      authMethod: 'api_key',
      credentialMutable: true,
      setupSupported: true,
      setupFields: [
        { id: 'credential', label: 'API key', type: 'secret', required: true, secret: true },
      ],
      prerequisites: [],
      connectionState: 'connected',
      deploymentReadiness: 'ready',
      readinessReasonCodes: [],
      modelCount: 2,
      owner: 'hermes',
      frameworkId: 'hermes-main',
      sourceVersion: 'catalogue:v1',
      observedAt: meta.observedAt,
    },
  ],
  page: { hasMore: false },
};
const models = {
  meta,
  items: [
    {
      id: 'openai/gpt-5',
      providerId: 'openrouter',
      displayName: 'openai/gpt-5',
      capabilities: ['text', 'tool-use'],
      selected: true,
      costTier: 'standard',
      owner: 'hermes',
      frameworkId: 'hermes-main',
      sourceVersion: 'catalogue:v1',
      observedAt: meta.observedAt,
    },
    {
      id: 'anthropic/claude-premium',
      providerId: 'openrouter',
      displayName: 'Claude Premium',
      capabilities: ['text', 'tool-use', 'vision'],
      selected: false,
      costTier: 'premium',
      owner: 'hermes',
      frameworkId: 'hermes-main',
      sourceVersion: 'catalogue:v1',
      observedAt: meta.observedAt,
    },
  ],
  page: { hasMore: false },
};

function renderModels(canManageCredentials = true, canManageModels = true) {
  return render(
    <MantineProvider>
      <FrameworkProvider>
        <ModelsView canManageCredentials={canManageCredentials} canManageModels={canManageModels} />
      </FrameworkProvider>
    </MantineProvider>,
  );
}

function fetchFixture(capabilities = supportedCapabilities) {
  return vi.fn(async (request: string | URL | Request, _init?: RequestInit) => {
    void _init;
    const url = String(request);
    if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
    if (url.includes('/capabilities')) return Response.json(capabilities);
    if (url.includes('/providers')) return Response.json(providers);
    if (url.includes('/models')) return Response.json(models);
    if (url.endsWith('/api/v1/mutations'))
      return Response.json(
        {
          replayed: false,
          operation: {
            operationId: 'operation-1',
            operationType: 'provider.credential.set',
            state: 'verified',
            mode: 'execute',
            updatedAt: new Date().toISOString(),
          },
          result: {},
        },
        { status: 201 },
      );
    return Response.json({}, { status: 404 });
  });
}

describe('Models/providers Hermes management', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?view=models'));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the real Hermes catalogue and role-gated management controls', async () => {
    const fetchMock = fetchFixture();
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    expect((await screen.findAllByText('OpenRouter')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('openai/gpt-5').length).toBeGreaterThan(0);
    expect(screen.getByText('Connection: connected')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guided provider setup' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Update credential' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove credential' })).toBeEnabled();
    expect(screen.queryByLabelText(/API credential for/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Full model-catalog discovery is not advertised/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/OPENROUTER_API_KEY|sha256:abcd|secret:\/\//i),
    ).not.toBeInTheDocument();
  });

  it('guides a credential through confirmation, governed dry-run, execute, and secure clearing', async () => {
    const fetchMock = fetchFixture();
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    fireEvent.click(await screen.findByRole('button', { name: 'Guided provider setup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    const field = await screen.findByLabelText('API credential for OpenRouter');
    fireEvent.change(field, { target: { value: 'test-secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('checkbox'));

    const execute = screen.getByRole('button', { name: 'Save in Hermes' });
    expect(execute).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    expect(await screen.findByText(/Governed dry-run passed/)).toBeInTheDocument();
    expect(execute).toBeEnabled();
    fireEvent.click(execute);

    expect(await screen.findByText(/configured in Hermes and verified/)).toBeInTheDocument();
    expect(screen.queryByText('test-secret-value')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API credential for OpenRouter')).not.toBeInTheDocument();

    const mutationCalls = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/api/v1/mutations'))
      .map(([, init]) => ({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
      }));
    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls.map(({ body }) => body.mode)).toEqual(['dry-run', 'execute']);
    for (const { body } of mutationCalls) {
      expect(body).toMatchObject({
        operationType: 'provider.credential.set',
        target: {
          owner: 'hermes',
          kind: 'provider',
          nativeId: 'openrouter',
          frameworkId: 'hermes-main',
        },
        payload: {
          credential: 'test-secret-value',
          expectedSourceVersion: 'catalogue:v1',
        },
        confirmed: true,
      });
    }
    expect(mutationCalls[0]?.idempotencyKey).toBeTruthy();
    expect(mutationCalls[1]?.idempotencyKey).toBeTruthy();
    expect(mutationCalls[0]?.idempotencyKey).not.toBe(mutationCalls[1]?.idempotencyKey);
  });

  it('guides an exact premium model through acknowledgement, dry-run, and verified selection', async () => {
    const fetchMock = fetchFixture();
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    fireEvent.click(await screen.findByRole('button', { name: 'Guided model selection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Claude Premium')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText(/Cost tier/)).toHaveTextContent('premium');
    expect(screen.getByText(/Existing sessions keep their current model/)).toBeInTheDocument();
    const execute = screen.getByRole('button', { name: 'Select in Hermes' });
    expect(execute).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /authorize this model selection and acknowledge that provider pricing may differ/i,
      }),
    );
    expect(execute).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    expect(
      await screen.findByText(/Governed dry-run passed for this exact framework/),
    ).toBeInTheDocument();
    expect(execute).toBeEnabled();
    fireEvent.click(execute);

    expect(
      await screen.findByText(/selected in Hermes and verified by authoritative readback/),
    ).toBeInTheDocument();
    const calls = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/api/v1/mutations'))
      .map(([, init]) => ({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        key: new Headers(init?.headers).get('Idempotency-Key'),
      }));
    expect(calls).toHaveLength(2);
    expect(calls.map(({ body }) => body.mode)).toEqual(['dry-run', 'execute']);
    for (const { body } of calls)
      expect(body).toMatchObject({
        operationType: 'model.select',
        target: {
          owner: 'hermes',
          kind: 'model',
          nativeId: 'anthropic/claude-premium',
          frameworkId: 'hermes-main',
        },
        payload: {
          providerId: 'openrouter',
          confirmExpensiveModel: true,
          expectedSourceVersion: 'catalogue:v1',
        },
        confirmed: true,
      });
    expect(calls[0]?.key).toBeTruthy();
    expect(calls[1]?.key).toBeTruthy();
    expect(calls[0]?.key).not.toBe(calls[1]?.key);
  });

  it('runs the unified persona-to-inference deployment wizard with exact governed evidence', async () => {
    const base = fetchFixture();
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      if (String(request).endsWith('/api/v1/mutations')) {
        const body = JSON.parse(String(init?.body)) as { operationType: string; mode: string };
        return Response.json(
          {
            replayed: false,
            operation: {
              operationId: crypto.randomUUID(),
              operationType: body.operationType,
              state: 'verified',
              mode: body.mode,
              updatedAt: new Date().toISOString(),
            },
            result:
              body.operationType === 'provider.inference.test'
                ? { succeeded: true, sessionId: 'smoke-session-1' }
                : {},
          },
          { status: 201 },
        );
      }
      return base(request, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy a model' }));
    expect(await screen.findByText('Unified model deployment')).toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('input')).toHaveValue('Main Hermes');
    fireEvent.click(screen.getByRole('button', { name: 'Choose provider' }));
    expect(screen.getByRole('dialog').querySelector('input')).toHaveValue(
      'OpenRouter · configured',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and connect' }));
    expect(await screen.findByText(/Provider connection verified/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Discover models' })
        .find((button) => button.closest('[role="dialog"]'))!,
    );
    expect(await screen.findByText(/Hermes discovered 2 model/)).toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('input[role="combobox"]')).toHaveValue(
      'openai/gpt-5 · standard',
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /authorize this exact default-model change/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select default and verify readback' }));
    expect(await screen.findByText(/Authoritative readback confirmed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run inference smoke test' }));
    expect(await screen.findByText('Deployment verified')).toBeInTheDocument();
    expect(screen.getByText(/smoke-session-1/)).toBeInTheDocument();

    const calls = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/api/v1/mutations'))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(calls.map((call) => call.operationType)).toEqual([
      'provider.validate',
      'provider.models.refresh',
      'model.select',
      'model.select',
      'provider.inference.test',
    ]);
    expect(calls.map((call) => call.mode)).toEqual([
      'execute',
      'execute',
      'dry-run',
      'execute',
      'execute',
    ]);
    for (const call of calls)
      expect(call).toMatchObject({
        target: { owner: 'hermes', frameworkId: 'hermes-main' },
        confirmed: true,
      });
  });

  it('fails a stale model dry-run closed and retries with fresh governed operation keys', async () => {
    const base = fetchFixture();
    let mutationAttempt = 0;
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      if (String(request).endsWith('/api/v1/mutations')) {
        mutationAttempt += 1;
        if (mutationAttempt === 1)
          return Response.json(
            { error: { code: 'CONFLICT', message: 'Model catalogue changed in Hermes' } },
            { status: 409 },
          );
      }
      return base(request, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    fireEvent.click(await screen.findByRole('button', { name: 'Guided model selection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const acknowledgement = screen.getByRole('checkbox', {
      name: /authorize this model selection/i,
    });
    fireEvent.click(acknowledgement);
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));

    expect(await screen.findByText(/Model catalogue changed in Hermes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select in Hermes' })).toBeDisabled();
    expect(acknowledgement).not.toBeChecked();

    fireEvent.click(acknowledgement);
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    expect(
      await screen.findByText(/Governed dry-run passed for this exact framework/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select in Hermes' }));
    expect(await screen.findByText(/selected in Hermes and verified/)).toBeInTheDocument();

    const keys = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/api/v1/mutations'))
      .map(([, request]) => new Headers(request?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it('clears a credential and fails closed when the governed dry-run conflicts', async () => {
    const base = fetchFixture();
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      if (String(request).endsWith('/api/v1/mutations'))
        return Response.json(
          { error: { code: 'CONFLICT', message: 'Provider inventory changed in Hermes' } },
          { status: 409 },
        );
      return base(request, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    fireEvent.click(await screen.findByRole('button', { name: 'Guided provider setup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('API credential for OpenRouter'), {
      target: { value: 'must-be-cleared' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));

    expect(await screen.findByText(/Provider inventory changed in Hermes/)).toBeInTheDocument();
    expect(screen.getByLabelText('API credential for OpenRouter')).toHaveValue('');
    expect(screen.queryByText('must-be-cleared')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save in Hermes' })).not.toBeInTheDocument();
  });

  it('keeps management controls disabled when capability or RBAC denies execution', async () => {
    const denied = {
      ...supportedCapabilities,
      data: {
        capabilities: {
          ...supportedCapabilities.data.capabilities,
          'providers.credentials.execute': {
            status: 'forbidden',
            reasonCode: 'SCOPE_NOT_CONFIGURED',
          },
          'models.execute': { status: 'forbidden', reasonCode: 'SCOPE_NOT_CONFIGURED' },
        },
      },
    };
    vi.stubGlobal('fetch', fetchFixture(denied));
    renderModels(false, false);
    expect(
      await screen.findByText(/Provider credential changes are forbidden/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guided provider setup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guided model selection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update credential' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove credential' })).toBeDisabled();
  });

  it('routes every guided read and write to URL-selected Herman with Alica also registered', async () => {
    window.history.replaceState(null, '', '/?view=models&framework=hermes-herman');
    const frameworks = [
      { frameworkId: 'hermes-alica', displayName: 'Alica', status: 'verified', enabled: true },
      { frameworkId: 'hermes-herman', displayName: 'Herman', status: 'verified', enabled: true },
    ];
    const hermanMeta = { ...meta, frameworkId: 'hermes-herman', sourceVersion: 'herman:v4' };
    const fetchMock = vi.fn(async (request: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(request);
      if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: frameworks });
      if (url.includes('/frameworks/hermes-herman/capabilities'))
        return Response.json({ ...supportedCapabilities, meta: hermanMeta });
      if (url.includes('/frameworks/hermes-herman/providers'))
        return Response.json({
          meta: hermanMeta,
          items: providers.items.map((provider) => ({
            ...provider,
            frameworkId: 'hermes-herman',
            sourceVersion: 'herman:v4',
          })),
          page: { hasMore: false },
        });
      if (url.includes('/frameworks/hermes-herman/models'))
        return Response.json({
          meta: hermanMeta,
          items: models.items.map((model) => ({
            ...model,
            frameworkId: 'hermes-herman',
            sourceVersion: 'herman:v4',
          })),
          page: { hasMore: false },
        });
      if (url.endsWith('/api/v1/mutations'))
        return Response.json(
          {
            replayed: false,
            operation: {
              operationId: 'herman-dry-run',
              operationType: 'provider.credential.set',
              state: 'verified',
              mode: 'dry-run',
              updatedAt: new Date().toISOString(),
            },
            result: {},
          },
          { status: 201 },
        );
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModels();

    fireEvent.click(await screen.findByRole('button', { name: 'Guided provider setup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('API credential for OpenRouter'), {
      target: { value: 'herman-only-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    await screen.findByText(/Governed dry-run passed/);

    const requests = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requests.some((url) => url.includes('/frameworks/hermes-alica/'))).toBe(false);
    const mutationInit = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/api/v1/mutations'),
    )?.[1];
    expect(JSON.parse(String(mutationInit?.body))).toMatchObject({
      target: { frameworkId: 'hermes-herman', nativeId: 'openrouter' },
      payload: { expectedSourceVersion: 'herman:v4', credential: 'herman-only-secret' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close provider setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guided model selection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /authorize this model selection/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    await screen.findByText(/Governed dry-run passed for this exact framework/);

    const mutationBodies = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/api/v1/mutations'))
      .map(([, request]) => JSON.parse(String(request?.body)) as Record<string, unknown>);
    expect(mutationBodies.at(-1)).toMatchObject({
      operationType: 'model.select',
      target: {
        owner: 'hermes',
        kind: 'model',
        frameworkId: 'hermes-herman',
        nativeId: 'anthropic/claude-premium',
      },
      payload: {
        providerId: 'openrouter',
        expectedSourceVersion: 'herman:v4',
        confirmExpensiveModel: true,
      },
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/frameworks/hermes-alica/')),
    ).toBe(false);
  });

  it('runs a device-code OAuth authorization without receiving provider tokens', async () => {
    const oauthProvider = {
      ...providers.items[0],
      id: 'nous',
      displayName: 'Nous Portal',
      credentialStatus: 'missing',
      selected: false,
      authType: 'oauth',
      authMethod: 'oauth_device_code',
      setupFields: [],
      connectionState: 'disconnected',
      deploymentReadiness: 'needs_configuration',
      modelCount: 0,
    };
    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
      if (url.includes('/capabilities')) return Response.json(supportedCapabilities);
      if (url.includes('/providers'))
        return Response.json({ ...providers, items: [oauthProvider] });
      if (url.includes('/models')) return Response.json({ ...models, items: [] });
      if (url.endsWith('/api/v1/mutations')) {
        const body = JSON.parse(String(init?.body)) as { operationType: string };
        const result =
          body.operationType === 'provider.oauth.start'
            ? {
                status: 'pending',
                session_id: 'session-1',
                user_code: 'ABCD-EFGH',
                verification_url: 'https://provider.example/device',
                expires_in: 900,
              }
            : { status: 'pending' };
        return Response.json({
          replayed: false,
          operation: {
            operationId: 'oauth-operation',
            operationType: body.operationType,
            state: 'verified',
            mode: 'execute',
            updatedAt: new Date().toISOString(),
          },
          result: { meta: { owner: 'hermes', frameworkId: 'hermes-main' }, data: { status: 'succeeded', result } },
        });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModels();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect OAuth' }));
    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open authorization page' })).toHaveAttribute(
      'href',
      'https://provider.example/device',
    );
    const start = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/api/v1/mutations'))
      .map(([, request]) => JSON.parse(String(request?.body)) as Record<string, unknown>)
      .find((body) => body.operationType === 'provider.oauth.start');
    expect(start).toMatchObject({
      target: { nativeId: 'nous', frameworkId: 'hermes-main' },
      payload: { expectedSourceVersion: 'catalogue:v1' },
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/access_token|refresh_token/);
  });

  it('shows Hermes unavailability without a fallback catalogue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        if (String(request).endsWith('/api/v1/frameworks'))
          return Response.json({ items: [framework] });
        return Response.json(
          { error: { code: 'FRAMEWORK_UNAVAILABLE', message: 'Hermes model source unavailable' } },
          { status: 503 },
        );
      }),
    );
    renderModels();
    expect(await screen.findByText('Hermes model source unavailable')).toBeInTheDocument();
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument();
  });
});
