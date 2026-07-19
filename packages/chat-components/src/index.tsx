import {
  Alert,
  Box,
  Button,
  Group,
  NavLink,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { IconRefresh, IconSend } from '@tabler/icons-react';
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { UnifiedResource } from '@aquiero/auth-client';

export interface ChatWorkspaceProps {
  sessions: UnifiedResource[];
  messages: UnifiedResource[];
  selectedSession: string;
  onSelectSession: (sessionId: string) => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
  onSend?: () => void;
  onRefresh?: () => void;
  sending?: boolean;
  error?: string;
}

function field(data: Record<string, unknown>, names: string[]): string {
  for (const name of names) if (typeof data[name] === 'string') return data[name] as string;
  return '';
}

export function ChatWorkspace(props: ChatWorkspaceProps) {
  const shown = props.messages.filter(
    (item) =>
      props.selectedSession === 'all' ||
      field(item.data, ['session_id', 'sessionId']) === props.selectedSession,
  );
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 96,
    overscan: 8,
  });
  const composerEnabled = Boolean(
    props.onSend && props.onDraftChange && props.selectedSession !== 'all',
  );
  return (
    <Stack>
      {props.error && (
        <Alert color="red" title="Chat action failed">
          {props.error}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, md: 4 }}>
        <Paper withBorder p="sm">
          <Group justify="space-between" mb="sm">
            <Text fw={700}>Sessions</Text>
            {props.onRefresh && (
              <Button
                size="compact-xs"
                variant="subtle"
                aria-label="Refresh Chat"
                onClick={props.onRefresh}
              >
                <IconRefresh size={16} />
              </Button>
            )}
          </Group>
          <ScrollArea h={{ base: 180, md: 560 }}>
            <NavLink
              active={props.selectedSession === 'all'}
              label="All sessions"
              onClick={() => props.onSelectSession('all')}
            />
            {props.sessions.map((item) => (
              <NavLink
                key={item.resource.canonicalId}
                active={props.selectedSession === item.resource.nativeId}
                label={item.title}
                description={item.resource.nativeId}
                onClick={() => props.onSelectSession(item.resource.nativeId)}
              />
            ))}
          </ScrollArea>
        </Paper>
        <Box style={{ gridColumn: 'span 3', minWidth: 0 }}>
          <Stack>
            <div
              ref={parent}
              style={{
                height: 'min(62vh, 38rem)',
                overflow: 'auto',
                contain: 'strict',
                position: 'relative',
              }}
              aria-label="Virtualized Chat messages"
              role="log"
            >
              <div style={{ height: virtual.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtual.getVirtualItems().map((row) => {
                  const item = shown[row.index];
                  if (!item) return null;
                  return (
                    <div
                      key={item.resource.canonicalId}
                      ref={virtual.measureElement}
                      data-index={row.index}
                      style={{
                        position: 'absolute',
                        insetInline: 0,
                        top: 0,
                        transform: `translateY(${row.start}px)`,
                        paddingBottom: '0.5rem',
                      }}
                    >
                      <Paper withBorder p="sm">
                        <Group justify="space-between">
                          <Text fw={700}>
                            {field(item.data, ['role', 'sender', 'author']) || item.title}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {new Date(item.resource.observedAt).toLocaleString()}
                          </Text>
                        </Group>
                        <Text
                          size="sm"
                          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                        >
                          {field(item.data, ['content', 'text', 'message']) || item.searchableText}
                        </Text>
                      </Paper>
                    </div>
                  );
                })}
              </div>
            </div>
            {props.onDraftChange && (
              <Paper withBorder p="sm">
                <Textarea
                  label="Message"
                  description={
                    composerEnabled
                      ? `Send to ${props.selectedSession}`
                      : 'Select one writable session to send'
                  }
                  minRows={3}
                  maxRows={8}
                  autosize
                  value={props.draft ?? ''}
                  disabled={!composerEnabled}
                  onChange={(event) => props.onDraftChange?.(event.currentTarget.value)}
                />
                <Group justify="flex-end" mt="sm">
                  <Button
                    leftSection={<IconSend size={16} />}
                    disabled={!composerEnabled || !(props.draft ?? '').trim()}
                    loading={Boolean(props.sending)}
                    onClick={() => props.onSend?.()}
                  >
                    Send
                  </Button>
                </Group>
              </Paper>
            )}
          </Stack>
        </Box>
      </SimpleGrid>
    </Stack>
  );
}
