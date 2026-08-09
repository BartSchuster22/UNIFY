import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const principal = {
  userId: 'u1',
  username: 'operator',
  displayName: 'Ada Operator',
  roles: ['Administrator'],
  permissions: [
    'frameworks.read',
    'models.read',
    'profiles.read',
    'work.read',
    'chat.read',

    'audit.read',
    'operations.read',
  ],
};
const meta = {
  requestId: 'r1',
  correlationId: 'r1',
  source: { owner: 'gateway', adapterId: 'test' },
  sourceStatus: 'observed',
  freshness: 'current',
  generatedAt: '2026-07-19T00:00:00.000Z',
  warnings: [],
  page: { hasMore: false },
};
const hermesMeta = {
  frameworkId: 'hermes-main',
  frameworkVersion: '0.18.0',
  frameworkCommit: '9e54eee44f1c',
  sourceVersion: 'sha256:native',
  observedAt: '2026-07-19T00:00:00.000Z',
  freshness: 'current',
};
const twoFrameworks = [
  {
    frameworkId: 'hermes-alica',
    displayName: 'Alica',
    status: 'verified',
    enabled: true,
  },
  {
    frameworkId: 'hermes-herman',
    displayName: 'Herman',
    status: 'verified',
    enabled: true,
  },
];

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function authenticatedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.endsWith('/auth/me')) return response(principal);
  if (url.endsWith('/memory/status'))
    return response({ status: 'ready', contractVersion: '1.0.0' });
  if (url.endsWith('/memory/capabilities'))
    return response({
      service: 'memoryv4-core',
      contract_version: '1.0.0',
      api_style: 'unversioned-v1',
      architecture: {},
      operations: [],
    });
  if (url.includes('/memory/records')) return response({ records: [], next_cursor: null });
  if (url.includes('/memory/entities')) return response({ entities: [], next_cursor: null });
  if (url.includes('/memory/relations')) return response({ relations: [], next_cursor: null });
  if (url.includes('/memory/artifacts')) return response({ artifacts: [], next_cursor: null });
  if (url.endsWith('/frameworks'))
    return response({
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
    });
  if (url.includes('/frameworks/hermes-main/health'))
    return response({
      meta: hermesMeta,
      data: {
        status: 'healthy',
        checks: { cli: { status: 'healthy' }, conversations: { status: 'healthy' } },
      },
    });
  if (url.includes('/frameworks/hermes-main/capabilities'))
    return response({
      meta: hermesMeta,
      data: {
        capabilities: {
          'conversations.sessions.read': { status: 'supported', modes: ['read'] },
          'conversations.execute': { status: 'unsupported', reasonCode: 'NO_INTERFACE' },
        },
      },
    });
  if (url.includes('/frameworks/hermes-main/profiles'))
    return response({
      meta: hermesMeta,
      page: { hasMore: false },
      items: [{ id: 'default', displayName: 'Herman', active: true, model: 'gpt-5.6-sol' }],
    });
  if (url.includes('/conversations/sessions/s1/messages'))
    return response({
      meta: hermesMeta,
      page: { hasMore: false },
      items: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: 'Verified response',
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    });
  if (url.includes('/conversations/sessions'))
    return response({
      meta: hermesMeta,
      page: { hasMore: false },
      items: [
        {
          id: 'external',
          title: 'Excluded external conversation',
          source: 'telegram',
        },
        {
          id: 's1',
          title: 'Operator chat',
          source: 'api_server',
          updatedAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    });
  if (url.includes('/notifications')) return response({ items: [], meta });
  if (url.includes('/operations')) return response({ items: [], meta });
  return response({ items: [], meta });
}

function twoFrameworkFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.endsWith('/auth/me')) return response(principal);
  if (url.endsWith('/frameworks')) return response({ items: twoFrameworks });
  const selectedMeta = { ...hermesMeta, owner: 'hermes', frameworkId: 'hermes-herman' };
  if (url.includes('/frameworks/hermes-herman/capabilities'))
    return response({
      meta: selectedMeta,
      data: {
        capabilities: {
          'profiles.execute': { status: 'supported' },
          'providers.credentials.execute': { status: 'supported' },
          'models.execute': { status: 'supported' },
        },
      },
    });
  if (url.includes('/frameworks/hermes-herman/providers'))
    return response({ meta: selectedMeta, items: [], page: { hasMore: false } });
  if (url.includes('/frameworks/hermes-herman/models'))
    return response({ meta: selectedMeta, items: [], page: { hasMore: false } });
  if (url.includes('/frameworks/hermes-herman/profiles'))
    return response({
      meta: selectedMeta,
      items: [
        {
          id: 'default',
          displayName: 'Default',
          active: true,
          gatewayStatus: 'running',
          owner: 'hermes',
          frameworkId: 'hermes-herman',
          sourceVersion: 'profiles:v1',
          observedAt: selectedMeta.observedAt,
        },
      ],
      page: { hasMore: false },
    });
  return response({ items: [], meta });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Mantine UNIUI gates', () => {
  it('presents an accessible named-user login when unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        response(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } },
          401,
        ),
      ),
    );
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome to UNIFY' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Username/ })).toHaveFocus();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('renders the permission-aware responsive shell', async () => {
    vi.stubGlobal('fetch', vi.fn(authenticatedFetch));
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Control plane' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.queryByText('Safety actions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle navigation' })).toBeInTheDocument();

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('shows Safety actions for an operation-specific framework grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/auth/me')
          ? response({ ...principal, permissions: [...principal.permissions, 'frameworks.manage'] })
          : authenticatedFetch(input),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Control plane' });
    expect(screen.getByText('Safety actions')).toBeInTheDocument();
  });

  it('gates the MemoryV4 read surface with memory.read', async () => {
    vi.stubGlobal('fetch', vi.fn(authenticatedFetch));
    const first = render(<App />);
    await screen.findByRole('heading', { name: 'Control plane' });
    expect(screen.queryByText('Memory & knowledge')).not.toBeInTheDocument();
    first.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/auth/me')
          ? response({ ...principal, permissions: [...principal.permissions, 'memory.read'] })
          : authenticatedFetch(input),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Control plane' });
    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    await userEvent.click(screen.getByText('Memory & knowledge'));
    expect(await screen.findByRole('heading', { name: 'Memory & knowledge' })).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Read-only role' })).toBeInTheDocument();
    expect(screen.queryByText('Governed editing', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('announces a truthful empty framework registry instead of hiding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/frameworks') ? response({ items: [] }) : authenticatedFetch(input),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Control plane' });
    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    await userEvent.click(await screen.findByText('Frameworks'));
    expect(await screen.findByText('No framework registered')).toBeInTheDocument();
  });

  it('renders Hermes-native internal conversation evidence and excludes external sessions', async () => {
    vi.stubGlobal('fetch', vi.fn(authenticatedFetch));
    render(<App />);
    await screen.findByRole('heading', { name: 'Control plane' });
    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    await userEvent.click(await screen.findByText('Chat'));
    expect(
      await screen.findByRole('heading', { name: 'Internal conversations' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Verified response')).toBeInTheDocument();
    expect(screen.queryByText('Excluded external conversation')).not.toBeInTheDocument();
  });

  it('preserves one verified framework selection across Models and Profiles', async () => {
    window.history.replaceState(null, '', '/?view=models&framework=hermes-herman');
    const fetchMock = vi.fn(twoFrameworkFetch);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Models & Providers' })).toBeInTheDocument();
    await screen.findByText('Framework hermes-herman');
    await userEvent.click(screen.getByText('Profiles'));
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    await screen.findByText('Framework hermes-herman');

    const requests = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requests.filter((url) => url.endsWith('/frameworks'))).toHaveLength(1);
    expect(requests.some((url) => url.includes('/frameworks/hermes-herman/providers'))).toBe(true);
    expect(requests.some((url) => url.includes('/frameworks/hermes-herman/profiles'))).toBe(true);
    expect(requests.some((url) => url.includes('/frameworks/hermes-alica/'))).toBe(false);
    expect(new URL(window.location.href).searchParams.get('framework')).toBe('hermes-herman');
    expect(screen.getByText(/Profile changes are read-only for your role/)).toBeInTheDocument();
  });

  it('passes models.manage through the shell to enable the guided model workflow', async () => {
    window.history.replaceState(null, '', '/?view=models&framework=hermes-herman');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me'))
          return response({
            ...principal,
            permissions: [...principal.permissions, 'models.manage'],
          });
        if (url.includes('/frameworks/hermes-herman/providers'))
          return response({
            meta: { ...hermesMeta, owner: 'hermes', frameworkId: 'hermes-herman' },
            items: [
              {
                id: 'openrouter',
                displayName: 'OpenRouter',
                credentialStatus: 'configured',
                selected: true,
                authType: 'api_key',
                credentialMutable: true,
                owner: 'hermes',
                frameworkId: 'hermes-herman',
                sourceVersion: 'models:v4',
                observedAt: hermesMeta.observedAt,
              },
            ],
            page: { hasMore: false },
          });
        if (url.includes('/frameworks/hermes-herman/models'))
          return response({
            meta: { ...hermesMeta, owner: 'hermes', frameworkId: 'hermes-herman' },
            items: [
              {
                id: 'anthropic/claude-premium',
                providerId: 'openrouter',
                displayName: 'Claude Premium',
                capabilities: ['text'],
                selected: false,
                costTier: 'premium',
                owner: 'hermes',
                frameworkId: 'hermes-herman',
                sourceVersion: 'models:v4',
                observedAt: hermesMeta.observedAt,
              },
            ],
            page: { hasMore: false },
          });
        return twoFrameworkFetch(input);
      }),
    );
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Guided model selection' })).toBeEnabled();
    expect(
      screen.queryByText(/Model selection is read-only for your role/),
    ).not.toBeInTheDocument();
  });

  it('passes credentials.manage through the shell to enable the guided provider workflow', async () => {
    window.history.replaceState(null, '', '/?view=models&framework=hermes-herman');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me'))
          return response({
            ...principal,
            permissions: [...principal.permissions, 'credentials.manage'],
          });
        if (url.includes('/frameworks/hermes-herman/providers'))
          return response({
            meta: { ...hermesMeta, owner: 'hermes', frameworkId: 'hermes-herman' },
            items: [
              {
                id: 'openrouter',
                displayName: 'OpenRouter',
                credentialStatus: 'missing',
                selected: false,
                authType: 'api_key',
                credentialMutable: true,
                owner: 'hermes',
                frameworkId: 'hermes-herman',
                sourceVersion: 'providers:v3',
                observedAt: hermesMeta.observedAt,
              },
            ],
            page: { hasMore: false },
          });
        return twoFrameworkFetch(input);
      }),
    );
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Guided provider setup' })).toBeEnabled();
    expect(
      screen.queryByText(/Provider credentials are read-only for your role/),
    ).not.toBeInTheDocument();
  });

  it('passes profiles.manage through the shell to enable supported named-profile actions', async () => {
    window.history.replaceState(null, '', '/?view=profiles&framework=hermes-herman');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me'))
          return response({
            ...principal,
            permissions: [...principal.permissions, 'profiles.manage'],
          });
        if (url.includes('/frameworks/hermes-herman/profiles'))
          return response({
            meta: { ...hermesMeta, owner: 'hermes', frameworkId: 'hermes-herman' },
            items: [
              {
                id: 'seed',
                displayName: 'Seed',
                active: true,
                gatewayStatus: 'running',
                owner: 'hermes',
                frameworkId: 'hermes-herman',
                sourceVersion: 'profiles:v7',
                observedAt: hermesMeta.observedAt,
              },
            ],
            page: { hasMore: false },
          });
        return twoFrameworkFetch(input);
      }),
    );
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Rename Seed' })).toBeEnabled();
    expect(
      screen.queryByText(/Profile changes are read-only for your role/),
    ).not.toBeInTheDocument();
  });
});
