import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconRefresh, IconSparkles } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Framework = {
  frameworkId: string;
  displayName: string;
  status: 'verified' | 'disabled' | 'unavailable' | 'unsupported';
  enabled: boolean;
};
type Provider = {
  id: string;
  displayName: string;
  credentialStatus: 'configured' | 'missing' | 'unknown';
  selected: boolean;
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
  items: Provider[];
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

export function ModelsView({ canManageCredentials }: { canManageCredentials: boolean }) {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworkId, setFrameworkId] = useState(
    () => new URLSearchParams(window.location.search).get('framework') ?? '',
  );
  const [collection, setCollection] = useState<Collection | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<{ items: Framework[] }>('/frameworks')
      .then((response) => {
        const available = response.items.filter(
          (item) => item.enabled && item.status === 'verified',
        );
        setFrameworks(available);
        setFrameworkId((current) =>
          available.some((item) => item.frameworkId === current)
            ? current
            : (available[0]?.frameworkId ?? ''),
        );
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Hermes framework discovery failed');
        setLoading(false);
      });
  }, []);

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
      const [providers, manifest] = await Promise.all([
        api<Collection>(`/frameworks/${encodeURIComponent(frameworkId)}/providers?limit=100`),
        api<Capabilities>(`/frameworks/${encodeURIComponent(frameworkId)}/capabilities`),
      ]);
      setCollection(providers);
      setCapabilities(manifest);
      const url = new URL(window.location.href);
      url.searchParams.set('framework', frameworkId);
      window.history.replaceState(null, '', url);
    } catch (cause) {
      setCollection(null);
      setCapabilities(null);
      setError(cause instanceof Error ? cause.message : 'Hermes provider inventory unavailable');
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
        `/frameworks/${encodeURIComponent(frameworkId)}/providers?limit=100&cursor=${encodeURIComponent(cursor)}`,
      );
      setCollection((current) =>
        current ? { ...next, items: [...current.items, ...next.items] } : next,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Next Hermes provider page unavailable');
    } finally {
      setLoadingMore(false);
    }
  };

  const credentialExecute = capabilities?.data.capabilities['providers.credentials.execute'];
  const configured =
    collection?.items.filter((item) => item.credentialStatus === 'configured').length ?? 0;
  const selected = collection?.items.find((item) => item.selected);
  const frameworkOptions = useMemo(
    () => frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName })),
    [frameworks],
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Hermes source of truth
          </Text>
          <Title order={1}>Models & Providers</Title>
          <Text c="dimmed">
            Provider availability and credential state come directly from the selected registered
            Hermes framework.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={() => void load()}
          loading={loading}
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
          No enabled, verified Hermes framework is registered. Provider/model truth is unavailable.
        </Alert>
      ) : null}
      <Alert color="blue">
        The current Hermes control contract exposes provider selection and safe credential status
        only. Full model-catalog discovery is not advertised, so UNIFY does not synthesize a model
        list from DMM.
      </Alert>
      {credentialExecute && credentialExecute.status !== 'supported' ? (
        <Alert color="blue">
          Provider credential changes are disabled: Hermes reports{' '}
          <strong>{credentialExecute.status}</strong>
          {credentialExecute.reasonCode ? ` (${credentialExecute.reasonCode})` : ''}. Secret input
          is not rendered and no credential is sent to DMM.
          {canManageCredentials ? '' : ' Your role is also read-only.'}
        </Alert>
      ) : null}
      {loading && !collection ? (
        <Group>
          <Loader size="sm" />
          <Text>Loading Hermes providers…</Text>
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
          </Group>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Summary label="Providers" value={collection.items.length} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Summary label="Credentials configured" value={configured} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Summary label="Selected provider" value={selected?.displayName ?? 'Unknown'} />
            </Grid.Col>
          </Grid>
          <Grid>
            {collection.items.map((provider) => (
              <Grid.Col
                key={`${provider.frameworkId}:${provider.id}`}
                span={{ base: 12, md: 6, xl: 4 }}
              >
                <Card withBorder h="100%">
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text fw={700}>{provider.displayName}</Text>
                        <Text size="xs" c="dimmed">
                          {provider.id}
                        </Text>
                      </div>
                      {provider.selected ? (
                        <Badge leftSection={<IconSparkles size={12} />}>Selected</Badge>
                      ) : null}
                    </Group>
                    <Group>
                      <Badge color={credentialColor(provider.credentialStatus)}>
                        Auth: {provider.credentialStatus}
                      </Badge>
                      <Badge color={provider.owner === 'hermes' ? 'teal' : 'red'}>
                        {provider.owner}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      No credential value, fingerprint, variable name, or secret location is
                      exposed.
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
          {!collection.items.length ? (
            <Alert color="yellow">
              Hermes returned no providers. This is not treated as a successful DMM fallback.
            </Alert>
          ) : null}
          {collection.page.hasMore ? (
            <Button variant="light" loading={loadingMore} onClick={() => void loadMore()}>
              Load more providers
            </Button>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <Card withBorder>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text size="xl" fw={800}>
        {value}
      </Text>
    </Card>
  );
}
function credentialColor(status: Provider['credentialStatus']) {
  return status === 'configured' ? 'teal' : status === 'missing' ? 'yellow' : 'gray';
}
function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
