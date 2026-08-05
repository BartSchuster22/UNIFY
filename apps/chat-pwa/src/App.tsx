import { Alert, Box, Button, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { ChatWorkspace } from '@aquiero/chat-components';
import { AsyncState, FocusedApplication } from '@aquiero/design-system';
import {
  GatewayClient,
  GatewayError,
  type Principal,
  type UnifiedResource,
} from '@aquiero/auth-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

const identityClient = new GatewayClient();
const coreClient = new GatewayClient('/core/v1');

type ResourceMeta = { id: string; createdAt: string; updatedAt: string; version: number };
type Agent = {
  profileId: string;
  frameworkId: string;
  label: string;
  state: string;
  selectable: boolean;
};
type Conversation = {
  meta: ResourceMeta;
  profileId: string;
  title: string;
  state: 'active' | 'archived';
  ownership: 'core' | 'external';
};
type MessageBlock =
  { kind: 'text'; text: string } | { kind: 'attachment'; attachmentId: string; caption?: string };
type Message = {
  meta: ResourceMeta;
  conversationId: string;
  sender: string;
  sequence: number;
  state: string;
  blocks: MessageBlock[];
};
type NativeList<T> = { items: T[] };

export function App() {
  return (
    <FocusedApplication
      name="Aquiero Chat"
      description="Native, durable UNIFY agent conversations"
      client={identityClient}
      requiredPermission="chat.read"
    >
      {(principal) => <ChatPage principal={principal} />}
    </FocusedApplication>
  );
}

function ChatPage({ principal }: { principal: Principal }) {
  const canSend = principal.permissions.includes('chat.use');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState('all');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const draftKey = `aquiero-chat-draft:${selected}`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agentPage, conversationPage] = await Promise.all([
        coreClient.request<NativeList<Agent>>('/agents'),
        coreClient.request<NativeList<Conversation>>('/conversations'),
      ]);
      setAgents(agentPage.items.filter((agent) => agent.selectable));
      setConversations(conversationPage.items);
      if (selected === 'all') {
        const pages = await Promise.all(
          conversationPage.items.map((conversation) =>
            coreClient.request<NativeList<Message>>(
              `/conversations/${encodeURIComponent(conversation.meta.id)}/messages`,
            ),
          ),
        );
        setMessages(pages.flatMap((page) => page.items));
      } else {
        const page = await coreClient.request<NativeList<Message>>(
          `/conversations/${encodeURIComponent(selected)}/messages`,
        );
        setMessages(page.items);
      }
    } catch (cause) {
      setError(messageFor(cause, 'Chat could not be loaded'));
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const stream = new EventSource('/core/v1/events', { withCredentials: true });
    stream.onmessage = () => void refresh();
    stream.onerror = () => setError('Realtime connection interrupted; reconnecting automatically');
    return () => stream.close();
  }, [refresh]);
  useEffect(() => {
    setDraft(selected === 'all' ? '' : (localStorage.getItem(draftKey) ?? ''));
  }, [draftKey, selected]);

  const changeDraft = (value: string) => {
    setDraft(value);
    if (selected !== 'all') localStorage.setItem(draftKey, value);
  };

  const createConversation = async () => {
    if (!canSend || !selectedAgent) return;
    setCreating(true);
    setError('');
    try {
      await coreClient.request('/conversations', {
        method: 'POST',
        body: JSON.stringify(
          command('conversation.create.v1', 'conversation', undefined, {
            profileId: selectedAgent,
            ...(newTitle.trim() ? { title: newTitle.trim() } : {}),
          }),
        ),
      });
      setNewTitle('');
      await refresh();
    } catch (cause) {
      setError(messageFor(cause, 'Conversation could not be created'));
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    if (!canSend || selected === 'all' || !draft.trim()) return;
    setSending(true);
    setError('');
    const clientMessageId = crypto.randomUUID();
    try {
      await coreClient.request(`/conversations/${encodeURIComponent(selected)}/messages`, {
        method: 'POST',
        body: JSON.stringify(
          command('conversation.message.create.v1', 'conversation', selected, {
            clientMessageId,
            blocks: [{ kind: 'text', text: draft.trim() }],
            delivery: 'conversation',
          }),
        ),
      });
      localStorage.removeItem(draftKey);
      setDraft('');
      await refresh();
    } catch (cause) {
      setError(messageFor(cause, 'Message could not be sent'));
    } finally {
      setSending(false);
    }
  };

  const sessions = useMemo(() => conversations.map(conversationResource), [conversations]);
  const messageResources = useMemo(
    () => [...messages].sort((a, b) => a.sequence - b.sequence).map(messageResource),
    [messages],
  );
  const selectedTitle = conversations.find((item) => item.meta.id === selected)?.title;

  return (
    <Box maw={1440} mx="auto">
      <Stack>
        <Group justify="space-between" align="end">
          <Box>
            <Title order={1}>Chat</Title>
            <Text c="dimmed">
              Native sessions, ordered history, durable realtime replay, and profile routing.
            </Text>
          </Box>
          {selectedTitle && <Text size="sm">Selected: {selectedTitle}</Text>}
        </Group>
        {canSend ? (
          <Group align="end">
            <Select
              label="Agent"
              placeholder="Select an active agent"
              data={agents.map((agent) => ({ value: agent.profileId, label: agent.label }))}
              value={selectedAgent}
              onChange={setSelectedAgent}
              searchable
            />
            <TextInput
              label="Conversation title"
              value={newTitle}
              maxLength={200}
              onChange={(event) => setNewTitle(event.currentTarget.value)}
            />
            <Button
              disabled={!selectedAgent}
              loading={creating}
              onClick={() => void createConversation()}
            >
              New conversation
            </Button>
          </Group>
        ) : (
          <Alert color="blue" title="Read-only access">
            `chat.use` is required to create conversations or send messages.
          </Alert>
        )}
        <AsyncState
          loading={loading}
          error={error}
          empty={!loading && conversations.length === 0 && messages.length === 0}
        >
          <ChatWorkspace
            sessions={sessions}
            messages={messageResources}
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

function conversationResource(item: Conversation): UnifiedResource {
  return resource(item.meta, 'conversation', item.title, {
    sessionId: item.meta.id,
    profileId: item.profileId,
    state: item.state,
    ownership: item.ownership,
  });
}
function messageResource(item: Message): UnifiedResource {
  const text = item.blocks
    .map((block) =>
      block.kind === 'text' ? block.text : block.caption || `[Attachment ${block.attachmentId}]`,
    )
    .join('\n');
  return resource(item.meta, 'message', item.sender, {
    sessionId: item.conversationId,
    sender: item.sender,
    content: text,
    sequence: item.sequence,
    blocks: item.blocks,
  });
}
function resource(
  meta: ResourceMeta,
  kind: string,
  title: string,
  data: Record<string, unknown>,
): UnifiedResource {
  return {
    resource: {
      canonicalId: meta.id,
      nativeId: meta.id,
      owner: 'core',
      kind,
      observedAt: meta.updatedAt,
      sourceVersion: String(meta.version),
    },
    truth: 'current',
    authoritative: true,
    sourceRole: 'authoritative',
    adapterId: 'core-native-conversations',
    fetchedAt: new Date().toISOString(),
    title,
    searchableText: JSON.stringify(data),
    data,
  };
}
function command(commandType: string, kind: string, id: string | undefined, payload: unknown) {
  const commandId = `cmd_${ulid()}`;
  return {
    contractVersion: 'core.v1',
    commandId,
    commandType,
    idempotencyKey: `${commandType}:${commandId}`,
    issuedAt: new Date().toISOString(),
    target: { kind, ...(id ? { id } : {}) },
    payload,
  };
}
function ulid(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = Date.now();
  let value = '';
  for (let index = 0; index < 10; index += 1) {
    value = alphabet[time % 32] + value;
    time = Math.floor(time / 32);
  }
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  for (let index = 0; index < 16; index += 1) value += alphabet[random[index]! % 32];
  return value;
}
function messageFor(cause: unknown, fallback: string): string {
  return cause instanceof GatewayError ? cause.failure.message : fallback;
}
