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
      credentialMutable: true,
      modelCount: 1,
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
    expect(screen.getByText('Auth: configured')).toBeInTheDocument();
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
