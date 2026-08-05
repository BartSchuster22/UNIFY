import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const conversation = {
  meta: {
    id: 'cvs_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    version: 1,
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z',
  },
  profileId: 'prf_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  title: 'Support',
  state: 'active',
  ownership: 'core',
  ownerId: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  channelId: null,
  externalConversationReference: null,
  lastSequence: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Chat PWA', () => {
  it('loads the native permission-aware workspace without accessibility violations', async () => {
    vi.stubGlobal('fetch', nativeFetch(['chat.read']));
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(await screen.findByText('Support')).toBeInTheDocument();
    expect(screen.getByText('Read-only access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await waitFor(async () =>
      expect(
        (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
      ).toEqual([]),
    );
  });

  it('sends a native command with duplicate-send identity to the selected conversation', async () => {
    const fetch = nativeFetch(['chat.read', 'chat.use']);
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Support'));
    const composer = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(composer, 'Native hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/core/v1/conversations/${conversation.meta.id}/messages`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const send = fetch.mock.calls.find(
      ([url, init]) => String(url).endsWith('/messages') && init?.method === 'POST',
    );
    const body = JSON.parse(String(send?.[1]?.body)) as {
      payload: { clientMessageId: string };
    };
    expect(body).toMatchObject({
      contractVersion: 'core.v1',
      commandType: 'conversation.message.create.v1',
      target: { kind: 'conversation', id: conversation.meta.id },
      payload: { delivery: 'conversation', blocks: [{ kind: 'text', text: 'Native hello' }] },
    });
    expect(body.payload.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

function nativeFetch(permissions: string[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/auth/me'))
      return Response.json({
        userId: 'u1',
        username: 'reader',
        displayName: 'Chat Reader',
        roles: ['Operator'],
        permissions,
      });
    if (url.endsWith('/core/v1/agents'))
      return Response.json({
        items: [
          {
            profileId: conversation.profileId,
            frameworkId: 'frm_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            label: 'Support Agent',
            state: 'active',
            selectable: true,
          },
        ],
      });
    if (url.endsWith('/core/v1/conversations')) return Response.json({ items: [conversation] });
    if (url.includes(`/core/v1/conversations/${conversation.meta.id}/messages`)) {
      if (init?.method === 'POST')
        return Response.json({
          contractVersion: 'core.v1',
          commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          operationId: 'opc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          status: 'accepted',
          replayed: false,
          acceptedAt: '2026-08-05T12:00:00.000Z',
        });
      return Response.json({ items: [] });
    }
    throw new Error(`Unexpected request ${url}`);
  });
}
