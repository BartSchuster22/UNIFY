import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, gateway } from './api';
import { FrameworkProvider } from './FrameworkContext';
import { ChatView } from './ChatView';

vi.mock('./api', () => ({ api: vi.fn(), gateway: { mutate: vi.fn() } }));
const mockedApi = vi.mocked(api);
const mockedMutate = vi.mocked(gateway.mutate);

const meta = {
  frameworkId: 'hermes-alica',
  frameworkCommit: '9e54eee44f1c',
  sourceVersion: 'sha256:native',
  observedAt: '2026-07-22T02:35:25.976Z',
  freshness: 'current',
};
const page = { hasMore: false };

beforeEach(() => {
  window.history.replaceState(null, '', '/?view=chat');
  mockedApi.mockImplementation(async (path: string) => {
    if (path === '/frameworks')
      return {
        items: [
          {
            frameworkId: 'hermes-alica',
            displayName: 'Alica',
            enabled: true,
            status: 'verified',
          },
          {
            frameworkId: 'hermes-herman',
            displayName: 'Herman',
            enabled: true,
            status: 'verified',
          },
        ],
      } as never;
    if (path.includes('/profiles'))
      return {
        meta,
        page,
        items: [
          {
            id: 'default',
            displayName: 'Herman',
            active: true,
            model: 'gpt-5.6-sol',
          },
        ],
      } as never;
    if (path.endsWith('/capabilities'))
      return {
        meta,
        data: {
          capabilities: {
            'conversations.sessions.read': { status: 'supported', modes: ['read'] },
            'conversations.execute': {
              status: 'unsupported',
              reasonCode: 'NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE',
            },
          },
        },
      } as never;
    if (path.includes('/messages'))
      return {
        meta,
        page,
        items: [
          {
            id: 'msg-1',
            sessionId: 'ses-internal',
            role: 'assistant',
            content: 'Native Hermes answer',
            createdAt: '2026-07-22T02:30:00Z',
          },
        ],
      } as never;
    if (path.includes('/conversations/sessions'))
      return {
        meta,
        page,
        items: [
          {
            id: 'ses-external',
            title: 'Excluded external conversation',
            source: 'telegram',
          },
          {
            id: 'ses-internal',
            title: 'Internal API conversation',
            source: 'api_server',
            updatedAt: '2026-07-22T02:31:00Z',
          },
        ],
      } as never;
    throw new Error(`Unexpected path ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderView(canUse = false) {
  return render(
    <MantineProvider>
      <FrameworkProvider>
        <ChatView canUse={canUse} />
      </FrameworkProvider>
    </MantineProvider>,
  );
}

describe('ChatView', () => {
  it('routes every Chat read to the exact URL-selected framework', async () => {
    window.history.replaceState(null, '', '/?view=chat&framework=hermes-herman');
    renderView();
    await screen.findByText('Internal API conversation');
    const scopedPaths = mockedApi.mock.calls
      .map(([path]) => path)
      .filter((path) => path !== '/frameworks');
    expect(scopedPaths.length).toBeGreaterThan(0);
    expect(scopedPaths.every((path) => path.includes('/frameworks/hermes-herman/'))).toBe(true);
    expect(scopedPaths.some((path) => path.includes('hermes-alica'))).toBe(false);
  });

  it('renders only Hermes-native internal sessions with provenance', async () => {
    renderView();
    expect(await screen.findByText('Internal API conversation')).toBeInTheDocument();
    expect(screen.queryByText('Excluded external conversation')).not.toBeInTheDocument();
    expect(await screen.findByText('Native Hermes answer')).toBeInTheDocument();
    expect(screen.getAllByText('Herman').length).toBeGreaterThan(0);
    expect(screen.getByText(/sha256:native/)).toBeInTheDocument();
  });

  it('shows the truthful unsupported send capability without a fallback writer', async () => {
    renderView(true);
    expect(await screen.findByText('Send unsupported')).toBeInTheDocument();
    expect(screen.getByText(/NO_IDEMPOTENT_NONINTERACTIVE_INTERFACE/)).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create session' })).toBeDisabled();
  });

  it('creates and sends through verified exact-profile governed Hermes operations', async () => {
    const baseImplementation = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/capabilities'))
        return {
          meta,
          data: {
            capabilities: {
              'conversations.sessions.read': { status: 'supported', modes: ['read'] },
              'conversations.execute': { status: 'supported', modes: ['execute'] },
            },
          },
        } as never;
      return baseImplementation(path, init);
    });
    mockedMutate.mockResolvedValue({
      replayed: false,
      operation: {
        operationId: 'op-chat',
        operationType: 'conversation.session.create',
        state: 'verified',
        mode: 'execute',
        updatedAt: '2026-07-22T02:35:25.976Z',
      },
      result: { ok: true },
    });
    renderView(true);
    await screen.findByText('Internal API conversation');
    fireEvent.change(screen.getByRole('textbox', { name: 'New internal session' }), {
      target: { value: 'Governed chat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(mockedMutate).toHaveBeenCalledTimes(1));
    expect(mockedMutate.mock.calls[0]?.[0]).toMatchObject({
      operationType: 'conversation.session.create',
      target: {
        owner: 'hermes',
        kind: 'session',
        nativeId: 'new',
        frameworkId: 'hermes-alica',
      },
      payload: {
        title: 'Governed chat',
        profileId: 'default',
        model: 'gpt-5.6-sol',
        expectedSourceVersion: 'sha256:native',
      },
      mode: 'execute',
    });

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello Hermes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mockedMutate).toHaveBeenCalledTimes(2));
    expect(mockedMutate.mock.calls[1]?.[0]).toMatchObject({
      operationType: 'conversation.message.send',
      target: {
        owner: 'hermes',
        kind: 'session',
        nativeId: 'ses-internal',
        frameworkId: 'hermes-alica',
      },
      payload: {
        message: 'Hello Hermes',
        expectedSourceVersion: 'sha256:native',
      },
    });
  });

  it('rechecks profiles, sessions and capabilities on demand', async () => {
    renderView();
    await screen.findByText('Internal API conversation');
    const before = mockedApi.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await waitFor(() => expect(mockedApi.mock.calls.length).toBeGreaterThan(before));
  });
});
