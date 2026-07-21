import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateway } from './api';
import { ModelsView } from './ModelsView';

const dmm = {
  providers: {
    ok: true,
    data: {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          authMethod: 'api_key',
          status: 'healthy',
          credentialStatus: 'saved',
          credentialFingerprint: 'sha256:abcd',
          modelCount: 2,
          harnesses: ['hermes'],
          updatedAt: '2026-07-20T10:00:00Z',
        },
        {
          id: 'local',
          label: 'Local Models',
          authMethod: 'framework_managed',
          status: 'available',
          credentialStatus: 'unsupported',
          modelCount: 1,
          harnesses: ['hermes'],
          updatedAt: '2026-07-20T10:00:00Z',
        },
      ],
    },
  },
  requirements: {
    ok: true,
    data: {
      requirements: [
        {
          providerId: 'openai',
          label: 'OpenAI',
          authMethod: 'api_key',
          status: 'healthy',
          credentialStatus: 'saved',
          requiredEnvVars: ['OPENAI_API_KEY'],
          configuredEnvVars: ['OPENAI_API_KEY'],
          credentialPoolCount: 1,
          harnesses: [
            {
              harnessId: 'hermes',
              status: 'healthy',
              discoverySupported: true,
              credentialInstallSupported: true,
              modelCount: 2,
            },
          ],
          updatedAt: '2026-07-20T10:00:00Z',
        },
      ],
    },
  },
  credentials: {
    ok: true,
    data: {
      credentials: [
        {
          providerId: 'openai',
          scope: 'global',
          status: 'healthy',
          fingerprint: 'sha256:abcd',
          lastValidatedAt: '2026-07-20T10:00:00Z',
          updatedAt: '2026-07-20T10:00:00Z',
        },
      ],
    },
  },
  models: {
    ok: true,
    data: {
      models: [
        {
          id: 'openai/gpt-5.6',
          providerId: 'openai',
          displayName: 'GPT 5.6',
          modality: 'text',
          contextWindow: 200000,
          status: 'configured_default',
          harnesses: ['hermes'],
          updatedAt: '2026-07-20T10:00:00Z',
        },
        {
          id: 'openai/gpt-5.5',
          providerId: 'openai',
          displayName: 'GPT 5.5',
          modality: 'text',
          status: 'available',
          harnesses: ['hermes'],
          updatedAt: '2026-07-20T10:00:00Z',
        },
        {
          id: 'local/qwen',
          providerId: 'local',
          displayName: 'Qwen Local',
          modality: 'text',
          status: 'unavailable',
          harnesses: ['hermes'],
          updatedAt: '2026-07-20T10:00:00Z',
        },
      ],
    },
  },
  normalizedState: {
    ok: true,
    data: {
      providers: [
        {
          providerId: 'openai',
          label: 'OpenAI',
          authMethod: 'api_key',
          dmmProviderStatus: 'healthy',
          dmmCredentialStatus: 'saved',
          dmmCredentialFingerprint: 'sha256:abcd',
          externalSource: 'hermes',
          modelCount: 2,
          harnessStates: [
            {
              harnessId: 'hermes',
              status: 'healthy',
              discoverySupported: true,
              credentialInstallSupported: true,
              modelCount: 2,
            },
          ],
          updatedAt: '2026-07-20T10:00:00Z',
        },
        {
          providerId: 'local',
          label: 'Local Models',
          authMethod: 'framework_managed',
          dmmProviderStatus: 'available',
          dmmCredentialStatus: 'unsupported',
          externalSource: 'hermes',
          modelCount: 1,
          harnessStates: [],
          updatedAt: '2026-07-20T10:00:00Z',
        },
      ],
    },
  },
};

function renderModels(canManageCredentials = true) {
  return render(
    <MantineProvider>
      <ModelsView canManageCredentials={canManageCredentials} />
    </MantineProvider>,
  );
}

describe('UNIFY Models & Providers', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=models');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(dmm), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    vi.spyOn(gateway, 'mutate').mockResolvedValue({
      result: { valid: true },
      operation: { id: 'op-dmm' },
    } as never);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows DMM provider and available-model summaries and opens provider detail', async () => {
    renderModels();
    expect(await screen.findByText('Total models available')).toBeInTheDocument();
    expect(screen.getByText('3 models reported in total')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open OpenAI provider details' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open OpenAI provider details' }));
    expect(await screen.findByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Available provider models' })).toBeInTheDocument();
    expect(screen.getByText('GPT 5.6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'API keys / Auth setup' })).toBeInTheDocument();
  });

  it('lists every DMM model on the Models page with truthful summaries', async () => {
    renderModels();
    await screen.findByText('Total models available');
    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    expect(await screen.findByRole('heading', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByText('GPT 5.6')).toBeInTheDocument();
    expect(screen.getByText('GPT 5.5')).toBeInTheDocument();
    expect(screen.getByText('Qwen Local')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
  });

  it('dry-runs the exact API key before enabling governed activation', async () => {
    window.history.replaceState(null, '', '/?view=models&provider=openai');
    renderModels();
    expect(
      await screen.findByRole('heading', { name: 'API keys / Auth setup' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('API key / token'), {
      target: { value: 'test-provider-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run key dry-run' }));
    await waitFor(() =>
      expect(gateway.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'dmm.credential.save',
          mode: 'dry-run',
          payload: { secret: 'test-provider-key' },
        }),
      ),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm activation or rotation/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate / rotate provider key' }));
    await waitFor(() =>
      expect(gateway.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'dmm.credential.save',
          mode: 'execute',
          payload: { secret: 'test-provider-key' },
        }),
      ),
    );
  });
});
