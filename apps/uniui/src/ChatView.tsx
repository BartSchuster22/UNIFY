import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconBrandTelegram, IconMessagePlus, IconRefresh, IconSend } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, gateway } from './api';

type Source = 'dashboard_native' | 'telegram' | 'whatsapp';
type MessageBlock = { kind: 'text'; text: string } | { kind: 'image'; url: string; alt?: string; name?: string } | { kind: 'file'; url: string; name: string };
type Agent = { id: string; label: string; status: 'active' | 'disabled' | 'error'; description: string | null; framework_id?: string; runtime_agent_id?: string; display_metadata?: { model_label?: string; provider_label?: string; framework_label?: string }; capabilities?: { text: boolean; attachments: boolean; external_channels: boolean }; channel_bindings?: Array<{ id: string; channel: 'telegram' | 'whatsapp'; status: string; label: string }> };
type Session = { id: string; agent_id: string; source: Source; external_identity: string | null; session_key: string; channel_label: string; title: string; status: 'active' | 'archived'; last_seq: number; created_at: string; updated_at: string; surface?: { writable: boolean; attachments: boolean; route_kind?: string; default_delivery?: string; reason?: string } };
type Message = { id: string; session_id: string; agent_id: string; sender_type: 'user' | 'agent' | 'system'; blocks: MessageBlock[]; lifecycle_status: 'pending' | 'streaming' | 'complete' | 'failed'; external_created_at: string | null; seq: number; created_at: string };
type Workspace = { agents: { agents: Agent[] }; sessions: { sessions: Session[] }; messages?: { messages: Message[]; total?: number; truncated?: boolean } };
type Notice = { color: 'red' | 'yellow' | 'blue' | 'green'; message: string };
type RealtimeFrame = { type?: string; session_id?: string; agent_id?: string };

export function ChatView({ canUse }: { canUse: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const messageViewport = useRef<HTMLDivElement | null>(null);
  const selectedSessionRef = useRef('');
  const reconcileTimer = useRef<number | undefined>(undefined);
  selectedSessionRef.current = sessionId;

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [sessions]);
  const agentSessions = sortedSessions.filter((session) => session.agent_id === agentId);
  const activeAgent = agents.find((agent) => agent.id === agentId);
  const activeSession = sessions.find((session) => session.id === sessionId);

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const viewport = messageViewport.current;
    if (viewport) {
      if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      else viewport.scrollTop = viewport.scrollHeight;
    }
    setShowLatest(false);
  };

  const loadSession = async (id: string, quiet = false) => {
    if (!id) { setMessages([]); setMessageTotal(0); setHistoryTruncated(false); return; }
    if (!quiet) setLoadingMessages(true);
    try {
      const body = await api<Workspace>(`/chat/workspace/${encodeURIComponent(id)}`);
      setAgents(body.agents.agents ?? []);
      setSessions(body.sessions.sessions ?? []);
      setMessages((body.messages?.messages ?? []).sort((a, b) => a.seq - b.seq));
      setMessageTotal(body.messages?.total ?? body.messages?.messages.length ?? 0);
      setHistoryTruncated(body.messages?.truncated ?? false);
      setNotice(null);
    } catch (cause) {
      if (!quiet) setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'CHAT session unavailable' });
    } finally { if (!quiet) setLoadingMessages(false); }
  };

  const refreshRails = async () => {
    const body = await api<Workspace>('/chat/workspace');
    setAgents(body.agents.agents ?? []);
    setSessions(body.sessions.sessions ?? []);
  };

  const load = async () => {
    setLoading(true);
    try {
      const body = await api<Workspace>('/chat/workspace');
      const nextAgents = body.agents.agents ?? [];
      const nextSessions = [...(body.sessions.sessions ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setAgents(nextAgents); setSessions(nextSessions); setNotice(null);
      const selectedAgent = nextAgents.some((agent) => agent.id === agentId) ? agentId : nextSessions[0]?.agent_id ?? nextAgents[0]?.id ?? '';
      setAgentId(selectedAgent);
      const selectedSession = nextSessions.find((session) => session.id === sessionId && session.agent_id === selectedAgent)?.id ?? nextSessions.find((session) => session.agent_id === selectedAgent)?.id ?? '';
      setSessionId(selectedSession);
      if (selectedSession) await loadSession(selectedSession); else { setMessages([]); setMessageTotal(0); setHistoryTruncated(false); }
    } catch (cause) { setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'CHAT workspace unavailable' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const id = selectedSessionRef.current;
      if (id) void loadSession(id, true);
      else void refreshRails().catch(() => undefined);
    }, realtimeStatus === 'connected' ? 30_000 : 4_000);
    return () => window.clearInterval(timer);
  }, [realtimeStatus]);
  useEffect(() => {
    if (typeof EventSource === 'undefined') { setRealtimeStatus('offline'); return; }
    const source = new EventSource('/api/v1/chat/events');
    const reconcile = (frame: RealtimeFrame) => {
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
      reconcileTimer.current = window.setTimeout(() => {
        void refreshRails().catch(() => undefined);
        const selected = selectedSessionRef.current;
        if (selected && (!frame.session_id || frame.session_id === selected)) void loadSession(selected, true);
      }, 80);
    };
    source.onopen = () => setRealtimeStatus('connected');
    source.onerror = () => setRealtimeStatus('offline');
    source.addEventListener('chat', (event) => {
      try {
        const frame = JSON.parse((event as MessageEvent<string>).data) as RealtimeFrame;
        if (
          frame.type === 'realtime.replay_gap' ||
          frame.type?.startsWith('message.') ||
          frame.type?.startsWith('session.')
        ) reconcile(frame);
      } catch {
        // Ignore malformed realtime frames.
      }
    });
    source.addEventListener('upstream', () => setRealtimeStatus('offline'));
    return () => {
      source.close();
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
    };
  }, []);
  useEffect(() => { if (!showLatest) window.requestAnimationFrame(() => scrollToLatest('auto')); }, [messages.length, sessionId, loadingMessages]);

  const selectAgent = (id: string) => {
    setAgentId(id); setNotice(null);
    const next = sortedSessions.find((session) => session.agent_id === id)?.id ?? '';
    setSessionId(next); setMessages([]); setMessageTotal(0); setHistoryTruncated(false); setShowLatest(false);
    if (next) void loadSession(next);
  };
  const selectSession = (id: string) => { setSessionId(id); setMessages([]); setMessageTotal(0); setHistoryTruncated(false); setNotice(null); setShowLatest(false); void loadSession(id); };
  const openNew = () => {
    if (!activeAgent) return;
    setNewTitle(`${activeAgent.label} · ${new Date().toLocaleString()}`);
    setNewOpen(true);
  };
  const createSession = async () => {
    if (!activeAgent || !newTitle.trim() || creating) return;
    setCreating(true); setNotice(null);
    try {
      const response = await gateway.mutate({ operationType: 'chat.session.create', target: { owner: 'chat', kind: 'chat-session', nativeId: 'new' }, payload: { agent_id: activeAgent.id, title: newTitle.trim() }, mode: 'execute', confirmed: false });
      const result = response.result as { session?: Session };
      const created = result.session;
      setNewOpen(false);
      if (created) { setSessions((current) => [created, ...current.filter((session) => session.id !== created.id)]); setSessionId(created.id); await loadSession(created.id); }
      else await load();
    } catch (cause) { setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'Session creation failed' }); }
    finally { setCreating(false); }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || !activeSession || sending || !canUse || activeSession.surface?.writable === false) return;
    setSending(true); setNotice(null); setDraft('');
    try {
      const response = await gateway.mutate({ operationType: 'chat.message.send', target: { owner: 'chat', kind: 'chat-session', nativeId: activeSession.id }, payload: { blocks: [{ kind: 'text', text }] }, mode: 'execute', confirmed: false });
      const result = response.result as { message?: Message };
      if (result.message) setMessages((current) => mergeMessages(current, [result.message!]));
      await loadSession(activeSession.id, true);
      window.requestAnimationFrame(() => scrollToLatest());
    } catch (cause) { setDraft(text); setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'Message send failed' }); }
    finally { setSending(false); }
  };
  const writable = Boolean(activeSession && activeSession.status === 'active' && activeSession.surface?.writable !== false && canUse);

  return <Stack gap="sm">
    <Group justify="space-between" align="flex-start"><div><Text size="xs" fw={800} tt="uppercase">CHAT control plane</Text><Title order={1}>CHAT</Title><Text c="dimmed">Native sessions and mirrored external conversations, including Telegram.</Text></div><Group gap="xs"><Badge color={realtimeStatus === 'connected' ? 'green' : realtimeStatus === 'connecting' ? 'yellow' : 'red'} variant="light">Realtime {realtimeStatus}</Badge><Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void load()} loading={loading}>Refresh</Button></Group></Group>
    {notice ? <Alert color={notice.color}>{notice.message}</Alert> : null}
    <Paper withBorder className="unify-chat-workspace">
      <aside className="unify-chat-agents" aria-label="Chat agents">
        <div className="unify-chat-rail-head"><Text fw={800}>Agents</Text><Badge variant="light">{agents.length}</Badge></div>
        <ScrollArea className="unify-chat-rail-scroll"><Stack gap={6} p="xs">
          {agents.map((agent) => <button type="button" key={agent.id} className={`unify-chat-rail-item ${agent.id === agentId ? 'active' : ''}`} onClick={() => selectAgent(agent.id)}>
            <Avatar size="sm" radius="xl">{agent.label.slice(0, 2).toUpperCase()}</Avatar><span><strong>{agent.label}</strong><small>{agent.display_metadata?.model_label ?? agent.runtime_agent_id ?? agent.id}</small></span><Badge size="xs" color={agent.status === 'active' ? 'green' : 'gray'}>{agent.status}</Badge>
          </button>)}
          {!agents.length && !loading ? <Text size="sm" c="dimmed" p="sm">No CHAT agents registered.</Text> : null}
        </Stack></ScrollArea>
      </aside>
      <aside className="unify-chat-sessions" aria-label="Agent sessions">
        <div className="unify-chat-rail-head"><div><Text fw={800}>Sessions</Text><Text size="xs" c="dimmed">{activeAgent?.label ?? 'Select an agent'}</Text></div><Tooltip label="Add new session"><Button aria-label="Add new session" size="compact-sm" px="xs" leftSection={<IconMessagePlus size={15} />} disabled={!activeAgent || activeAgent.status !== 'active' || !canUse} onClick={openNew}>New</Button></Tooltip></div>
        <ScrollArea className="unify-chat-rail-scroll"><Stack gap={6} p="xs">
          {agentSessions.map((session) => <button type="button" key={session.id} className={`unify-chat-session-item ${session.id === sessionId ? 'active' : ''}`} onClick={() => selectSession(session.id)}>
            <span className="unify-chat-session-title">{session.title}</span><span className="unify-chat-session-meta">{session.source === 'telegram' ? <IconBrandTelegram size={13} /> : null}{session.channel_label} · {relativeTime(session.updated_at)}</span>
          </button>)}
          {activeAgent && !agentSessions.length ? <Text size="sm" c="dimmed" p="sm">No sessions for this agent. Add the first session above.</Text> : null}
        </Stack></ScrollArea>
      </aside>
      <section className="unify-chat-conversation" aria-label="Selected chat session">
        {activeSession ? <>
          <header className="unify-chat-header"><div><Group gap="xs"><Text fw={800}>{activeSession.title}</Text><Badge variant="light" color={activeSession.source === 'telegram' ? 'blue' : 'gray'}>{activeSession.source === 'dashboard_native' ? 'UNIFY' : activeSession.source}</Badge></Group><Text size="xs" c="dimmed">{activeAgent?.label ?? activeSession.agent_id} · {activeSession.channel_label}{activeSession.surface?.route_kind ? ` · ${activeSession.surface.route_kind}` : ''}</Text></div><Text size="xs" c="dimmed">{historyTruncated ? `Latest ${messages.length} of ${messageTotal} messages` : `${messages.length} messages`}</Text></header>
          <div ref={messageViewport} className="unify-chat-messages" role="log" aria-label="Chat messages" onScroll={(event) => { const node = event.currentTarget; setShowLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 120); }}>
            {loadingMessages ? <Group justify="center" py="xl"><Loader size="sm" /><Text>Loading latest messages…</Text></Group> : null}
            {!loadingMessages && !messages.length ? <Text ta="center" c="dimmed" py="xl">No messages yet. Send the first one.</Text> : null}
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          </div>
          <div className="unify-chat-composer-wrap">
            {showLatest ? <Button className="unify-chat-latest" radius="xl" size="compact-sm" leftSection={<IconArrowDown size={15} />} onClick={() => scrollToLatest()}>Latest messages</Button> : null}
            {activeSession.surface?.writable === false ? <Alert color="yellow" py="xs">This mirrored session is read-only: {activeSession.surface.reason ?? 'CHAT has no writable route'}.</Alert> : null}
            {!canUse ? <Alert color="yellow" py="xs">Your UNIFY role does not include chat.use.</Alert> : null}
            <Group align="flex-end" gap="xs" wrap="nowrap"><Textarea aria-label="Message" placeholder={writable ? `Message ${activeAgent?.label ?? 'agent'}` : 'Sending unavailable'} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} disabled={!writable || sending} rows={2} className="unify-chat-input" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /><Button aria-label="Send message" leftSection={<IconSend size={16} />} disabled={!writable || !draft.trim()} loading={sending} onClick={() => void send()}>Send</Button></Group>
          </div>
        </> : <Box className="unify-chat-empty"><Text fw={700}>Select a session</Text><Text c="dimmed">Choose an agent and session, or add a new session.</Text></Box>}
      </section>
    </Paper>
    <Modal opened={newOpen} onClose={() => setNewOpen(false)} title={`New session · ${activeAgent?.label ?? ''}`} centered><Stack><TextInput label="Session title" value={newTitle} onChange={(event) => setNewTitle(event.currentTarget.value)} autoFocus /><Button leftSection={<IconMessagePlus size={16} />} disabled={!newTitle.trim()} loading={creating} onClick={() => void createSession()}>Create session</Button></Stack></Modal>
  </Stack>;
}

function MessageBubble({ message }: { message: Message }) {
  return <div className={`unify-chat-message ${message.sender_type}`}><div className="unify-chat-message-meta"><strong>{message.sender_type === 'agent' ? 'Agent' : message.sender_type === 'user' ? 'You' : 'System'}</strong><span>{formatTime(message.external_created_at ?? message.created_at)}{message.lifecycle_status !== 'complete' ? ` · ${message.lifecycle_status}` : ''}</span></div><div className="unify-chat-bubble">{message.blocks.map((block, index) => <MessageBlockView key={`${message.id}:${index}`} block={block} />)}</div></div>;
}
function MessageBlockView({ block }: { block: MessageBlock }) {
  if (block.kind === 'text') return <Text component="div" className="unify-chat-text">{block.text}</Text>;
  const url = block.url.startsWith('/uploads/') ? gateway.chatDownloadUrl(block.url) : block.url;
  if (block.kind === 'image') return <a href={url} target="_blank" rel="noreferrer"><img className="unify-chat-image" src={url} alt={block.alt ?? block.name ?? 'Chat attachment'} /></a>;
  return <a href={url} target="_blank" rel="noreferrer">Download {block.name}</a>;
}
function mergeMessages(current: Message[], incoming: Message[]) { const items = new Map(current.map((message) => [message.id, message])); for (const message of incoming) items.set(message.id, message); return [...items.values()].sort((a, b) => a.seq - b.seq); }
function relativeTime(value: string) { const time = new Date(value).getTime(); const minutes = Math.max(0, Math.round((Date.now() - time) / 60000)); if (minutes < 1) return 'now'; if (minutes < 60) return `${minutes}m`; const hours = Math.round(minutes / 60); if (hours < 24) return `${hours}h`; return `${Math.round(hours / 24)}d`; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
