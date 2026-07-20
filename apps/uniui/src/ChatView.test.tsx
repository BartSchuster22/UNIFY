import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateway } from './api';
import { ChatView } from './ChatView';

const agents = [
  { id: 'hermes.herman', label: 'Herman', status: 'active', description: null, runtime_agent_id: 'herman', display_metadata: { model_label: 'gpt-5.6' }, capabilities: { text: true, attachments: true, external_channels: true } },
  { id: 'hermes.chatboard', label: 'Chatboard', status: 'active', description: null, runtime_agent_id: 'chatboard', display_metadata: { model_label: 'gpt-5.5' }, capabilities: { text: true, attachments: true, external_channels: true } },
];
const telegramSession = { id: 'ses-tg', agent_id: 'hermes.herman', source: 'telegram', external_identity: 'telegram:1371039817', session_key: 'hermes.herman::telegram::1371039817', channel_label: 'Telegram: Canarias Libre', title: 'Herman · Telegram Canarias Libre', status: 'active', last_seq: 30, created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-20T18:00:00Z', surface: { writable: true, attachments: false, route_kind: 'telegram_user_relay', default_delivery: 'user_relay', requires_relay: true } };
const nativeSession = { id: 'ses-native', agent_id: 'hermes.herman', source: 'dashboard_native', external_identity: null, session_key: 'hermes.herman::native', channel_label: 'Dashboard', title: 'Herman planning', status: 'active', last_seq: 2, created_at: '2026-07-10T10:00:00Z', updated_at: '2026-07-19T18:00:00Z', surface: { writable: true, attachments: true, route_kind: 'runtime' } };
const codingSession = { id: 'ses-code', agent_id: 'hermes.chatboard', source: 'dashboard_native', external_identity: null, session_key: 'hermes.chatboard::native', channel_label: 'Dashboard', title: 'Coding session', status: 'active', last_seq: 1, created_at: '2026-07-12T10:00:00Z', updated_at: '2026-07-18T18:00:00Z', surface: { writable: true, attachments: true, route_kind: 'runtime' } };
const messages = Array.from({ length: 25 }, (_, index) => ({ id: `msg-${index}`, session_id: 'ses-tg', agent_id: 'hermes.herman', sender_type: index % 2 ? 'agent' : 'user', blocks: [{ kind: 'text', text: index === 24 ? 'Latest mirrored Telegram reply' : `Message ${index + 1}` }], lifecycle_status: 'complete', external_created_at: null, seq: index + 1, created_at: `2026-07-20T17:${String(index).padStart(2, '0')}:00Z` }));
const workspace = { agents: { agents }, sessions: { sessions: [telegramSession, nativeSession, codingSession] } };
let realtimeMessages = [...messages];

class MockEventSource {
  static latest: MockEventSource | undefined;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: Event) => void>>();
  constructor(public readonly url: string) { MockEventSource.latest = this; }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  emit(type: string, event: Event) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  close() {}
}

function renderChat() { return render(<MantineProvider><ChatView canUse /></MantineProvider>); }

describe('UNIFY CHAT workspace', () => {
  beforeEach(() => {
    realtimeMessages = [...messages];
    MockEventSource.latest = undefined;
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/chat/workspace/ses-tg') ? { ...workspace, messages: { messages: realtimeMessages } }
        : url.includes('/chat/workspace/ses-code') ? { ...workspace, messages: { messages: [{ ...messages[0], id: 'code-message', session_id: 'ses-code', blocks: [{ kind: 'text', text: 'Coding content' }] }] } }
        : url.includes('/chat/workspace/ses-created') ? { agents: { agents }, sessions: { sessions: [{ ...nativeSession, id: 'ses-created', title: 'Fresh session' }, telegramSession, nativeSession, codingSession] }, messages: { messages: [] } }
        : workspace;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.spyOn(gateway, 'mutate').mockImplementation(async (request) => {
      if (request.operationType === 'chat.session.create') return { result: { session: { ...nativeSession, id: 'ses-created', title: 'Fresh session' } }, operation: { id: 'op-create' } } as never;
      return { result: { message: { ...messages[24], id: 'sent-message', blocks: request.payload.blocks } }, operation: { id: 'op-send' } } as never;
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows the agent rail, filters the session rail, and opens session content', async () => {
    renderChat();
    expect(await screen.findByRole('complementary', { name: 'Chat agents' })).toBeInTheDocument();
    expect((await screen.findAllByText('Herman · Telegram Canarias Libre')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Latest mirrored Telegram reply')).toBeInTheDocument();
    expect(screen.getByText('telegram')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Chatboard/ }));
    expect((await screen.findAllByText('Coding session')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Herman planning')).not.toBeInTheDocument();
    expect(await screen.findByText('Coding content')).toBeInTheDocument();
  });

  it('sends through the selected mirrored Telegram session using the fixed composer', async () => {
    renderChat();
    await screen.findByText('Latest mirrored Telegram reply');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Reply through Telegram relay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalledWith(expect.objectContaining({ operationType: 'chat.message.send', target: expect.objectContaining({ nativeId: 'ses-tg' }), payload: { blocks: [{ kind: 'text', text: 'Reply through Telegram relay' }] }, mode: 'execute' })));
  });

  it('receives authoritative realtime events and reconciles the selected session immediately', async () => {
    renderChat();
    await screen.findByText('Latest mirrored Telegram reply');
    MockEventSource.latest?.onopen?.(new Event('open'));
    expect(await screen.findByText('Realtime connected')).toBeInTheDocument();
    realtimeMessages = [
      ...realtimeMessages,
      {
        ...messages[24]!,
        id: 'incoming-live',
        seq: 31,
        sender_type: 'agent',
        blocks: [{ kind: 'text', text: 'Incoming realtime answer' }],
      },
    ];
    MockEventSource.latest?.emit(
      'chat',
      new MessageEvent('chat', {
        data: JSON.stringify({ type: 'message.created', session_id: 'ses-tg' }),
      }),
    );
    expect(await screen.findByText('Incoming realtime answer')).toBeInTheDocument();
  });

  it('creates a new session for the selected agent from the session rail', async () => {
    renderChat();
    await screen.findByText('Latest mirrored Telegram reply');
    fireEvent.click(screen.getByRole('button', { name: 'Add new session' }));
    const title = await screen.findByLabelText('Session title');
    fireEvent.change(title, { target: { value: 'Fresh session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalledWith(expect.objectContaining({ operationType: 'chat.session.create', payload: { agent_id: 'hermes.herman', title: 'Fresh session' } })));
    expect((await screen.findAllByText('Fresh session')).length).toBeGreaterThanOrEqual(1);
  });

  it('offers a centered Latest messages control after the operator scrolls up', async () => {
    renderChat();
    await screen.findByText('Latest mirrored Telegram reply');
    const log = screen.getByRole('log', { name: 'Chat messages' });
    Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 400 }, scrollTop: { configurable: true, writable: true, value: 100 } });
    fireEvent.scroll(log);
    expect(await screen.findByRole('button', { name: 'Latest messages' })).toBeInTheDocument();
  });
});
