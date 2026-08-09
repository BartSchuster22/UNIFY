import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilesView } from './ProfilesView';
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

function renderProfiles(canManage = true) {
  return render(
    <MantineProvider>
      <FrameworkProvider>
        <ProfilesView canManage={canManage} />
      </FrameworkProvider>
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

  it('runs an isolated governed dry-run and safely retries uncertain execution with a new operation', async () => {
    const frameworks = [
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
    const hermanMeta = { ...meta, frameworkId: 'hermes-herman' };
    const supported = {
      meta: hermanMeta,
      data: { capabilities: { 'profiles.execute': { status: 'supported' } } },
    };
    const seed = {
      ...herman,
      id: 'seed',
      displayName: 'Seed',
      frameworkId: 'hermes-herman',
      sourceVersion: 'profiles:herman-v7',
    };
    const mutationCalls: Array<{ body: Record<string, unknown>; idempotencyKey: string }> = [];
    let executeAttempts = 0;
    let renamed = false;
    const fetchMock = vi.fn(
      async (request: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(request);
        if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: frameworks });
        if (url.includes('/frameworks/hermes-herman/capabilities')) return Response.json(supported);
        if (url.includes('/frameworks/hermes-herman/profiles'))
          return Response.json(
            response(
              renamed
                ? [
                    {
                      ...seed,
                      id: 'alica',
                      displayName: 'Alica',
                      sourceVersion: 'profiles:herman-v8',
                    },
                  ]
                : [seed],
            ),
          );
        if (url.endsWith('/api/v1/mutations')) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          const headers = new Headers(init?.headers);
          mutationCalls.push({ body, idempotencyKey: headers.get('idempotency-key') ?? '' });
          if (body.mode === 'execute') {
            executeAttempts += 1;
            if (executeAttempts === 1)
              return Response.json(
                {
                  error: { code: 'FRAMEWORK_UNAVAILABLE', message: 'Hermes timed out after apply' },
                },
                { status: 503 },
              );
            renamed = true;
          }
          return Response.json({
            replayed: executeAttempts > 1,
            operation: {
              operationId: body.mode === 'dry-run' ? 'operation-dry-run' : 'operation-execute',
              operationType: 'profile.rename',
              state: 'verified',
              mode: body.mode,
              updatedAt: '2026-08-09T15:30:00Z',
            },
            result: { status: 'completed' },
          });
        }
        return Response.json({ error: { message: 'not found' } }, { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/?view=profiles&framework=hermes-herman');
    renderProfiles();

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Seed' }));
    fireEvent.change(await screen.findByLabelText('New profile ID'), {
      target: { value: 'alica' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    expect(await screen.findByText(/Dry-run passed/)).toBeInTheDocument();
    expect(mutationCalls[0]?.body).toMatchObject({
      operationType: 'profile.rename',
      target: {
        owner: 'hermes',
        kind: 'profile',
        nativeId: 'seed',
        frameworkId: 'hermes-herman',
      },
      payload: { newId: 'alica', expectedSourceVersion: 'profiles:herman-v7' },
      mode: 'dry-run',
      confirmed: true,
    });
    expect(JSON.stringify(mutationCalls)).not.toContain('hermes-alica');

    fireEvent.click(screen.getByRole('button', { name: 'Rename profile' }));
    expect(await screen.findByText('Hermes timed out after apply')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rename profile' }));
    expect(await screen.findByText(/already completed/)).toBeInTheDocument();
    expect((await screen.findAllByText('Alica')).length).toBeGreaterThan(0);

    const executeCalls = mutationCalls.filter((call) => call.body.mode === 'execute');
    expect(executeCalls).toHaveLength(2);
    expect(executeCalls[0]?.idempotencyKey).toBeTruthy();
    expect(executeCalls[1]?.idempotencyKey).toBeTruthy();
    expect(executeCalls[1]?.idempotencyKey).not.toBe(executeCalls[0]?.idempotencyKey);
    expect(mutationCalls[0]?.idempotencyKey).not.toBe(executeCalls[0]?.idempotencyKey);
  });

  it('fails a rename conflict closed and never enables execute without a successful dry-run', async () => {
    const named = { ...herman, id: 'seed', displayName: 'Seed' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
        if (url.includes('/capabilities'))
          return Response.json({
            ...capabilities,
            data: { capabilities: { 'profiles.execute': { status: 'supported' } } },
          });
        if (url.includes('/profiles')) return Response.json(response([named]));
        if (url.endsWith('/api/v1/mutations'))
          return Response.json(
            {
              error: {
                code: 'conflict',
                message: "Profile rename destination 'alica' already exists",
              },
            },
            { status: 409 },
          );
        return Response.json({}, { status: 404 });
      }),
    );
    renderProfiles();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Seed' }));
    fireEvent.change(await screen.findByLabelText('New profile ID'), {
      target: { value: 'alica' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and dry-run' }));
    expect(await screen.findByText(/destination 'alica' already exists/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename profile' })).toBeDisabled();
  });

  it('keeps profile writes unavailable for read-only roles and the built-in default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = String(request);
        if (url.endsWith('/api/v1/frameworks')) return Response.json({ items: [framework] });
        if (url.includes('/capabilities'))
          return Response.json({
            ...capabilities,
            data: { capabilities: { 'profiles.execute': { status: 'supported' } } },
          });
        if (url.includes('/profiles')) return Response.json(response([herman]));
        return Response.json({}, { status: 404 });
      }),
    );
    renderProfiles(false);
    expect(await screen.findByText(/read-only for your role/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename Herman' })).toBeDisabled();
    expect(screen.getByText(/UNIUI does not emulate that migration/)).toBeInTheDocument();
  });
});
