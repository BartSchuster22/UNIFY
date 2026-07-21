import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  frameworkVersion: '0.2.0',
  frameworkCommit: 'a'.repeat(40),
  sourceVersion: 'providers:v1',
  observedAt: '2026-07-21T12:00:00.000Z',
  freshness: 'current' as const,
};
const capabilities = {
  meta,
  data: {
    capabilities: {
      'providers.read': { status: 'supported' },
      'providers.credentials.status': { status: 'supported' },
      'providers.credentials.execute': {
        status: 'unsupported',
        reasonCode: 'NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE',
      },
    },
  },
};
const providers = {
  meta,
  items: [
    {
      id: 'openai-codex',
      displayName: 'OpenAI Codex',
      credentialStatus: 'configured',
      selected: true,
      owner: 'hermes',
      frameworkId: 'hermes-main',
      sourceVersion: 'providers:v1',
      observedAt: meta.observedAt,
    },
    {
      id: 'openrouter',
      displayName: 'OpenRouter',
      credentialStatus: 'configured',
      selected: false,
      owner: 'hermes',
      frameworkId: 'hermes-main',
      sourceVersion: 'providers:v1',
      observedAt: meta.observedAt,
    },
  ],
  page: { hasMore: false },
};

function renderModels() {
  return render(
    <MantineProvider>
      <ModelsView canManageCredentials />
    </MantineProvider>,
  );
}

describe('Models/providers Hermes cutover', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?view=models'));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders secret-safe Hermes provider status and no DMM credential controls', async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
      if (url.includes('/capabilities')) return Response.json(capabilities);
      if (url.includes('/providers')) return Response.json(providers);
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModels();
    expect((await screen.findAllByText('OpenAI Codex')).length).toBeGreaterThan(0);
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getAllByText(/Auth: configured/)).toHaveLength(2);
    expect(screen.getByText(/Provider credential changes are disabled/)).toHaveTextContent(
      'NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE',
    );
    expect(screen.getByText(/Full model-catalog discovery is not advertised/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key|token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sha256:abcd|OPENAI_API_KEY|DMM vault/i)).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes('models/dmm-context')),
    ).toBe(false);
  });

  it('shows Hermes unavailability without a DMM fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
        return Response.json(
          {
            error: { code: 'FRAMEWORK_UNAVAILABLE', message: 'Hermes provider source unavailable' },
          },
          { status: 503 },
        );
      }),
    );
    renderModels();
    expect(await screen.findByText('Hermes provider source unavailable')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('OpenAI Codex')).not.toBeInTheDocument());
    expect(screen.queryByText(/DMM provider inventory/)).not.toBeInTheDocument();
  });
});
