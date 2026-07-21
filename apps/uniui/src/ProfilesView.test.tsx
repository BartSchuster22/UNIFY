import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilesView } from './ProfilesView';

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
  sourceVersion: 'profiles:v1',
  observedAt: '2026-07-21T12:00:00.000Z',
  freshness: 'current' as const,
};
const capabilities = {
  meta,
  data: {
    capabilities: {
      'profiles.read': { status: 'supported' },
      'profiles.execute': {
        status: 'unsupported',
        reasonCode: 'NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE',
      },
    },
  },
};

function renderProfiles() {
  return render(
    <MantineProvider>
      <ProfilesView canManage canManageModels canDelete />
    </MantineProvider>,
  );
}

function response(
  items: unknown[],
  page: { hasMore: boolean; nextCursor?: string } = { hasMore: false },
) {
  return { meta, items, page };
}

const herman = {
  id: 'default',
  displayName: 'Herman',
  active: true,
  gatewayStatus: 'running',
  model: 'gpt-5.6-sol',
  provider: 'OpenAI Codex',
  owner: 'hermes',
  frameworkId: 'hermes-main',
  sourceVersion: 'profiles:v1',
  observedAt: meta.observedAt,
};

describe('Profiles Hermes cutover', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=profiles');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders only Hermes-owned profile truth and disables unsupported writes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
        if (url.includes('/capabilities')) return Response.json(capabilities);
        if (url.includes('/profiles')) return Response.json(response([herman]));
        return Response.json({ error: { message: 'not found' } }, { status: 404 });
      }),
    );
    renderProfiles();
    expect(await screen.findByText('Herman')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument();
    expect(screen.getAllByText('hermes').length).toBeGreaterThan(0);
    expect(screen.getByText(/Profile changes are disabled/)).toHaveTextContent(
      'NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE',
    );
    expect(screen.queryByRole('button', { name: /create agent/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Agency/)).not.toBeInTheDocument();
  });

  it('uses opaque Hermes cursors without falling back to legacy inventory', async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
      if (url.includes('/capabilities')) return Response.json(capabilities);
      if (url.includes('cursor=next-safe'))
        return Response.json(response([{ ...herman, id: 'chatboard', displayName: 'Chatboard' }]));
      if (url.includes('/profiles'))
        return Response.json(response([herman], { hasMore: true, nextCursor: 'next-safe' }));
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderProfiles();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more profiles' }));
    expect(await screen.findByText('Chatboard')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes('cursor=next-safe')),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes('agency-context')),
    ).toBe(false);
  });

  it('shows a hard Hermes outage instead of stale Agency data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
        return Response.json(
          { error: { code: 'FRAMEWORK_UNAVAILABLE', message: 'Hermes framework is unavailable' } },
          { status: 503 },
        );
      }),
    );
    renderProfiles();
    expect(await screen.findByText('Hermes framework is unavailable')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Herman')).not.toBeInTheDocument());
  });
});
