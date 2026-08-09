import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  FileInput,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, gateway } from './api';
import { useFrameworkContext } from './FrameworkContext';

const INTERNAL_SOURCES = ['api_server', 'cli', 'tui', 'terminal', 'acp', 'local'];

type Profile = { id: string; displayName: string; active: boolean; model?: string };
type Session = {
  id: string;
  title?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
};
type Message = {
  id: string;
  sessionId: string;
  role: string;
  content?: string;
  createdAt?: string;
};
type Meta = {
  frameworkId: string;
  frameworkCommit: string;
  sourceVersion: string;
  observedAt: string;
  freshness: string;
};
type Collection<T> = { meta: Meta; items: T[]; page: { hasMore: boolean; nextCursor?: string } };
type Capability = { status: string; reasonCode?: string; modes?: string[] };
type Capabilities = { meta: Meta; data: { capabilities: Record<string, Capability> } };

export function ChatView({ canUse }: { canUse: boolean }) {
  const {
    frameworks,
    frameworkId,
    loading: frameworksLoading,
    error: frameworkError,
    selectionIssue,
    selectFramework,
  } = useFrameworkContext();
  const [profiles, setProfiles] = useState<Collection<Profile> | null>(null);
  const [sessions, setSessions] = useState<Collection<Session> | null>(null);
  const [messages, setMessages] = useState<Collection<Message> | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [failure, setFailure] = useState('');
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const requestGeneration = useRef(0);

  const loadMessages = useCallback(
    async (sessionId: string, generation = requestGeneration.current) => {
      if (!frameworkId) return;
      setFailure('');
      try {
        const response = await api<Collection<Message>>(
          `/frameworks/${encodeURIComponent(frameworkId)}/conversations/sessions/${encodeURIComponent(sessionId)}/messages?limit=500`,
        );
        if (generation === requestGeneration.current) setMessages(response);
      } catch (cause) {
        if (generation !== requestGeneration.current) return;
        setMessages(null);
        setFailure(cause instanceof Error ? cause.message : 'Message history unavailable');
      }
    },
    [frameworkId],
  );

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!frameworkId) {
      setProfiles(null);
      setSessions(null);
      setMessages(null);
      setCapabilities(null);
      setSelectedSessionId('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure('');
    try {
      const encodedFrameworkId = encodeURIComponent(frameworkId);
      const [profileResponse, sessionResponse, capabilityResponse] = await Promise.all([
        api<Collection<Profile>>(`/frameworks/${encodedFrameworkId}/profiles?limit=100`),
        api<Collection<Session>>(
          `/frameworks/${encodedFrameworkId}/conversations/sessions?limit=500`,
        ),
        api<Capabilities>(`/frameworks/${encodedFrameworkId}/capabilities`),
      ]);
      if (generation !== requestGeneration.current) return;
      const internalSessions = {
        ...sessionResponse,
        items: sessionResponse.items.filter((item) => INTERNAL_SOURCES.includes(item.source ?? '')),
      };
      setProfiles(profileResponse);
      setSessions(internalSessions);
      setCapabilities(capabilityResponse);
      const nextId = internalSessions.items.some((item) => item.id === selectedSessionId)
        ? selectedSessionId
        : (internalSessions.items[0]?.id ?? '');
      setSelectedSessionId(nextId);
      if (nextId) await loadMessages(nextId, generation);
      else setMessages(null);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setFailure(cause instanceof Error ? cause.message : 'Hermes conversations unavailable');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [frameworkId, loadMessages, selectedSessionId]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  const readCapability = capabilities?.data.capabilities['conversations.sessions.read'];
  const executeCapability = capabilities?.data.capabilities['conversations.execute'];
  const canExecute = executeCapability?.status === 'supported' && canUse;
  const observed = sessions?.meta ?? profiles?.meta;

  async function createSession() {
    if (!canExecute || !title.trim()) return;
    setMutating(true);
    setFailure('');
    try {
      await gateway.mutate({
        operationType: 'conversation.session.create',
        target: {
          owner: 'hermes',
          kind: 'session',
          nativeId: 'new',
          frameworkId,
        },
        payload: { title: title.trim() },
        mode: 'execute',
        confirmed: false,
      });
      setTitle('');
      await load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Session creation failed');
    } finally {
      setMutating(false);
    }
  }

  async function sendMessage() {
    if (!canExecute || !selectedSessionId || (!draft.trim() && !attachment)) return;
    setMutating(true);
    setFailure('');
    try {
      let message: unknown = draft.trim();
      if (attachment) {
        if (!attachment.type.startsWith('image/'))
          throw new Error('Only image attachments are supported');
        if (attachment.size > 1_500_000)
          throw new Error('Image attachment must be 1.5 MB or smaller');
        message = [
          ...(draft.trim() ? [{ type: 'text', text: draft.trim() }] : []),
          { type: 'image_url', image_url: { url: await fileDataUrl(attachment) } },
        ];
      }
      await gateway.mutate({
        operationType: 'conversation.message.send',
        target: {
          owner: 'hermes',
          kind: 'session',
          nativeId: selectedSessionId,
          frameworkId,
        },
        payload: { message },
        mode: 'execute',
        confirmed: false,
      });
      setDraft('');
      setAttachment(null);
      await loadMessages(selectedSessionId);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Message send failed');
    } finally {
      setMutating(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Hermes-native control contract
          </Text>
          <Title order={1}>Internal conversations</Title>
          <Text c="dimmed">
            Internal Hermes sessions only. External-channel conversations are excluded from UNIFY.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={() => void load()}
        >
          Recheck
        </Button>
      </Group>

      <Select
        label="Hermes framework"
        value={frameworkId || null}
        data={frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName }))}
        onChange={(value) => selectFramework(value ?? '')}
        placeholder="No verified Hermes framework"
        disabled={frameworksLoading}
      />
      {frameworkError || selectionIssue ? (
        <Alert color="red" title="Framework selection unavailable">
          {frameworkError || selectionIssue}
        </Alert>
      ) : null}

      <Group gap="xs">
        <Badge color={readCapability?.status === 'supported' ? 'teal' : 'orange'}>
          Read {readCapability?.status ?? 'checking'}
        </Badge>
        <Badge color={canExecute ? 'teal' : 'gray'}>
          Send {executeCapability?.status ?? 'checking'}
        </Badge>
        {observed ? <Badge variant="light">Source {observed.freshness}</Badge> : null}
      </Group>
      {!canExecute ? (
        <Alert color="blue" title="Message sending is disabled">
          {executeCapability?.reasonCode
            ? `Hermes reports ${executeCapability.reasonCode}. No fallback writer is used.`
            : 'The current capability or permission does not allow conversation execution.'}
        </Alert>
      ) : null}
      {failure ? (
        <Alert color="red" title="Conversation operation unavailable">
          {failure}
        </Alert>
      ) : null}
      {loading && !sessions ? <Loader aria-label="Loading internal conversations" /> : null}

      <Group align="stretch" wrap="nowrap" className="chat-grid">
        <Card withBorder miw={210} style={{ flex: '0 0 240px' }}>
          <Text fw={800} mb="sm">
            Profiles
          </Text>
          <Stack gap="xs">
            <TextInput
              label="New internal session"
              placeholder="Session title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              disabled={!canExecute || mutating}
            />
            <Button
              size="xs"
              onClick={() => void createSession()}
              disabled={!canExecute || !title.trim()}
              loading={mutating}
            >
              Create session
            </Button>
            {profiles?.items.map((profile) => (
              <Paper withBorder p="sm" key={profile.id}>
                <Group justify="space-between" gap="xs">
                  <Text fw={700}>{profile.displayName}</Text>
                  <Badge size="xs" color={profile.active ? 'teal' : 'gray'}>
                    {profile.active ? 'active' : 'available'}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {profile.model ?? 'Model not reported'}
                </Text>
              </Paper>
            ))}
            {!loading && profiles?.items.length === 0 ? (
              <Text c="dimmed">No Hermes profile reported.</Text>
            ) : null}
          </Stack>
        </Card>

        <Card withBorder miw={240} style={{ flex: '0 0 280px' }}>
          <Text fw={800} mb="sm">
            Internal sessions
          </Text>
          <Stack gap="xs">
            {sessions?.items.map((session) => (
              <Button
                key={session.id}
                variant={selectedSessionId === session.id ? 'light' : 'subtle'}
                justify="flex-start"
                h="auto"
                py="sm"
                onClick={() => {
                  setSelectedSessionId(session.id);
                  void loadMessages(session.id);
                }}
              >
                <Stack gap={2} align="flex-start">
                  <Text fw={700} size="sm">
                    {session.title || session.id}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {session.source ?? 'internal'} ·{' '}
                    {session.updatedAt
                      ? new Date(session.updatedAt).toLocaleString()
                      : 'time unavailable'}
                  </Text>
                </Stack>
              </Button>
            ))}
            {!loading && sessions?.items.length === 0 ? (
              <Text c="dimmed">
                No internal session exists. External sessions are intentionally absent.
              </Text>
            ) : null}
          </Stack>
        </Card>

        <Card withBorder style={{ flex: 1, minWidth: 320 }}>
          <Group justify="space-between" mb="sm">
            <Text fw={800}>Conversation</Text>
            {selectedSessionId ? <Code>{selectedSessionId}</Code> : null}
          </Group>
          <ScrollArea h={430}>
            <Stack gap="sm">
              {messages?.items.map((message) => (
                <Paper withBorder p="sm" key={message.id}>
                  <Group justify="space-between" mb="xs">
                    <Badge variant="light">{message.role}</Badge>
                    <Text size="xs" c="dimmed">
                      {message.createdAt
                        ? new Date(message.createdAt).toLocaleString()
                        : 'time unavailable'}
                    </Text>
                  </Group>
                  <Text style={{ whiteSpace: 'pre-wrap' }}>
                    {message.content || '[non-text content]'}
                  </Text>
                </Paper>
              ))}
              {selectedSessionId && messages?.items.length === 0 ? (
                <Text c="dimmed">The selected internal session has no messages.</Text>
              ) : null}
              {!selectedSessionId ? (
                <Text c="dimmed">Select or create an internal session.</Text>
              ) : null}
            </Stack>
          </ScrollArea>
          <Stack gap="xs" mt="md">
            <Textarea
              label="Message"
              placeholder="Send to this internal Hermes session"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              disabled={!canExecute || !selectedSessionId || mutating}
              minRows={2}
            />
            <FileInput
              label="Image attachment"
              accept="image/*"
              value={attachment}
              onChange={setAttachment}
              clearable
              disabled={!canExecute || !selectedSessionId || mutating}
              description="Images only, up to 1.5 MB"
            />
            <Button
              onClick={() => void sendMessage()}
              disabled={!canExecute || !selectedSessionId || (!draft.trim() && !attachment)}
              loading={mutating}
            >
              Send message
            </Button>
          </Stack>
          {observed ? (
            <Text size="xs" c="dimmed" mt="md">
              Framework <Code>{observed.frameworkId}</Code> · commit{' '}
              <Code>{observed.frameworkCommit}</Code> · source <Code>{observed.sourceVersion}</Code>{' '}
              · observed {new Date(observed.observedAt).toLocaleString()}
            </Text>
          ) : null}
        </Card>
      </Group>
    </Stack>
  );
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Image attachment could not be read'));
    reader.readAsDataURL(file);
  });
}
