import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { FrameworksView } from './FrameworksView';

vi.mock('./api', () => ({ api: vi.fn() }));
const mockedApi = vi.mocked(api);

beforeEach(() => {
  mockedApi.mockImplementation(async (path) => {
    if (path === '/frameworks')
      return {
        items: [
          {
            frameworkId: 'hermes-main',
            displayName: 'Hermes Main',
            baseUrl: 'http://127.0.0.1:28082',
            scopes: ['control:read', 'control:execute'],
            contractVersion: '1.0.0',
            frameworkVersion: '0.18.0',
            frameworkCommit: '9e54eee44f1c',
            status: 'verified',
            enabled: true,
          },
        ],
      } as never;
    if (path.endsWith('/health'))
      return {
        meta: {
          frameworkId: 'hermes-main',
          frameworkVersion: '0.18.0',
          frameworkCommit: '9e54eee44f1c',
          sourceVersion: 'sha256:health',
          observedAt: '2026-07-22T02:35:25.976Z',
        },
        data: {
          status: 'healthy',
          checks: { cli: { status: 'healthy' }, conversations: { status: 'healthy' } },
        },
      } as never;
    if (path.endsWith('/capabilities'))
      return {
        meta: {
          frameworkId: 'hermes-main',
          frameworkVersion: '0.18.0',
          frameworkCommit: '9e54eee44f1c',
          sourceVersion: 'sha256:capabilities',
          observedAt: '2026-07-22T02:35:25.976Z',
        },
        data: {
          capabilities: {
            'work.execute': { status: 'supported', modes: ['validate', 'dry-run', 'execute'] },
            'conversations.execute': {
              status: 'unsupported',
              reasonCode: 'NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE',
            },
          },
        },
      } as never;
    throw new Error(`Unexpected path ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderView() {
  return render(
    <MantineProvider>
      <FrameworksView />
    </MantineProvider>,
  );
}

describe('FrameworksView', () => {
  it('renders runtime health, capabilities and source evidence', async () => {
    renderView();
    expect(await screen.findByText('Hermes Main')).toBeInTheDocument();
    expect(screen.getByText('work.execute')).toBeInTheDocument();
    expect(screen.getByText('NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE')).toBeInTheDocument();
    expect(screen.getByText(/sha256:health/)).toBeInTheDocument();
    expect(screen.getByText(/conversations: healthy/)).toBeInTheDocument();
  });

  it('performs an explicit reconnect probe', async () => {
    renderView();
    await screen.findByText('Hermes Main');
    const before = mockedApi.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Recheck now' }));
    await waitFor(() => expect(mockedApi.mock.calls.length).toBeGreaterThan(before));
  });
});
