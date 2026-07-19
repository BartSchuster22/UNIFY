import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconCheck, IconExternalLink } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import type { UnifiedNotification } from '@aquiero/auth-client';

export interface NotificationInboxProps {
  notifications: UnifiedNotification[];
  onAcknowledge?: (id: string) => void;
  acknowledgingId?: string;
  uniuiBaseUrl?: string;
}

const colors = { info: 'blue', warning: 'orange', error: 'red', critical: 'red' } as const;

export function NotificationInbox({
  notifications,
  onAcknowledge,
  acknowledgingId,
  uniuiBaseUrl = '',
}: NotificationInboxProps) {
  const [state, setState] = useState('active');
  const [severity, setSeverity] = useState('all');
  const filtered = notifications.filter(
    (item) =>
      (state === 'all' ||
        (state === 'active' ? item.state !== 'acknowledged' : item.state === state)) &&
      (severity === 'all' || item.severity === severity),
  );
  const groups = useMemo(() => {
    const result = new Map<string, UnifiedNotification[]>();
    for (const item of filtered)
      result.set(item.source, [...(result.get(item.source) ?? []), item]);
    return [...result.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filtered]);
  return (
    <Stack>
      <Group align="end">
        <SegmentedControl
          aria-label="Notification state"
          value={state}
          onChange={setState}
          data={[
            { label: 'Active', value: 'active' },
            { label: 'Acknowledged', value: 'acknowledged' },
            { label: 'All', value: 'all' },
          ]}
        />
        <Select
          label="Severity"
          value={severity}
          onChange={(value) => setSeverity(value ?? 'all')}
          data={['all', 'critical', 'error', 'warning', 'info']}
          allowDeselect={false}
        />
      </Group>
      {groups.length === 0 && (
        <Alert color="blue" title="No matching alerts">
          Change the filters or refresh the authoritative inbox.
        </Alert>
      )}
      {groups.map(([source, items]) => (
        <Stack key={source} gap="xs">
          <Title order={2} size="h4">
            {source} <Badge variant="light">{items.length}</Badge>
          </Title>
          {items.map((item) => (
            <Alert
              key={item.id}
              color={colors[item.severity]}
              title={
                <Group gap="xs">
                  <Text fw={700}>{item.title}</Text>
                  <Badge color={colors[item.severity]}>{item.severity}</Badge>
                </Group>
              }
            >
              <Text>{item.body}</Text>
              <Group mt="sm" justify="space-between">
                <Text size="xs">
                  {new Date(item.createdAt).toLocaleString()} · {item.state}
                </Text>
                <Group gap="xs">
                  {item.deepLink && (
                    <Anchor
                      href={`${uniuiBaseUrl}${item.deepLink}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Group gap={4}>
                        Open in UNIUI <IconExternalLink size={14} />
                      </Group>
                    </Anchor>
                  )}
                  {onAcknowledge && item.state !== 'acknowledged' && (
                    <Button
                      size="compact-sm"
                      variant="light"
                      leftSection={<IconCheck size={14} />}
                      loading={acknowledgingId === item.id}
                      onClick={() => onAcknowledge(item.id)}
                    >
                      Acknowledge
                    </Button>
                  )}
                </Group>
              </Group>
            </Alert>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
