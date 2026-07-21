import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Group,
  Loader,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, gateway } from './api';

type Framework = { id: string; name: string; default?: boolean; status?: string };
type ModelOption = {
  modelRef: string;
  displayName?: string;
  providerId?: string;
  modelId?: string;
  status?: string;
  roles?: string[];
};
type IdentityFile = { path: string; content: string; label?: string };
type AgencyAgent = {
  id: string;
  displayName: string;
  agentClass?: string;
  agentType?: string;
  harnessAgentRef?: string;
  profileRefs?: string[];
};
type AgencyProfile = {
  id: string;
  profileId?: string;
  frameworkId: string;
  displayName?: string;
  description?: string;
  lifecycleStatus?: string;
  runtimeStatus?: string;
  primaryModel?: { modelRef?: string; providerId?: string; modelId?: string } | null;
  fallbackModels?: Array<{ modelRef?: string; providerId?: string; modelId?: string }>;
  modelConfig?: Record<string, unknown>;
  identityFiles?: IdentityFile[];
  identityFilesStatus?: string;
  runtime?: unknown;
  health?: unknown;
  usage?: unknown;
  protection?: { protected?: boolean; policy?: string };
};
type InventoryResponse = {
  frameworks: { frameworks?: Framework[] };
  profiles: { profiles?: AgencyProfile[]; status?: string; generatedAt?: string };
  agents: { agents?: AgencyAgent[] };
};
type ContextResponse = {
  capabilities: {
    capabilities?: {
      capabilityStatus?: Record<string, boolean>;
      contractSatisfied?: boolean;
      sourceStatus?: string;
    };
  };
  models: { models?: ModelOption[]; inventorySource?: string; modelInventoryStatus?: string };
  detail?: {
    profile?: AgencyProfile;
    profileProtection?: { protected?: boolean; policy?: string };
  };
};
type ProfilePage = 'overview' | 'create' | 'detail';
type Notice = { color: 'red' | 'teal' | 'yellow'; message: string };

export function ProfilesView({
  canManage,
  canManageModels,
  canDelete,
}: {
  canManage: boolean;
  canManageModels: boolean;
  canDelete: boolean;
}) {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<ProfilePage>(() => route().page);
  const [frameworkId, setFrameworkId] = useState(() => route().frameworkId);
  const [profileId, setProfileId] = useState(() => route().profileId);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setInventory(await api<InventoryResponse>('/profiles/agency-context'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agency profile inventory unavailable');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const navigate = (next: ProfilePage, framework = '', profile = '') => {
    setPage(next);
    setFrameworkId(framework);
    setProfileId(profile);
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'profiles');
    params.set('profilePage', next);
    if (framework) params.set('framework', framework);
    else params.delete('framework');
    if (profile) params.set('agent', profile);
    else params.delete('agent');
    window.history.replaceState(null, '', `?${params.toString()}`);
  };

  const frameworks = inventory?.frameworks.frameworks ?? [];
  const profiles = inventory?.profiles.profiles ?? [];
  const agents = inventory?.agents.agents ?? [];
  if (loading && !inventory)
    return (
      <Stack align="center" py="xl">
        <Loader />
        <Text>Loading migration-only Agency comparison…</Text>
      </Stack>
    );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Box>
          <Text size="xs" fw={800} tt="uppercase">
            Migration comparison · read-only
          </Text>
          <Title>Profiles</Title>
          <Text c="dimmed">
            Legacy Agency snapshot for migration parity only. Hermes control is not connected yet.
          </Text>
        </Box>
        <Group>
          {page !== 'overview' && (
            <Button
              variant="subtle"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => navigate('overview')}
            >
              Back to Agents
            </Button>
          )}
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        </Group>
      </Group>
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      {page === 'overview' && (
        <ProfilesOverview
          profiles={profiles}
          agents={agents}
          status={inventory?.profiles.status}
          observed={inventory?.profiles.generatedAt}
          canManage={canManage}
          onCreate={() => navigate('create')}
          onOpen={(profile) => navigate('detail', profile.frameworkId, idOf(profile))}
        />
      )}
      {page === 'create' && (
        <CreateAgent
          frameworks={frameworks}
          canManage={canManage}
          onCreated={(framework, profile) => {
            void load();
            navigate('detail', framework, profile);
          }}
        />
      )}
      {page === 'detail' && (
        <AgentDetail
          frameworkId={frameworkId}
          profileId={profileId}
          summary={profiles.find(
            (item) => item.frameworkId === frameworkId && idOf(item) === profileId,
          )}
          canManage={canManage}
          canManageModels={canManageModels}
          canDelete={canDelete}
          onChanged={load}
          onDeleted={() => {
            void load();
            navigate('overview');
          }}
        />
      )}
    </Stack>
  );
}

function ProfilesOverview({
  profiles,
  agents,
  status,
  observed,
  canManage,
  onCreate,
  onOpen,
}: {
  profiles: AgencyProfile[];
  agents: AgencyAgent[];
  status?: string | undefined;
  observed?: string | undefined;
  canManage: boolean;
  onCreate: () => void;
  onOpen: (profile: AgencyProfile) => void;
}) {
  return (
    <Stack>
      <Group justify="space-between">
        <Box>
          <Title order={2}>Agents overview</Title>
          <Text c="dimmed">Profiles and Agents are the same operational resource in UNIFY.</Text>
        </Box>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={onCreate}>
            Create new Agent
          </Button>
        )}
      </Group>
      <Group>
        <Badge color={status === 'current' ? 'teal' : status === 'empty' ? 'yellow' : 'red'}>
          {status ?? 'unknown'} inventory
        </Badge>
        <Text size="sm" c="dimmed">
          Observed {formatDate(observed)}
        </Text>
        <Text size="sm" c="dimmed">
          {profiles.length} agents
        </Text>
      </Group>
      {!profiles.length ? (
        <Empty text="No Agency profiles returned." />
      ) : (
        <Paper withBorder>
          <ScrollArea>
            <Table verticalSpacing="md" miw={720} aria-label="Agency agents">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Agent</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Truth</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {profiles.map((profile) => {
                  const type = agentType(profile, agents);
                  const truth = agentTruth(profile);
                  return (
                    <Table.Tr key={`${profile.frameworkId}:${idOf(profile)}`}>
                      <Table.Td>
                        <Button variant="subtle" px={0} onClick={() => onOpen(profile)}>
                          {nameOf(profile)}
                        </Button>
                        <Text size="xs" c="dimmed">
                          {idOf(profile)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={type === 'base' ? 'violet' : type === 'sub' ? 'cyan' : 'blue'}
                        >
                          {type}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text>{modelOf(profile)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={truth === 'active' ? 'teal' : 'gray'}>{truth}</Badge>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}

function CreateAgent({
  frameworks,
  canManage,
  onCreated,
}: {
  frameworks: Framework[];
  canManage: boolean;
  onCreated: (framework: string, profile: string) => void;
}) {
  const defaultFramework = frameworks.find((item) => item.default)?.id ?? frameworks[0]?.id ?? '';
  const [frameworkId, setFrameworkId] = useState(defaultFramework);
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    profileId: '',
    description: '',
    primary: '',
    fallbacks: [] as string[],
    startAfterCreate: false,
  });
  const [files, setFiles] = useState<IdentityFile[]>([
    {
      path: 'AGENTS.md',
      content:
        '# New Hermes Profile\n\nDescribe this agent purpose, operating rules, tools, and handoff expectations.',
    },
    {
      path: 'SOUL.md',
      content: '# Identity\n\nDescribe tone, role, boundaries, and durable behavior.',
    },
  ]);
  const [validated, setValidated] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!frameworkId && defaultFramework) setFrameworkId(defaultFramework);
  }, [defaultFramework, frameworkId]);
  useEffect(() => {
    if (!frameworkId) return;
    setContext(null);
    setNotice(null);
    void api<ContextResponse>(`/profiles/agency-context/${encodeURIComponent(frameworkId)}`)
      .then(setContext)
      .catch((cause) =>
        setNotice({
          color: 'red',
          message: cause instanceof Error ? cause.message : 'Agency create context unavailable',
        }),
      );
  }, [frameworkId]);
  const models = context?.models.models ?? [];
  useEffect(() => {
    if (models.length === 1 && !form.primary) {
      setForm((current) => ({ ...current, primary: models[0]!.modelRef }));
    }
  }, [models, form.primary]);
  const payload = {
    displayName: form.displayName.trim(),
    description: form.description.trim() || undefined,
    identityFiles: files.filter((file) => file.path.trim() && file.content.trim()),
    modelConfig: { primary: form.primary, fallbacks: form.fallbacks },
    startAfterCreate: form.startAfterCreate,
  };
  const signature = JSON.stringify(payload);
  const ready = Boolean(
    frameworkId &&
    form.profileId &&
    form.displayName.trim().length >= 2 &&
    form.primary &&
    payload.identityFiles.length,
  );
  const mutate = async (mode: 'dry-run' | 'execute') => {
    setBusy(true);
    setNotice(null);
    try {
      await gateway.mutate({
        operationType: 'profile.create',
        target: { owner: 'hermes', kind: 'profile', nativeId: form.profileId, frameworkId },
        payload,
        mode,
        confirmed: mode === 'execute',
      });
      if (mode === 'dry-run') {
        setValidated(signature);
        setConfirmed(false);
        setNotice({ color: 'teal', message: 'Exact create payload passed Agency dry-run.' });
      } else {
        setNotice({ color: 'teal', message: 'Agent created.' });
        onCreated(frameworkId, form.profileId);
      }
    } catch (cause) {
      if (mode === 'dry-run') setValidated('');
      setNotice({
        color: 'red',
        message: cause instanceof Error ? cause.message : 'Agent creation failed',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack>
      <Box>
        <Title order={2}>Create new Agent</Title>
        <Text c="dimmed">
          Agency-equivalent Hermes profile creation with model inventory, identity files and
          exact-payload dry-run.
        </Text>
      </Box>
      {notice && <Alert color={notice.color}>{notice.message}</Alert>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Title order={3}>Target framework</Title>
          <Select
            mt="md"
            label="Framework"
            required
            value={frameworkId}
            onChange={(value) => setFrameworkId(value ?? '')}
            data={frameworks.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Text size="xs" c="dimmed" mt="sm">
            Capability contract: {context?.capabilities.capabilities?.sourceStatus ?? 'loading'}
          </Text>
        </Card>
        <Card withBorder>
          <Title order={3}>Agent basics</Title>
          <Stack mt="md">
            <TextInput
              label="Display name"
              required
              value={form.displayName}
              onChange={(event) => {
                const displayName = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  displayName,
                  profileId: current.profileId || slug(displayName),
                }));
                setValidated('');
              }}
            />
            <TextInput
              label="Profile ID"
              required
              value={form.profileId}
              onChange={(event) => {
                setForm((current) => ({ ...current, profileId: slug(event.currentTarget.value) }));
                setValidated('');
              }}
            />
            <Textarea
              label="Description"
              minRows={3}
              value={form.description}
              onChange={(event) => {
                setForm((current) => ({ ...current, description: event.currentTarget.value }));
                setValidated('');
              }}
            />
          </Stack>
        </Card>
      </SimpleGrid>
      <Card withBorder>
        <Title order={3}>Model config</Title>
        <Text size="sm" c="dimmed">
          Agency selectable inventory: {context?.models.modelInventoryStatus ?? 'loading'} ·{' '}
          {models.length} models.
        </Text>
        <ModelFields
          models={models}
          primary={form.primary}
          fallbacks={form.fallbacks}
          onPrimary={(primary) => {
            setForm((current) => ({
              ...current,
              primary,
              fallbacks: current.fallbacks.filter((item) => item !== primary),
            }));
            setValidated('');
          }}
          onFallbacks={(fallbacks) => {
            setForm((current) => ({ ...current, fallbacks }));
            setValidated('');
          }}
        />
      </Card>
      <IdentityEditor
        files={files}
        onChange={(next) => {
          setFiles(next);
          setValidated('');
        }}
      />
      <Card withBorder>
        <Stack>
          <Checkbox
            label="Start runtime after create"
            checked={form.startAfterCreate}
            onChange={(event) => {
              setForm((current) => ({ ...current, startAfterCreate: event.currentTarget.checked }));
              setValidated('');
            }}
          />
          <Group>
            <Button
              variant="light"
              disabled={!canManage || !ready}
              loading={busy}
              onClick={() => void mutate('dry-run')}
            >
              Run create dry-run
            </Button>
            <Badge color={validated === signature ? 'teal' : 'yellow'}>
              {validated === signature ? 'Exact payload validated' : 'Dry-run required'}
            </Badge>
          </Group>
          <Checkbox
            label={`I confirm this creates ${form.profileId || 'the selected agent'} in Hermes`}
            disabled={validated !== signature}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
          />
          <Button
            disabled={!canManage || validated !== signature || !confirmed}
            loading={busy}
            onClick={() => void mutate('execute')}
          >
            Create Agent
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}

function AgentDetail({
  frameworkId,
  profileId,
  summary,
  canManage,
  canManageModels,
  canDelete,
  onChanged,
  onDeleted,
}: {
  frameworkId: string;
  profileId: string;
  summary?: AgencyProfile | undefined;
  canManage: boolean;
  canManageModels: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<IdentityFile[]>([]);
  const [primary, setPrimary] = useState('');
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [identityValidated, setIdentityValidated] = useState('');
  const [modelValidated, setModelValidated] = useState('');
  const [runtimeValidated, setRuntimeValidated] = useState('');
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [modelConfirmed, setModelConfirmed] = useState(false);
  const [runtimeConfirmed, setRuntimeConfirmed] = useState(false);
  const [runtimeAction, setRuntimeAction] = useState('restart');
  const [runtimeReason, setRuntimeReason] = useState('');
  const load = useCallback(async () => {
    if (!frameworkId || !profileId) return;
    setLoading(true);
    setNotice(null);
    try {
      const next = await api<ContextResponse>(
        `/profiles/agency-context/${encodeURIComponent(frameworkId)}/${encodeURIComponent(profileId)}`,
      );
      setContext(next);
      const profile = next.detail?.profile;
      setIdentity(
        (profile?.identityFiles ?? []).map((file) => ({ ...file, content: file.content ?? '' })),
      );
      setPrimary(modelOf(profile));
      setFallbacks((profile?.fallbackModels ?? []).map(modelRef).filter(Boolean));
    } catch (cause) {
      setNotice({
        color: 'red',
        message: cause instanceof Error ? cause.message : 'Agent detail unavailable',
      });
    } finally {
      setLoading(false);
    }
  }, [frameworkId, profileId]);
  useEffect(() => {
    void load();
  }, [load]);
  const profile = context?.detail?.profile ?? summary;
  const capabilities = context?.capabilities.capabilities?.capabilityStatus ?? {};
  const models = context?.models.models ?? [];
  const identityPayload = {
    identityFiles: identity.filter((file) => file.path.trim() && file.content.trim()),
  };
  const modelPayload = { modelConfig: { primary, fallbacks } };
  const runtimePayload = { reason: runtimeReason.trim() || undefined };
  const identitySig = JSON.stringify(identityPayload);
  const modelSig = JSON.stringify(modelPayload);
  const runtimeSig = JSON.stringify({ runtimeAction, ...runtimePayload });
  const run = async (
    operationType: string,
    payload: Record<string, unknown>,
    mode: 'dry-run' | 'execute',
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      await gateway.mutate({
        operationType,
        target: { owner: 'hermes', kind: 'profile', nativeId: profileId, frameworkId },
        payload,
        mode,
        confirmed: mode === 'execute',
      });
      setNotice({
        color: 'teal',
        message:
          mode === 'dry-run'
            ? 'Exact payload passed Agency dry-run.'
            : 'Agent updated successfully.',
      });
      if (mode === 'execute') {
        await load();
        await onChanged();
      }
      return true;
    } catch (cause) {
      setNotice({
        color: 'red',
        message: cause instanceof Error ? cause.message : 'Agent operation failed',
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!frameworkId || !profileId) return <Empty text="Select an Agent from the overview." />;
  if (loading && !profile)
    return (
      <Stack align="center" py="xl">
        <Loader />
        <Text>Loading live Agent detail from Agency…</Text>
      </Stack>
    );
  return (
    <Stack>
      <Group justify="space-between">
        <Box>
          <Group>
            <IconRobot size={30} />
            <Title order={2}>{nameOf(profile)}</Title>
          </Group>
          <Text c="dimmed">
            {frameworkId} · {profileId}
          </Text>
        </Box>
        <Badge size="lg" color={agentTruth(profile) === 'active' ? 'teal' : 'gray'}>
          {agentTruth(profile)}
        </Badge>
      </Group>
      {notice && <Alert color={notice.color}>{notice.message}</Alert>}
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Summary label="Current model" value={modelOf(profile)} />
        <Summary label="Runtime" value={profile?.runtimeStatus ?? 'unknown'} />
        <Summary label="Lifecycle" value={profile?.lifecycleStatus ?? 'unknown'} />
      </SimpleGrid>
      <Card withBorder>
        <Title order={3}>Agent details</Title>
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
          <TextInput label="Agent name" value={nameOf(profile)} readOnly />
          <TextInput label="Profile ID" value={profileId} readOnly />
          <Textarea
            className="work-form-wide"
            label="Description"
            value={profile?.description ?? ''}
            readOnly
            minRows={2}
          />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">
          Agency’s current Hermes contract edits identity and model routing separately; profile
          identity keys are immutable after creation.
        </Text>
      </Card>
      <IdentityEditor
        files={identity}
        disabled={
          !canManage ||
          capabilities.edit_identity === false ||
          profile?.identityFilesStatus === 'not_returned'
        }
        onChange={(next) => {
          setIdentity(next);
          setIdentityValidated('');
        }}
      />
      <Workflow
        title="Identity update"
        validated={identityValidated === identitySig}
        confirmed={identityConfirmed}
        setConfirmed={setIdentityConfirmed}
        busy={busy}
        canApply={canManage && identityPayload.identityFiles.length > 0}
        onDryRun={async () => {
          if (await run('profile.identity.update', identityPayload, 'dry-run'))
            setIdentityValidated(identitySig);
        }}
        onApply={() => void run('profile.identity.update', identityPayload, 'execute')}
      />
      <Card withBorder>
        <Title order={3}>Edit model config</Title>
        <Text size="sm" c="dimmed">
          {models.length} Agency-selectable models returned.
        </Text>
        <ModelFields
          models={models}
          primary={primary}
          fallbacks={fallbacks}
          disabled={!canManageModels || capabilities.edit_models === false}
          onPrimary={(next) => {
            setPrimary(next);
            setFallbacks((current) => current.filter((item) => item !== next));
            setModelValidated('');
          }}
          onFallbacks={(next) => {
            setFallbacks(next);
            setModelValidated('');
          }}
        />
      </Card>
      <Workflow
        title="Model configuration"
        validated={modelValidated === modelSig}
        confirmed={modelConfirmed}
        setConfirmed={setModelConfirmed}
        busy={busy}
        canApply={canManageModels && Boolean(primary)}
        onDryRun={async () => {
          if (await run('profile.model.update', modelPayload, 'dry-run'))
            setModelValidated(modelSig);
        }}
        onApply={() => void run('profile.model.update', modelPayload, 'execute')}
      />
      <Card withBorder>
        <Title order={3}>Runtime controls</Title>
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
          <Select
            label="Action"
            value={runtimeAction}
            onChange={(value) => {
              setRuntimeAction(value ?? 'restart');
              setRuntimeValidated('');
            }}
            data={[
              { value: 'start', label: 'Start' },
              { value: 'stop', label: 'Stop' },
              { value: 'restart', label: 'Restart' },
            ]}
          />
          <TextInput
            label="Operator reason"
            value={runtimeReason}
            onChange={(event) => {
              setRuntimeReason(event.currentTarget.value);
              setRuntimeValidated('');
            }}
          />
        </SimpleGrid>
        <Box mt="md">
          <Workflow
            title={`Runtime ${runtimeAction}`}
            validated={runtimeValidated === runtimeSig}
            confirmed={runtimeConfirmed}
            setConfirmed={setRuntimeConfirmed}
            busy={busy}
            canApply={canManage && capabilities.runtime_control !== false}
            onDryRun={async () => {
              if (await run(`profile.runtime.${runtimeAction}`, runtimePayload, 'dry-run'))
                setRuntimeValidated(runtimeSig);
            }}
            onApply={() => void run(`profile.runtime.${runtimeAction}`, runtimePayload, 'execute')}
          />
        </Box>
      </Card>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <JsonCard
          title="Runtime and health"
          value={{ runtime: profile?.runtime, health: profile?.health }}
        />
        <JsonCard title="Usage" value={profile?.usage} />
      </SimpleGrid>
      {canDelete && (
        <Card withBorder style={{ borderColor: 'var(--mantine-color-red-5)' }}>
          <Group justify="space-between">
            <Box>
              <Title order={3}>Danger zone</Title>
              <Text c="dimmed">
                Protected profiles cannot be deleted. Delete uses Agency’s guarded Hermes endpoint.
              </Text>
            </Box>
            <Button
              color="red"
              variant="light"
              leftSection={<IconTrash size={16} />}
              disabled={Boolean(
                context?.detail?.profileProtection?.protected || profile?.protection?.protected,
              )}
              onClick={async () => {
                const ok = await run('profile.delete', {}, 'dry-run');
                if (!ok || !window.confirm(`Delete ${profileId}? This cannot be undone.`)) return;
                const applied = await run('profile.delete', {}, 'execute');
                if (applied) onDeleted();
              }}
            >
              Delete Agent
            </Button>
          </Group>
        </Card>
      )}
    </Stack>
  );
}

function IdentityEditor({
  files,
  onChange,
  disabled = false,
}: {
  files: IdentityFile[];
  onChange: (files: IdentityFile[]) => void;
  disabled?: boolean;
}) {
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Box>
          <Title order={3}>Identity files</Title>
          <Text size="sm" c="dimmed">
            Agency/Hermes identity readback and editing.
          </Text>
        </Box>
        <Button
          variant="light"
          size="xs"
          disabled={disabled}
          onClick={() => onChange([...files, { path: 'NOTES.md', content: '' }])}
        >
          Add identity file
        </Button>
      </Group>
      <Stack mt="md">
        {files.length ? (
          files.map((file, index) => (
            <Paper withBorder p="sm" key={`${file.path}:${index}`}>
              <Group align="flex-end">
                <TextInput
                  style={{ flex: 1 }}
                  label="Path"
                  value={file.path}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      files.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, path: event.currentTarget.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  color="red"
                  variant="subtle"
                  disabled={disabled || files.length <= 1}
                  onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </Button>
              </Group>
              <Textarea
                mt="sm"
                label={`Identity content ${index + 1}`}
                minRows={8}
                value={file.content ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    files.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, content: event.currentTarget.value } : item,
                    ),
                  )
                }
              />
            </Paper>
          ))
        ) : (
          <Alert color="yellow">
            Agency did not return identity file contents. Editing is blocked to avoid blind
            overwrite.
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

function ModelFields({
  models,
  primary,
  fallbacks,
  onPrimary,
  onFallbacks,
  disabled = false,
}: {
  models: ModelOption[];
  primary: string;
  fallbacks: string[];
  onPrimary: (value: string) => void;
  onFallbacks: (value: string[]) => void;
  disabled?: boolean;
}) {
  const data = useMemo(
    () =>
      models.map((model) => ({
        value: model.modelRef,
        label: `${model.displayName ?? model.modelRef} · ${model.modelRef}`,
      })),
    [models],
  );
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
      <Select
        searchable
        clearable={false}
        label="Primary model"
        required
        data={data}
        value={primary || null}
        disabled={disabled}
        onChange={(value) => onPrimary(value ?? '')}
      />
      <MultiSelect
        searchable
        label="Fallback models"
        data={data.filter((item) => item.value !== primary)}
        value={fallbacks}
        disabled={disabled}
        onChange={onFallbacks}
      />
    </SimpleGrid>
  );
}

function Workflow({
  title,
  validated,
  confirmed,
  setConfirmed,
  busy,
  canApply,
  onDryRun,
  onApply,
}: {
  title: string;
  validated: boolean;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  busy: boolean;
  canApply: boolean;
  onDryRun: () => void | Promise<void>;
  onApply: () => void;
}) {
  return (
    <Paper withBorder p="md">
      <Stack>
        <Group>
          <Text fw={700}>{title}</Text>
          <Badge color={validated ? 'teal' : 'yellow'}>
            {validated ? 'Exact payload validated' : 'Dry-run required'}
          </Badge>
        </Group>
        <Button variant="light" loading={busy} disabled={!canApply} onClick={() => void onDryRun()}>
          Run dry-run
        </Button>
        <Checkbox
          label={`I confirm this ${title.toLowerCase()} change`}
          checked={confirmed}
          disabled={!validated}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        <Button loading={busy} disabled={!canApply || !validated || !confirmed} onClick={onApply}>
          Apply {title}
        </Button>
      </Stack>
    </Paper>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder>
      <Text size="xs" fw={800} tt="uppercase" c="dimmed">
        {label}
      </Text>
      <Text fw={700} mt="xs">
        {value}
      </Text>
    </Card>
  );
}
function JsonCard({ title, value }: { title: string; value: unknown }) {
  return (
    <Card withBorder>
      <Title order={3}>{title}</Title>
      <Code block mt="md">
        {JSON.stringify(value ?? { status: 'not_returned' }, null, 2)}
      </Code>
    </Card>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <Paper withBorder p="xl">
      <Stack align="center">
        <IconActivity size={30} />
        <Text fw={700}>{text}</Text>
      </Stack>
    </Paper>
  );
}
function idOf(profile?: AgencyProfile): string {
  return profile?.profileId ?? profile?.id ?? '';
}
function nameOf(profile?: AgencyProfile): string {
  return profile?.displayName ?? (idOf(profile) || 'Unknown Agent');
}
function modelRef(value: { modelRef?: string; providerId?: string; modelId?: string }): string {
  return value.modelRef ?? [value.providerId, value.modelId].filter(Boolean).join('/');
}
function modelOf(profile?: AgencyProfile): string {
  return profile?.primaryModel ? modelRef(profile.primaryModel) || 'Unconfigured' : 'Unconfigured';
}
function agentTruth(profile?: AgencyProfile): 'active' | 'inactive' {
  return ['active', 'running', 'online'].includes((profile?.runtimeStatus ?? '').toLowerCase())
    ? 'active'
    : 'inactive';
}
function agentType(profile: AgencyProfile, agents: AgencyAgent[]): 'base' | 'sub' | 'independent' {
  const id = idOf(profile).toLowerCase();
  const display = nameOf(profile).toLowerCase();
  const match = agents.find((agent) => {
    const refs = agent.profileRefs ?? [];
    return (
      agent.displayName.toLowerCase() === display ||
      agent.harnessAgentRef?.toLowerCase() === id ||
      agent.harnessAgentRef?.toLowerCase() === `profile:${id}` ||
      refs.some(
        (ref) => ref.toLowerCase().endsWith(`:${id}`) || ref.toLowerCase().endsWith(`/${id}`),
      )
    );
  });
  const type = (match?.agentType ?? match?.agentClass ?? '').toLowerCase();
  if (type === 'base') return 'base';
  if (type === 'sub' || type === 'sub_agent' || type === 'sub-agent') return 'sub';
  return 'independent';
}
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
function formatDate(value?: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function route(): { page: ProfilePage; frameworkId: string; profileId: string } {
  const query = new URLSearchParams(window.location.search);
  const raw = query.get('profilePage');
  return {
    page: raw === 'create' || raw === 'detail' ? raw : 'overview',
    frameworkId: query.get('framework') ?? '',
    profileId: query.get('agent') ?? '',
  };
}
