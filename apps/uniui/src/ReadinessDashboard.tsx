import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconExternalLink, IconRefresh, IconShieldCheck } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useFrameworkContext } from './FrameworkContext';
import type { Principal } from './types';

type Provenance = {
  frameworkId: string;
  frameworkCommit: string;
  sourceVersion: string;
  observedAt: string;
  freshness?: string;
};
type Capability = {
  status: 'supported' | 'unsupported' | 'unavailable' | 'forbidden' | string;
  reasonCode?: string;
};
type Capabilities = {
  meta: Provenance;
  data: { capabilities: Record<string, Capability> };
};
type Health = {
  meta: Provenance;
  data: { status: string; checks: Record<string, { status: string }> };
};
type Provider = {
  id: string;
  displayName: string;
  selected: boolean;
  credentialStatus: 'configured' | 'missing' | 'unknown';
  authType?: 'api_key' | 'oauth' | 'none' | 'unknown';
};
type Model = { id: string; displayName: string; providerId: string; selected: boolean };
type Profile = {
  id: string;
  displayName: string;
  active: boolean;
  gatewayStatus: 'running' | 'stopped' | 'unknown';
  model?: string;
};
type Collection<T> = { meta: Provenance; items: T[] };
type MemoryStatus = { status: string; contractVersion?: string };
type Probe<T> = { value?: T; failure?: string; skipped?: string };
type Snapshot = {
  health: Probe<Health>;
  capabilities: Probe<Capabilities>;
  providers: Probe<Collection<Provider>>;
  models: Probe<Collection<Model>>;
  profiles: Probe<Collection<Profile>>;
  memory: Probe<MemoryStatus>;
};
type ReadinessState = 'ready' | 'attention' | 'blocked' | 'unavailable';
type ReadinessItem = {
  id: string;
  area: string;
  state: ReadinessState;
  summary: string;
  evidence: string;
  action?: { label: string; view: string };
};

const emptySnapshot: Snapshot = {
  health: {},
  capabilities: {},
  providers: {},
  models: {},
  profiles: {},
  memory: {},
};

export function ReadinessDashboard({ principal }: { principal: Principal }) {
  const {
    frameworks,
    frameworkId,
    loading: frameworksLoading,
    error: frameworkError,
    selectionIssue,
    selectFramework,
    refreshFrameworks,
  } = useFrameworkContext();
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState('');
  const generation = useRef(0);
  const selectedFramework = useRef(frameworkId);
  selectedFramework.current = frameworkId;

  const load = useCallback(async () => {
    const requestGeneration = ++generation.current;
    const requestedFramework = frameworkId;
    if (!requestedFramework) {
      setSnapshot(emptySnapshot);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = `/frameworks/${encodeURIComponent(requestedFramework)}`;
    const canReadModels = principal.permissions.includes('models.read');
    const canReadProfiles = principal.permissions.includes('profiles.read');
    const canReadMemory = principal.permissions.includes('memory.read');
    const probes = await Promise.all([
      probe(() => api<Health>(`${base}/health`)),
      probe(() => api<Capabilities>(`${base}/capabilities`)),
      canReadModels
        ? probe(() => api<Collection<Provider>>(`${base}/providers?limit=500`))
        : Promise.resolve({ skipped: 'models.read permission is required' }),
      canReadModels
        ? probe(() => api<Collection<Model>>(`${base}/models?limit=500`))
        : Promise.resolve({ skipped: 'models.read permission is required' }),
      canReadProfiles
        ? probe(() => api<Collection<Profile>>(`${base}/profiles?limit=500`))
        : Promise.resolve({ skipped: 'profiles.read permission is required' }),
      canReadMemory
        ? probe(() => api<MemoryStatus>('/memory/status'))
        : Promise.resolve({ skipped: 'memory.read permission is required' }),
    ]);
    if (
      requestGeneration !== generation.current ||
      selectedFramework.current !== requestedFramework
    )
      return;
    setSnapshot({
      health: probes[0],
      capabilities: probes[1],
      providers: probes[2],
      models: probes[3],
      profiles: probes[4],
      memory: probes[5],
    });
    setCheckedAt(new Date().toISOString());
    setLoading(false);
  }, [frameworkId, principal.permissions]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      ++generation.current;
      window.clearInterval(timer);
    };
  }, [load]);

  const items = useMemo(
    () => readinessItems(snapshot, principal, Boolean(frameworkId)),
    [frameworkId, principal, snapshot],
  );
  const ready = items.filter((item) => item.state === 'ready').length;
  const blocked = items.filter((item) => item.state === 'blocked').length;
  const unavailable = items.filter((item) => item.state === 'unavailable').length;
  const overall: ReadinessState = unavailable
    ? 'unavailable'
    : blocked
      ? 'blocked'
      : ready === items.length
        ? 'ready'
        : 'attention';
  const framework = frameworks.find((item) => item.frameworkId === frameworkId);
  const observed =
    snapshot.health.value?.meta ??
    snapshot.capabilities.value?.meta ??
    snapshot.providers.value?.meta ??
    snapshot.models.value?.meta ??
    snapshot.profiles.value?.meta;

  const recheck = async () => {
    await refreshFrameworks();
    await load();
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Operator control plane
          </Text>
          <Title order={1}>Readiness dashboard</Title>
          <Text c="dimmed">
            Live, owner-reported prerequisites for operating the selected Hermes framework through
            UNIFY.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading || frameworksLoading}
          onClick={() => void recheck()}
        >
          Recheck all
        </Button>
      </Group>

      {frameworkError || selectionIssue ? (
        <Alert color="red" title="Framework selection unavailable">
          {frameworkError || selectionIssue}
        </Alert>
      ) : null}
      <Select
        label="Framework"
        description="Every framework readiness probe below targets this exact verified registration."
        value={frameworkId}
        onChange={(value) => selectFramework(value ?? '')}
        data={frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName }))}
        disabled={frameworksLoading}
        allowDeselect={false}
      />

      {!frameworkId ? (
        <Alert color="red" title="Readiness blocked">
          Select an enabled, verified Hermes framework. No fallback framework is probed.
        </Alert>
      ) : (
        <>
          <Alert color={stateColor(overall)} title={`Overall readiness: ${stateLabel(overall)}`}>
            {overall === 'ready'
              ? `${framework?.displayName ?? frameworkId} has all ${items.length} checked prerequisites ready.`
              : `${ready} of ${items.length} checked prerequisites are ready; ${blocked} blocked and ${unavailable} unavailable.`}
          </Alert>

          <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
            <Metric label="Ready checks" value={`${ready}/${items.length}`} color="teal" />
            <Metric label="Needs attention" value={String(items.length - ready)} color="yellow" />
            <Metric label="Blocked" value={String(blocked)} color="red" />
            <Metric label="Unavailable" value={String(unavailable)} color="orange" />
          </SimpleGrid>
          <Progress
            value={items.length ? (ready / items.length) * 100 : 0}
            color={stateColor(overall)}
            size="lg"
            aria-label={`${ready} of ${items.length} readiness checks ready`}
          />

          <Card withBorder>
            <Group justify="space-between" mb="sm">
              <Text fw={800}>Readiness checks</Text>
              {loading ? (
                <span role="status" aria-label="Checking readiness">
                  <Loader size="xs" />
                </span>
              ) : null}
            </Group>
            <Table.ScrollContainer minWidth={880}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Area</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Finding</Table.Th>
                    <Table.Th>Authoritative evidence</Table.Th>
                    <Table.Th>Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Text fw={700}>{item.area}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={stateColor(item.state)}>{stateLabel(item.state)}</Badge>
                      </Table.Td>
                      <Table.Td>{item.summary}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {item.evidence}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {item.action && canOpenView(item.action.view, principal) ? (
                          <Button
                            component="a"
                            size="compact-xs"
                            variant="subtle"
                            rightSection={<IconExternalLink size={13} />}
                            href={viewLink(item.action.view, frameworkId)}
                          >
                            {item.action.label}
                          </Button>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>

          <Paper withBorder p="md">
            <Group align="flex-start" wrap="nowrap">
              <IconShieldCheck size={22} />
              <Stack gap={2}>
                <Text fw={700}>Evidence and freshness</Text>
                <Text size="sm" c="dimmed">
                  Framework <Code>{frameworkId}</Code> · commit{' '}
                  <Code>{observed?.frameworkCommit ?? 'not observed'}</Code> · source{' '}
                  <Code>{observed?.sourceVersion ?? 'not observed'}</Code>
                </Text>
                <Text size="sm" c="dimmed" aria-live="polite">
                  {checkedAt
                    ? `Last complete probe ${new Date(checkedAt).toLocaleString()}; automatic recheck every 30 seconds.`
                    : 'No complete probe has been observed.'}
                </Text>
              </Stack>
            </Group>
          </Paper>
        </>
      )}
    </Stack>
  );
}

async function probe<T>(request: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { value: await request() };
  } catch (cause) {
    return { failure: cause instanceof Error ? cause.message : 'Owner probe failed' };
  }
}

function readinessItems(
  snapshot: Snapshot,
  principal: Principal,
  hasFramework: boolean,
): ReadinessItem[] {
  if (!hasFramework)
    return [
      {
        id: 'framework',
        area: 'Framework registration',
        state: 'blocked',
        summary: 'No exact framework selected',
        evidence: 'Framework registry has no selected enabled and verified registration.',
        action: { label: 'Open frameworks', view: 'frameworks' },
      },
    ];
  const capability = (name: string) => snapshot.capabilities.value?.data.capabilities[name];
  const health = snapshot.health.value?.data;
  const selectedProvider = snapshot.providers.value?.items.find((item) => item.selected);
  const selectedModel = snapshot.models.value?.items.find((item) => item.selected);
  const profiles = snapshot.profiles.value?.items ?? [];
  const usableProfiles = profiles.filter((item) => item.gatewayStatus === 'running');
  const providerReady =
    selectedProvider?.credentialStatus === 'configured' || selectedProvider?.authType === 'none';
  const access = ['frameworks.read', 'models.read', 'profiles.read', 'work.read', 'chat.read'];
  const missingAccess = access.filter((permission) => !principal.permissions.includes(permission));

  return [
    probeItem(
      'framework',
      'Framework runtime',
      snapshot.health,
      health?.status === 'healthy',
      health?.status === 'degraded' ? 'attention' : 'blocked',
      health ? `Hermes reports ${health.status}` : 'No framework health response',
      health
        ? Object.entries(health.checks)
            .map(([name, check]) => `${name}=${check.status}`)
            .join(', ')
        : '',
      { label: 'Open frameworks', view: 'frameworks' },
    ),
    probeItem(
      'provider',
      'Provider authentication',
      snapshot.providers,
      Boolean(selectedProvider && providerReady),
      'blocked',
      selectedProvider
        ? providerReady
          ? `${selectedProvider.displayName} is credential-ready`
          : `${selectedProvider.displayName} requires authentication`
        : 'No provider is selected',
      selectedProvider
        ? `credential=${selectedProvider.credentialStatus}, auth=${selectedProvider.authType ?? 'unknown'}`
        : 'Hermes provider inventory contains no selected provider.',
      { label: 'Open models & providers', view: 'models' },
    ),
    probeItem(
      'model',
      'Model selection',
      snapshot.models,
      Boolean(selectedModel),
      'blocked',
      selectedModel ? `${selectedModel.displayName} is selected` : 'No model is selected',
      selectedModel
        ? `model=${selectedModel.id}, provider=${selectedModel.providerId}`
        : 'Hermes model inventory contains no selected model.',
      { label: 'Open models & providers', view: 'models' },
    ),
    probeItem(
      'profile',
      'Agent profiles',
      snapshot.profiles,
      usableProfiles.length > 0,
      'blocked',
      usableProfiles.length
        ? `${usableProfiles.length} of ${profiles.length} profiles have a running gateway`
        : 'No profile has a running gateway',
      profiles.length
        ? profiles
            .map(
              (profile) =>
                `${profile.id}=${profile.gatewayStatus}${profile.model ? `/${profile.model}` : ''}`,
            )
            .join(', ')
        : 'Hermes profile inventory is empty.',
      { label: 'Open profiles', view: 'profiles' },
    ),
    capabilityItem(
      'work',
      'Work execution',
      snapshot.capabilities,
      capability('work.execute'),
      'Hermes native project, task, and cron mutations',
      { label: 'Open Work', view: 'work' },
    ),
    capabilityItem(
      'chat',
      'Internal Chat execution',
      snapshot.capabilities,
      capability('conversations.execute'),
      'Hermes internal session creation and message send',
      { label: 'Open Chat', view: 'chat' },
    ),
    probeItem(
      'memory',
      'MemoryV4',
      snapshot.memory,
      snapshot.memory.value?.status === 'ready',
      'blocked',
      snapshot.memory.value
        ? `MemoryV4 reports ${snapshot.memory.value.status}`
        : 'No MemoryV4 readiness response',
      snapshot.memory.value?.contractVersion
        ? `contract=${snapshot.memory.value.contractVersion}`
        : 'MemoryV4 /status is the authority.',
      { label: 'Open Memory', view: 'memory' },
    ),
    {
      id: 'access',
      area: 'Operator access',
      state: missingAccess.length ? 'attention' : 'ready',
      summary: missingAccess.length
        ? `${missingAccess.length} read permissions are not granted`
        : 'Required operator read permissions are granted',
      evidence: missingAccess.length
        ? `Missing: ${missingAccess.join(', ')}`
        : `Principal ${principal.username} is authorized for all dashboard domains.`,
      action: { label: 'Open settings', view: 'settings' },
    },
  ];
}

function probeItem<T>(
  id: string,
  area: string,
  probeState: Probe<T>,
  ready: boolean,
  falseState: ReadinessState,
  summary: string,
  evidence: string,
  action?: ReadinessItem['action'],
): ReadinessItem {
  if (probeState.skipped)
    return {
      id,
      area,
      state: 'attention',
      summary: 'Not checked for this operator',
      evidence: probeState.skipped,
      ...(action ? { action } : {}),
    };
  if (probeState.failure)
    return {
      id,
      area,
      state: 'unavailable',
      summary: 'Authoritative owner probe failed',
      evidence: probeState.failure,
      ...(action ? { action } : {}),
    };
  return {
    id,
    area,
    state: ready ? 'ready' : falseState,
    summary,
    evidence,
    ...(action ? { action } : {}),
  };
}

function capabilityItem(
  id: string,
  area: string,
  probeState: Probe<Capabilities>,
  capability: Capability | undefined,
  description: string,
  action: NonNullable<ReadinessItem['action']>,
): ReadinessItem {
  if (probeState.failure)
    return {
      id,
      area,
      state: 'unavailable',
      summary: 'Capability manifest unavailable',
      evidence: probeState.failure,
      action,
    };
  if (!capability)
    return {
      id,
      area,
      state: 'blocked',
      summary: 'Capability was not declared',
      evidence: `${description}; no manifest entry was returned.`,
      action,
    };
  return {
    id,
    area,
    state: capability.status === 'supported' ? 'ready' : 'blocked',
    summary: `${description}: ${capability.status}`,
    evidence: capability.reasonCode
      ? `reason=${capability.reasonCode}`
      : `Hermes manifest reports ${capability.status}.`,
    action,
  };
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card withBorder>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text size="2rem" fw={800} c={color}>
        {value}
      </Text>
    </Card>
  );
}

function stateColor(state: ReadinessState): string {
  return state === 'ready'
    ? 'teal'
    : state === 'attention'
      ? 'yellow'
      : state === 'blocked'
        ? 'red'
        : 'orange';
}

function stateLabel(state: ReadinessState): string {
  return state === 'ready'
    ? 'Ready'
    : state === 'attention'
      ? 'Attention'
      : state === 'blocked'
        ? 'Blocked'
        : 'Unavailable';
}

function canOpenView(view: string, principal: Principal): boolean {
  const permission: Record<string, string> = {
    frameworks: 'frameworks.read',
    models: 'models.read',
    profiles: 'profiles.read',
    work: 'work.read',
    chat: 'chat.read',
    memory: 'memory.read',
  };
  return !permission[view] || principal.permissions.includes(permission[view]);
}

function viewLink(view: string, frameworkId: string): string {
  const url = new URL(window.location.href);
  url.pathname = view === 'overview' ? '/' : `/${encodeURIComponent(view)}`;
  url.searchParams.delete('view');
  if (view !== 'work') {
    url.searchParams.delete('workPage');
    url.searchParams.delete('project');
  }
  url.searchParams.set('framework', frameworkId);
  return `${url.pathname}${url.search}`;
}
