import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconRefresh, IconUsers } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Framework = {
  frameworkId: string;
  displayName: string;
  status: 'verified' | 'disabled' | 'unavailable' | 'unsupported';
  enabled: boolean;
};
type Profile = {
  id: string;
  displayName: string;
  active: boolean;
  gatewayStatus: 'running' | 'stopped' | 'unknown';
  model?: string;
  provider?: string;
  owner: 'hermes';
  frameworkId: string;
  sourceVersion: string;
  observedAt: string;
};
type Collection = {
  meta: {
    owner: 'hermes';
    frameworkId: string;
    frameworkVersion: string;
    frameworkCommit: string;
    sourceVersion: string;
    observedAt: string;
    freshness: 'current';
  };
  items: Profile[];
  page: { hasMore: boolean; nextCursor?: string };
};
type Capabilities = {
  meta: Collection['meta'];
  data: {
    capabilities: Record<
      string,
      { status: 'supported' | 'unsupported' | 'unavailable' | 'forbidden'; reasonCode?: string }
    >;
  };
};

export function ProfilesView({
  canManage,
}: {
  canManage: boolean;
  canManageModels: boolean;
  canDelete: boolean;
}) {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworkId, setFrameworkId] = useState(
    () => new URLSearchParams(window.location.search).get('framework') ?? '',
  );
  const [collection, setCollection] = useState<Collection | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const discover = useCallback(async () => {
    const response = await api<{ items: Framework[] }>('/frameworks');
    const available = response.items.filter((item) => item.enabled && item.status === 'verified');
    setFrameworks(available);
    setFrameworkId((current) =>
      available.some((item) => item.frameworkId === current)
        ? current
        : (available[0]?.frameworkId ?? ''),
    );
  }, []);

  useEffect(() => {
    void discover().catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Hermes framework discovery failed');
      setLoading(false);
    });
  }, [discover]);

  const load = useCallback(async () => {
    if (!frameworkId) {
      setCollection(null);
      setCapabilities(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [profiles, manifest] = await Promise.all([
        api<Collection>(`/frameworks/${encodeURIComponent(frameworkId)}/profiles?limit=100`),
        api<Capabilities>(`/frameworks/${encodeURIComponent(frameworkId)}/capabilities`),
      ]);
      setCollection(profiles);
      setCapabilities(manifest);
      const url = new URL(window.location.href);
      url.searchParams.set('framework', frameworkId);
      window.history.replaceState(null, '', url);
    } catch (cause) {
      setCollection(null);
      setCapabilities(null);
      setError(cause instanceof Error ? cause.message : 'Hermes profile inventory unavailable');
    } finally {
      setLoading(false);
    }
  }, [frameworkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const cursor = collection?.page.nextCursor;
    if (!cursor || !frameworkId) return;
    setLoadingMore(true);
    setError('');
    try {
      const next = await api<Collection>(
        `/frameworks/${encodeURIComponent(frameworkId)}/profiles?limit=100&cursor=${encodeURIComponent(cursor)}`,
      );
      setCollection((current) =>
        current ? { ...next, items: [...current.items, ...next.items] } : next,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Next Hermes profile page unavailable');
    } finally {
      setLoadingMore(false);
    }
  };

  const execute = capabilities?.data.capabilities['profiles.execute'];
  const frameworkOptions = useMemo(
    () => frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName })),
    [frameworks],
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Hermes source of truth
          </Text>
          <Title>Profiles</Title>
          <Text c="dimmed">
            Profiles are read directly from the selected registered Hermes framework through UNIFY
            Gateway.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </Group>
      <Select
        label="Hermes framework"
        value={frameworkId || null}
        data={frameworkOptions}
        onChange={(value) => setFrameworkId(value ?? '')}
        placeholder="No verified Hermes framework"
      />
      {error ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      ) : null}
      {!loading && !frameworks.length ? (
        <Alert color="yellow">
          No enabled, verified Hermes framework is registered. Profile truth is unavailable.
        </Alert>
      ) : null}
      {execute && execute.status !== 'supported' ? (
        <Alert color="blue">
          Profile changes are disabled: Hermes reports <strong>{execute.status}</strong>
          {execute.reasonCode ? ` (${execute.reasonCode})` : ''}. UNIFY will not route writes to a
          legacy owner or approximate them locally.
          {canManage ? '' : ' Your role is also read-only.'}
        </Alert>
      ) : null}
      {loading && !collection ? (
        <Group>
          <Loader size="sm" />
          <Text>Loading Hermes profiles…</Text>
        </Group>
      ) : null}
      {collection ? (
        <>
          <Group>
            <Badge color="teal">Hermes · current</Badge>
            <Text size="sm" c="dimmed">
              Framework {collection.meta.frameworkId}
            </Text>
            <Text size="sm" c="dimmed">
              Observed {formatDate(collection.meta.observedAt)}
            </Text>
            <Text size="sm" c="dimmed">
              {collection.items.length} profiles
            </Text>
          </Group>
          {!collection.items.length ? (
            <Alert color="yellow">Hermes returned no profiles for this framework.</Alert>
          ) : (
            <Paper withBorder>
              <ScrollArea>
                <Table verticalSpacing="md" miw={720} aria-label="Hermes profiles">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Provider</Table.Th>
                      <Table.Th>Runtime</Table.Th>
                      <Table.Th>Truth</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {collection.items.map((profile) => (
                      <Table.Tr key={`${profile.frameworkId}:${profile.id}`}>
                        <Table.Td>
                          <Group gap="xs">
                            <IconUsers size={16} />
                            <div>
                              <Text fw={600}>{profile.displayName}</Text>
                              <Text size="xs" c="dimmed">
                                {profile.id}
                              </Text>
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td>{profile.model ?? 'Not reported'}</Table.Td>
                        <Table.Td>{profile.provider ?? 'Not reported'}</Table.Td>
                        <Table.Td>
                          <Badge
                            color={
                              profile.gatewayStatus === 'running'
                                ? 'teal'
                                : profile.gatewayStatus === 'stopped'
                                  ? 'gray'
                                  : 'yellow'
                            }
                          >
                            {profile.gatewayStatus}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={profile.owner === 'hermes' ? 'teal' : 'red'}>
                            {profile.owner}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          )}
          {collection.page.hasMore ? (
            <Button variant="light" loading={loadingMore} onClick={() => void loadMore()}>
              Load more profiles
            </Button>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}

function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
