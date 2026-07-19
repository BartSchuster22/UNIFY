import { Alert, Box, Group, Stack, Text, Title } from '@mantine/core';
import { ChatWorkspace } from '@aquiero/chat-components';
import { AsyncState, FocusedApplication } from '@aquiero/design-system';
import { GatewayClient, GatewayError, type UnifiedResource } from '@aquiero/auth-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

const client = new GatewayClient();

export function App() {
  return (
    <FocusedApplication
      name="Aquiero Chat"
      description="Focused conversations"
      client={client}
      requiredPermission="chat.read"
    >
      {(principal) => <ChatPage canSend={principal.permissions.includes('chat.send')} />}
    </FocusedApplication>
  );
}

function ChatPage({ canSend }: { canSend: boolean }) {
  const [sessions, setSessions] = useState<UnifiedResource[]>([]);
  const [messages, setMessages] = useState<UnifiedResource[]>([]);
  const [selected, setSelected] = useState('all');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const draftKey = `aquiero-chat-draft:${selected}`;
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sessionPage, messagePage] = await Promise.all([
        client.collection<UnifiedResource>('/resources?owner=chat&kind=chat-session&limit=100'),
        client.collection<UnifiedResource>('/resources?owner=chat&kind=chat-message&limit=500'),
      ]);
      setSessions(sessionPage.items);
      setMessages(messagePage.items);
    } catch (cause) {
      setError(cause instanceof GatewayError ? cause.failure.message : 'Chat could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setDraft(selected === 'all' ? '' : (localStorage.getItem(draftKey) ?? ''));
  }, [draftKey, selected]);
  const changeDraft = (value: string) => {
    setDraft(value);
    if (selected !== 'all') localStorage.setItem(draftKey, value);
  };
  const send = async () => {
    if (!canSend || selected === 'all' || !draft.trim()) return;
    setSending(true);
    setError('');
    try {
      await client.mutate(
        {
          operationType: 'chat.message.send',
          mode: 'execute',
          confirmed: false,
          target: { owner: 'chat', kind: 'chat-session', nativeId: selected },
          payload: { blocks: [{ kind: 'text', text: draft.trim() }] },
        },
        crypto.randomUUID(),
      );
      localStorage.removeItem(draftKey);
      setDraft('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof GatewayError ? cause.failure.message : 'Message could not be sent');
    } finally {
      setSending(false);
    }
  };
  const selectedTitle = useMemo(
    () => sessions.find((item) => item.resource.nativeId === selected)?.title,
    [sessions, selected],
  );
  return (
    <Box maw={1440} mx="auto">
      <Stack>
        <Group justify="space-between" align="end">
          <Box>
            <Title order={1}>Chat</Title>
            <Text c="dimmed">Responsive, authenticated message history and safe sending.</Text>
          </Box>
          {selectedTitle && <Text size="sm">Selected: {selectedTitle}</Text>}
        </Group>
        {!canSend && (
          <Alert color="blue" title="Read-only account">
            Your account can read Chat but cannot send messages.
          </Alert>
        )}
        <AsyncState
          loading={loading}
          error={error}
          empty={!loading && sessions.length === 0 && messages.length === 0}
        >
          <ChatWorkspace
            sessions={sessions}
            messages={messages}
            selectedSession={selected}
            onSelectSession={setSelected}
            onRefresh={() => void refresh()}
            draft={draft}
            sending={sending}
            error={error}
            {...(canSend ? { onDraftChange: changeDraft, onSend: () => void send() } : {})}
          />
        </AsyncState>
      </Stack>
    </Box>
  );
}
