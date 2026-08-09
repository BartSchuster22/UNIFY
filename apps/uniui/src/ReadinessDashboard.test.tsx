import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { FrameworkProvider } from './FrameworkContext';
import { ReadinessDashboard } from './ReadinessDashboard';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);
const principal = {
  userId: 'u1',
  username: 'operator',
  displayName: 'Operator',
  roles: ['Administrator'],
  permissions: [
    'frameworks.read',
    'models.read',
    'profiles.read',
    'work.read',
    'chat.read',
    'memory.read',
  ],
};
const frameworks = [
  { frameworkId: 'hermes-alica', displayName: 'Alica', status: 'verified', enabled: true },
  { frameworkId: 'hermes-herman', displayName: 'Herman', status: 'verified', enabled: true },
];
const meta = {
  frameworkId: 'hermes-herman',
  frameworkVersion: '0.18.0',
  frameworkCommit: 'commit-herman',
  sourceVersion: 'sha256:owner',
  observedAt: '2026-08-09T00:00:00.000Z',
  freshness: 'current',
};

function implementation(path: string): Promise<unknown> {
  if (path === '/frameworks') return Promise.resolve({ items: frameworks });
  if (path === '/memory/status')
    return Promise.resolve({ status: 'ready', contractVersion: '1.0.0' });
  if (path.includes('/health'))
    return Promise.resolve({
      meta,
      data: {
        status: 'healthy',
        checks: { cli: { status: 'healthy' }, conversations: { status: 'healthy' } },
      },
    });
  if (path.includes('/capabilities'))
    return Promise.resolve({
      meta,
      data: {
        capabilities: {
          'work.execute': { status: 'supported' },
          'conversations.execute': { status: 'supported' },
        },
      },
    });
  if (path.includes('/providers'))
    return Promise.resolve({
      meta,
      items: [
        {
          id: 'openai-codex',
          displayName: 'OpenAI Codex',
          selected: true,
          credentialStatus: 'configured',
          authType: 'oauth',
        },
      ],
    });
  if (path.includes('/models'))
    return Promise.resolve({
      meta,
      items: [
        {
          id: 'gpt-5.6-sol',
          displayName: 'GPT-5.6 Sol',
          providerId: 'openai-codex',
          selected: true,
        },
      ],
    });
  if (path.includes('/profiles'))
    return Promise.resolve({
      meta,
      items: [
        {
          id: 'default',
          displayName: 'Herman',
          active: true,
          gatewayStatus: 'running',
          model: 'gpt-5.6-sol',
        },
      ],
    });
  throw new Error(`Unexpected request: ${path}`);
}

function renderDashboard(permissions = principal.permissions) {
  return render(
    <MantineProvider>
      <FrameworkProvider>
        <ReadinessDashboard principal={{ ...principal, permissions }} />
      </FrameworkProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/?view=overview&framework=hermes-herman');
  mockedApi.mockReset();
  mockedApi.mockImplementation(implementation as typeof api);
});

describe('ReadinessDashboard', () => {
  it('probes every readiness owner against the exact URL-selected framework', async () => {
    renderDashboard();
    expect(await screen.findByText('Overall readiness: Ready')).toBeInTheDocument();
    expect(screen.getByText('8/8')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Codex is credential-ready')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.6 Sol is selected')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 profiles have a running gateway')).toBeInTheDocument();
    expect(screen.getByText('MemoryV4 reports ready')).toBeInTheDocument();

    const paths = mockedApi.mock.calls.map(([path]) => path);
    expect(paths).toContain('/frameworks/hermes-herman/health');
    expect(paths).toContain('/frameworks/hermes-herman/capabilities');
    expect(paths).toContain('/frameworks/hermes-herman/providers?limit=500');
    expect(paths).toContain('/frameworks/hermes-herman/models?limit=500');
    expect(paths).toContain('/frameworks/hermes-herman/profiles?limit=500');
    expect(paths.some((path) => path.includes('/frameworks/hermes-alica/'))).toBe(false);
  });

  it('keeps independent owner failures visible instead of reporting false readiness', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path.includes('/providers')) throw new Error('Hermes provider inventory unavailable');
      return implementation(path);
    });
    renderDashboard();
    expect(await screen.findByText('Overall readiness: Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Hermes provider inventory unavailable')).toBeInTheDocument();
    expect(screen.getByText('7/8')).toBeInTheDocument();
  });

  it('reports capability and operator access blockers truthfully', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path.includes('/capabilities'))
        return {
          meta,
          data: {
            capabilities: {
              'work.execute': { status: 'unsupported', reasonCode: 'NO_NATIVE_WORK' },
              'conversations.execute': { status: 'forbidden', reasonCode: 'SCOPE_MISSING' },
            },
          },
        };
      return implementation(path);
    });
    renderDashboard(['frameworks.read']);
    expect(await screen.findByText('Overall readiness: Blocked')).toBeInTheDocument();
    expect(screen.getByText('reason=NO_NATIVE_WORK')).toBeInTheDocument();
    expect(screen.getByText('reason=SCOPE_MISSING')).toBeInTheDocument();
    expect(screen.getByText('4 read permissions are not granted')).toBeInTheDocument();
  });

  it('rechecks all authoritative probes on demand', async () => {
    renderDashboard();
    await screen.findByText('Overall readiness: Ready');
    const previous = mockedApi.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Recheck all' }));
    await waitFor(() => expect(mockedApi.mock.calls.length).toBeGreaterThan(previous + 6));
    expect(mockedApi.mock.calls.filter(([path]) => path === '/frameworks').length).toBeGreaterThan(
      1,
    );
  });
});
