import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsView } from './ModelsView';

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
      <ModelsView
        canManageCredentials={canManageCredentials}
        canManageModels={canManageModels}
      />
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
    expect(screen.getByLabelText('API credential')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(screen.queryByText(/Full model-catalog discovery is not advertised/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OPENROUTER_API_KEY|sha256:abcd|secret:\/\//i)).not.toBeInTheDocument();
  });

  it('sends a credential only in the governed mutation body and clears it after success', async () => {
    const fetchMock = fetchFixture();
    vi.stubGlobal('fetch', fetchMock);
    renderModels();
    const field = await screen.findByLabelText('API credential');
    fireEvent.change(field, { target: { value: 'test-secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) =>
          String(init?.body).includes('"credential":"test-secret-value"'),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(field).toHaveValue(''));
    expect(screen.queryByText('test-secret-value')).not.toBeInTheDocument();
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
    expect(await screen.findByText(/Provider credential changes are forbidden/)).toBeInTheDocument();
    expect(screen.getByLabelText('API credential')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
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
