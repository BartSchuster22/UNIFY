import { Alert, Box, Button, Group, Stack, Text, Title } from '@mantine/core';
import { NotificationInbox } from '@aquiero/notification-components';
import { AsyncState, FocusedApplication } from '@aquiero/design-system';
import { GatewayClient, GatewayError, type UnifiedNotification } from '@aquiero/auth-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

const client = new GatewayClient();
const READ_PERMISSIONS = [
  'profiles.read',
  'frameworks.read',
  'models.read',
  'work.read',
  'chat.read',
  'memory.read',
  'operations.read',
];

export function App() {
  return (
    <FocusedApplication
      name="Aquiero Alerts"
      description="Focused notification inbox"
      client={client}
      requiredAnyPermission={READ_PERMISSIONS}
    >
      {() => <AlertsPage />}
    </FocusedApplication>
  );
}

function AlertsPage() {
  const [notifications, setNotifications] = useState<UnifiedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acknowledging, setAcknowledging] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNotifications(
        (await client.collection<UnifiedNotification>('/notifications?limit=500')).items,
      );
    } catch (cause) {
      setError(
        cause instanceof GatewayError ? cause.failure.message : 'Alerts could not be loaded',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const acknowledge = async (id: string) => {
    setAcknowledging(id);
    setError('');
    try {
      await client.acknowledgeNotification(id);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof GatewayError ? cause.failure.message : 'Alert could not be acknowledged',
      );
    } finally {
      setAcknowledging('');
    }
  };
  const activeCount = useMemo(
    () => notifications.filter((item) => item.state !== 'acknowledged').length,
    [notifications],
  );
  const uniuiBaseUrl =
    import.meta.env.VITE_UNIUI_URL ??
    `${window.location.protocol}//${window.location.hostname}:3000`;
  return (
    <Box maw={1120} mx="auto">
      <Stack>
        <Group justify="space-between" align="end">
          <Box>
            <Title order={1}>Alerts</Title>
            <Text c="dimmed">Permission-aware owner alerts with durable acknowledgement.</Text>
          </Box>
          <Button variant="light" onClick={() => void refresh()}>
            Refresh
          </Button>
        </Group>
        <Alert
          color={activeCount > 0 ? 'orange' : 'green'}
          title={`${activeCount} active alert${activeCount === 1 ? '' : 's'}`}
        >
          Polling authoritative owners every 30 seconds. No API response or authenticated data is
          cached by the service worker.
        </Alert>
        <AsyncState loading={loading} error={error} empty={!loading && notifications.length === 0}>
          <NotificationInbox
            notifications={notifications}
            onAcknowledge={(id) => void acknowledge(id)}
            acknowledgingId={acknowledging}
            uniuiBaseUrl={uniuiBaseUrl}
          />
        </AsyncState>
      </Stack>
    </Box>
  );
}
