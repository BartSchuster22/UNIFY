import { render, screen, waitFor } from '@testing-library/react';
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
    'memory.read',
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
  if (url.includes('/integrations'))
    return response({
      items: [
        {
          adapterId: 'agency',
          owners: ['agency'],
          status: 'current',
          resourceCount: 1,
          observedAt: '2026-07-19T00:00:00.000Z',
          warnings: [],
        },
      ],
    });
  if (url.includes('/notifications')) return response({ items: [], meta });
  if (url.includes('kind=chat-session'))
    return response({
      items: [
        {
          resource: {
            canonicalId: 'chat:session:s1',
            kind: 'chat-session',
            owner: 'chat',
            nativeId: 's1',
            observedAt: '2026-07-19T00:00:00.000Z',
          },
          truth: 'current',
          authoritative: true,
          adapterId: 'chat',
          fetchedAt: '2026-07-19T00:00:00.000Z',
          title: 'Operator chat',
          searchableText: 'Operator chat',
          data: {},
        },
      ],
      meta,
    });
  if (url.includes('kind=chat-message'))
    return response({
      items: [
        {
          resource: {
            canonicalId: 'chat:message:m1',
            kind: 'chat-message',
            owner: 'chat',
            nativeId: 'm1',
            observedAt: '2026-07-19T00:00:00.000Z',
          },
          truth: 'current',
          authoritative: true,
          adapterId: 'chat',
          fetchedAt: '2026-07-19T00:00:00.000Z',
          title: 'assistant',
          searchableText: 'Verified response',
          data: { role: 'assistant', content: 'Verified response', session_id: 's1' },
        },
      ],
      meta,
    });
  return response({ items: [], meta });
}

beforeEach(() => {
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

  it('renders the permission-aware responsive shell and keyboard search gate', async () => {
    vi.stubGlobal('fetch', vi.fn(authenticatedFetch));
    const { container } = render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Operational overview' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.queryByText('Safety actions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle navigation' })).toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByLabelText('Global search')).toHaveFocus();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('shows Safety actions for an operation-specific mutation grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/auth/me')
          ? response({ ...principal, permissions: [...principal.permissions, 'work.manage'] })
          : authenticatedFetch(input),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Operational overview' });
    expect(screen.getByText('Safety actions')).toBeInTheDocument();
  });

  it('announces a truthful empty owner state instead of hiding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes('owner=agency'))
          return response({ items: [], meta: { ...meta, freshness: 'empty' } });
        return authenticatedFetch(input);
      }),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Operational overview' });
    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    await userEvent.click(await screen.findByText('Frameworks'));
    expect(await screen.findByText('Source state: empty')).toBeInTheDocument();
    expect(screen.getByText('No records')).toBeInTheDocument();
  });

  it('uses virtualization for bounded Chat history', async () => {
    vi.stubGlobal('fetch', vi.fn(authenticatedFetch));
    render(<App />);
    await screen.findByRole('heading', { name: 'Operational overview' });
    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    await userEvent.click(await screen.findByText('Chat'));
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('log', { name: 'Virtualized Chat messages' })).toBeInTheDocument(),
    );
  });
});
