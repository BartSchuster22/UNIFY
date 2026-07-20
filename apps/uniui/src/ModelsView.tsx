import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Grid,
  Group,
  Loader,
  Paper,
  PasswordInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconKey, IconRefresh, IconSparkles } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { api, gateway } from './api';

type ProviderStatus = 'available' | 'configured' | 'healthy' | 'degraded' | 'disabled' | 'unavailable';
type CredentialStatus = 'missing' | 'saved' | 'healthy' | 'invalid' | 'unsupported' | 'error';
type ModelStatus = 'available' | 'configured_default' | 'configured_fallback' | 'disabled' | 'deprecated' | 'unavailable';
type Provider = { id: string; label: string; authMethod: string; docsUrl?: string; status: ProviderStatus; credentialStatus: CredentialStatus; credentialFingerprint?: string; modelCount: number; harnesses: string[]; providerKind?: string; upstreamProviderId?: string; role?: string; updatedAt: string };
type Model = { id: string; providerId: string; displayName: string; modality: string; contextWindow?: number; status: ModelStatus; harnesses: string[]; updatedAt: string };
type Requirement = { providerId: string; label: string; authMethod: string; status: ProviderStatus; credentialStatus: CredentialStatus; requiredEnvVars: string[]; configuredEnvVars: string[]; credentialPoolCount: number; harnesses: Array<{ harnessId: string; status: CredentialStatus; discoverySupported: boolean; credentialInstallSupported: boolean; modelCount: number }>; docsUrl?: string; updatedAt: string };
type Credential = { providerId: string; scope: string; status: CredentialStatus; fingerprint: string; harnessId?: string; lastValidatedAt?: string; updatedAt: string };
type ProviderState = { providerId: string; label: string; authMethod: string; dmmProviderStatus: ProviderStatus; dmmCredentialStatus: CredentialStatus; dmmCredentialFingerprint?: string; externalSource: string; providerKind?: string; upstreamProviderId?: string; role?: string; modelCount: number; harnessStates: Requirement['harnesses']; updatedAt: string };
type DmmContext = { providers: unknown; requirements: unknown; credentials: unknown; models: unknown; normalizedState: unknown };
type Inventory = { providers: Provider[]; requirements: Requirement[]; credentials: Credential[]; models: Model[]; providerStates: ProviderState[] };
type Page = 'overview' | 'models' | 'provider';
type Notice = { color: 'red' | 'green' | 'blue' | 'yellow'; message: string };

export function ModelsView({ canManageCredentials }: { canManageCredentials: boolean }) {
  const initial = new URLSearchParams(window.location.search);
  const [page, setPage] = useState<Page>(() => initial.get('modelsPage') === 'models' ? 'models' : initial.get('provider') ? 'provider' : 'overview');
  const [providerId, setProviderId] = useState(initial.get('provider') ?? '');
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true); setNotice(null);
    try { setInventory(normalizeInventory(await api<DmmContext>('/models/dmm-context'))); }
    catch (cause) { setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'DMM inventory unavailable' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const navigate = (next: Page, selected?: string) => {
    setPage(next); setProviderId(selected ?? '');
    const params = new URLSearchParams(window.location.search);
    params.set('modelsPage', next === 'provider' ? 'overview' : next);
    if (selected) params.set('provider', selected); else params.delete('provider');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };
  const provider = inventory ? providerFor(inventory, providerId) : undefined;
  return <Stack gap="md">
    <Group justify="space-between" align="flex-start">
      <div><Text size="xs" fw={800} tt="uppercase">DMM control plane</Text><Title order={1}>Models & Providers</Title><Text c="dimmed">Framework-authoritative provider availability, model inventory and provider-key activation.</Text></div>
      <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void load()} loading={loading}>Refresh</Button>
    </Group>
    <Group gap="xs" className="work-section-navigation">
      <Button variant={page !== 'models' ? 'filled' : 'light'} onClick={() => navigate('overview')}>Overview</Button>
      <Button variant={page === 'models' ? 'filled' : 'light'} onClick={() => navigate('models')}>Models</Button>
    </Group>
    {notice ? <Alert color={notice.color}>{notice.message}</Alert> : null}
    {loading && !inventory ? <Group><Loader size="sm" /><Text>Loading DMM inventory…</Text></Group> : null}
    {inventory && page === 'overview' ? <ProvidersOverview inventory={inventory} onOpen={(id) => navigate('provider', id)} /> : null}
    {inventory && page === 'models' ? <AllModels models={inventory.models} providers={inventory.providers} /> : null}
    {inventory && page === 'provider' && provider ? <ProviderDetail inventory={inventory} provider={provider} canManageCredentials={canManageCredentials} onBack={() => navigate('overview')} onRefresh={load} /> : null}
    {inventory && page === 'provider' && !provider ? <Alert color="yellow">Provider {providerId || 'unknown'} is not present in the current DMM inventory.</Alert> : null}
  </Stack>;
}

function ProvidersOverview({ inventory, onOpen }: { inventory: Inventory; onOpen: (id: string) => void }) {
  const available = inventory.models.filter(isAvailable).length;
  const configured = inventory.models.filter((model) => model.status === 'configured_default' || model.status === 'configured_fallback').length;
  return <Stack gap="md">
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      <Summary label="Providers" value={inventory.providerStates.length} hint="reported by active frameworks" />
      <Summary label="Total models available" value={available} hint={`${inventory.models.length} models reported in total`} />
      <Summary label="Configured models" value={configured} hint="framework default and fallbacks" />
    </SimpleGrid>
    <div><Title order={2}>Providers</Title><Text c="dimmed">All providers available through the active agent-framework inventory.</Text></div>
    <Grid>{inventory.providerStates.map((state) => {
      const credential = inventory.credentials.find((item) => item.providerId === state.providerId);
      return <Grid.Col key={state.providerId} span={{ base: 12, md: 6, xl: 4 }}><Card withBorder h="100%">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start"><Button variant="subtle" px={0} onClick={() => onOpen(state.providerId)} aria-label={`Open ${state.label} provider details`}>{state.label}</Button><Badge color={providerColor(state.dmmProviderStatus)}>{state.dmmProviderStatus}</Badge></Group>
          <Text size="sm" c="dimmed">{state.providerId} · {state.authMethod}{state.providerKind ? ` · ${state.providerKind}` : ''}</Text>
          <Group><Badge variant="light" leftSection={<IconSparkles size={12} />}>{state.modelCount} models</Badge><Badge color={credentialColor(state.dmmCredentialStatus)} variant="light">Auth: {state.dmmCredentialStatus}</Badge></Group>
          <Text size="xs" c="dimmed">Source: {state.externalSource} · Vault: {credential ? `${credential.status} (${credential.fingerprint})` : 'none'}</Text>
        </Stack>
      </Card></Grid.Col>;
    })}</Grid>
    {!inventory.providerStates.length ? <Alert color="yellow">DMM returned no providers. This empty state is authoritative.</Alert> : null}
  </Stack>;
}

function ProviderDetail({ inventory, provider, canManageCredentials, onBack, onRefresh }: { inventory: Inventory; provider: Provider; canManageCredentials: boolean; onBack: () => void; onRefresh: () => Promise<void> }) {
  const models = inventory.models.filter((model) => model.providerId === provider.id);
  const requirement = inventory.requirements.find((item) => item.providerId === provider.id);
  const credential = inventory.credentials.find((item) => item.providerId === provider.id);
  const state = inventory.providerStates.find((item) => item.providerId === provider.id);
  const available = models.filter(isAvailable).length;
  const defaults = models.filter((model) => model.status === 'configured_default').length;
  const [search, setSearch] = useState('');
  const filtered = models.filter((model) => `${model.displayName} ${model.id} ${model.modality} ${model.status}`.toLowerCase().includes(search.toLowerCase()));
  return <Stack gap="md">
    <Group justify="space-between"><div><Button variant="subtle" px={0} leftSection={<IconArrowLeft size={16} />} onClick={onBack}>Providers</Button><Title order={2}>{provider.label}</Title><Text c="dimmed">{provider.id} · {provider.authMethod} · framework bindings: {provider.harnesses.join(', ') || 'none'}</Text></div><Badge color={providerColor(provider.status)}>{provider.status}</Badge></Group>
    <SimpleGrid cols={{ base: 1, sm: 4 }}>
      <Summary label="Provider models" value={models.length} hint="normalized for this provider" />
      <Summary label="Available" value={available} hint="selectable or configured" />
      <Summary label="Framework default" value={defaults} hint="configured primary model" />
      <Summary label="DMM credential" value={state?.dmmCredentialStatus ?? provider.credentialStatus} hint={state?.dmmCredentialFingerprint ?? provider.credentialFingerprint ?? 'no fingerprint'} />
    </SimpleGrid>
    <Paper withBorder p="md"><Stack gap="sm"><div><Title order={3}>Available provider models</Title><Text c="dimmed">Complete DMM model list for {provider.label}.</Text></div><TextInput label="Search provider models" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder={`Search ${provider.label} models`} /><ModelTable models={filtered} showProvider={false} /><Text size="sm" c="dimmed">Showing {filtered.length} of {models.length}</Text></Stack></Paper>
    <CredentialSetup provider={provider} requirement={requirement} credential={credential} state={state} canManage={canManageCredentials} onRefresh={onRefresh} />
  </Stack>;
}

function CredentialSetup({ provider, requirement, credential, state, canManage, onRefresh }: { provider: Provider; requirement: Requirement | undefined; credential: Credential | undefined; state: ProviderState | undefined; canManage: boolean; onRefresh: () => Promise<void> }) {
  const [secret, setSecret] = useState('');
  const [validatedSecret, setValidatedSecret] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const installSupported = requirement?.harnesses.some((item) => item.credentialInstallSupported) ?? state?.harnessStates.some((item) => item.credentialInstallSupported) ?? false;
  const mutate = async (operationType: string, payload: Record<string, unknown>, mode: 'dry-run' | 'execute', destructive = false) => gateway.mutate({ operationType, target: { owner: 'dmm', kind: 'provider', nativeId: provider.id }, payload, mode, confirmed: destructive });
  const dryRun = async () => { setBusy('dry'); setNotice(null); try { await mutate('dmm.credential.save', { secret }, 'dry-run'); setValidatedSecret(secret); setConfirmed(false); setNotice({ color: 'blue', message: 'Exact credential payload validated. Confirm to activate it.' }); } catch (cause) { setValidatedSecret(''); setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'Credential dry-run failed' }); } finally { setBusy(''); } };
  const save = async () => { setBusy('save'); setNotice(null); try { await mutate('dmm.credential.save', { secret }, 'execute'); setSecret(''); setValidatedSecret(''); setConfirmed(false); setNotice({ color: 'green', message: 'Provider key encrypted in DMM and delegated to the active framework.' }); await onRefresh(); } catch (cause) { setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'Credential activation failed' }); } finally { setBusy(''); } };
  const validate = async () => { setBusy('validate'); setNotice(null); try { await mutate('dmm.credential.validate', {}, 'execute'); setNotice({ color: 'green', message: 'DMM validation completed.' }); await onRefresh(); } catch (cause) { setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'Validation failed' }); } finally { setBusy(''); } };
  const remove = async () => { if (!window.confirm(`Delete the DMM vault copy for ${provider.label}?`)) return; setBusy('delete'); setNotice(null); try { await mutate('dmm.credential.delete', {}, 'execute', true); setNotice({ color: 'green', message: 'DMM vault copy deleted.' }); await onRefresh(); } catch (cause) { setNotice({ color: 'red', message: cause instanceof Error ? cause.message : 'Credential deletion failed' }); } finally { setBusy(''); } };
  return <Paper withBorder p="md"><Stack gap="md">
    <Group justify="space-between"><div><Title order={3}>API keys / Auth setup</Title><Text c="dimmed">DMM encrypts submitted keys and installs them into the active agent framework. Secret values are never read back.</Text></div><Badge color={credentialColor(state?.dmmCredentialStatus ?? provider.credentialStatus)}>{state?.dmmCredentialStatus ?? provider.credentialStatus}</Badge></Group>
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}><Fact label="Auth method" value={provider.authMethod} /><Fact label="Vault record" value={credential ? `${credential.status} · ${credential.fingerprint}` : 'none'} /><Fact label="Required env" value={requirement?.requiredEnvVars.join(', ') || 'none declared'} /><Fact label="Credential pool" value={String(requirement?.credentialPoolCount ?? 0)} /></SimpleGrid>
    {requirement?.docsUrl || provider.docsUrl ? <Text size="sm">Provider documentation: <a href={requirement?.docsUrl ?? provider.docsUrl} target="_blank" rel="noreferrer">open documentation</a></Text> : null}
    {provider.authMethod !== 'api_key' ? <Alert color="blue">Authentication is managed by the active agent framework using {provider.authMethod}; no API key can be entered here.</Alert> : null}
    {provider.authMethod === 'api_key' && !installSupported ? <Alert color="yellow">The active framework does not advertise provider-key installation for this provider. Setup is disabled truthfully.</Alert> : null}
    {provider.authMethod === 'api_key' && installSupported ? <>
      <PasswordInput label="API key / token" description="Sent only during dry-run validation and final DMM activation." value={secret} onChange={(event) => { setSecret(event.currentTarget.value); setConfirmed(false); }} disabled={!canManage} />
      {!canManage ? <Alert color="yellow">Your UNIFY role does not include credentials.manage.</Alert> : null}
      <Group><Button variant="light" leftSection={<IconKey size={16} />} disabled={!secret || !canManage} loading={busy === 'dry'} onClick={() => void dryRun()}>Run key dry-run</Button><Badge color={validatedSecret === secret && secret ? 'green' : 'gray'}>{validatedSecret === secret && secret ? 'Exact payload validated' : 'Dry-run required'}</Badge></Group>
      <Checkbox label={`I confirm activation or rotation for ${provider.label}`} checked={confirmed} disabled={!secret || validatedSecret !== secret} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
      <Button onClick={() => void save()} loading={busy === 'save'} disabled={!confirmed || validatedSecret !== secret || !secret}>Activate / rotate provider key</Button>
    </> : null}
    {credential && canManage ? <Group><Button variant="light" onClick={() => void validate()} loading={busy === 'validate'}>Validate provider key</Button><Button color="red" variant="light" onClick={() => void remove()} loading={busy === 'delete'}>Delete DMM vault copy</Button></Group> : null}
    {notice ? <Alert color={notice.color}>{notice.message}</Alert> : null}
  </Stack></Paper>;
}

function AllModels({ models, providers }: { models: Model[]; providers: Provider[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = useMemo(() => models.filter((model) => (status === 'all' || model.status === status) && `${model.displayName} ${model.id} ${model.providerId}`.toLowerCase().includes(search.toLowerCase())), [models, search, status]);
  const available = models.filter(isAvailable).length;
  return <Stack gap="md">
    <SimpleGrid cols={{ base: 1, sm: 3 }}><Summary label="Available models" value={available} hint="selectable or configured" /><Summary label="Total models" value={models.length} hint="reported by active frameworks" /><Summary label="Providers represented" value={new Set(models.map((model) => model.providerId)).size} hint={`${providers.length} providers in inventory`} /></SimpleGrid>
    <Paper withBorder p="md"><Stack gap="sm"><div><Title order={2}>Models</Title><Text c="dimmed">All models reported by DMM’s active agent-framework inventory.</Text></div><Group grow align="end"><TextInput label="Search models / providers" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><Select label="Status" value={status} onChange={(value) => setStatus(value ?? 'all')} data={['all', 'available', 'configured_default', 'configured_fallback', 'disabled', 'deprecated', 'unavailable']} /></Group><ModelTable models={filtered} showProvider /><Text size="sm" c="dimmed">Showing {filtered.length} of {models.length}</Text></Stack></Paper>
  </Stack>;
}

function ModelTable({ models, showProvider }: { models: Model[]; showProvider: boolean }) {
  return <ScrollArea><Table striped highlightOnHover miw={760}><Table.Thead><Table.Tr><Table.Th>Model</Table.Th>{showProvider ? <Table.Th>Provider</Table.Th> : null}<Table.Th>Modality</Table.Th><Table.Th>Context</Table.Th><Table.Th>Frameworks</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{models.map((model) => <Table.Tr key={`${model.providerId}:${model.id}`}><Table.Td><Text fw={700}>{model.displayName}</Text><Code>{model.id}</Code></Table.Td>{showProvider ? <Table.Td>{model.providerId}</Table.Td> : null}<Table.Td>{model.modality}</Table.Td><Table.Td>{model.contextWindow?.toLocaleString() ?? '—'}</Table.Td><Table.Td>{model.harnesses.join(', ') || 'none'}</Table.Td><Table.Td><Badge color={modelColor(model.status)}>{model.status}</Badge></Table.Td></Table.Tr>)}</Table.Tbody></Table>{!models.length ? <Text ta="center" c="dimmed" py="lg">No models match the current filter.</Text> : null}</ScrollArea>;
}

function Summary({ label, value, hint }: { label: string; value: string | number; hint: string }) { return <Card withBorder><Text size="xs" tt="uppercase" fw={800} c="dimmed">{label}</Text><Text fz="2rem" fw={800}>{value}</Text><Text size="sm" c="dimmed">{hint}</Text></Card>; }
function Fact({ label, value }: { label: string; value: string }) { return <Card withBorder padding="sm"><Text size="xs" tt="uppercase" c="dimmed">{label}</Text><Text fw={700}>{value}</Text></Card>; }
function isAvailable(model: Model) { return ['available', 'configured_default', 'configured_fallback'].includes(model.status); }
function providerColor(status: string) { return ['healthy', 'configured', 'available'].includes(status) ? 'green' : status === 'degraded' ? 'yellow' : 'gray'; }
function credentialColor(status: string) { return ['healthy', 'saved'].includes(status) ? 'green' : status === 'missing' || status === 'unsupported' ? 'gray' : 'red'; }
function modelColor(status: ModelStatus) { return status === 'configured_default' ? 'green' : status === 'configured_fallback' ? 'blue' : status === 'available' ? 'cyan' : status === 'unavailable' ? 'red' : 'gray'; }
function unwrap<T>(value: unknown): T { const record = value as { ok?: boolean; data?: T }; return record?.ok === true && record.data !== undefined ? record.data : value as T; }
function normalizeInventory(raw: DmmContext): Inventory {
  const providers = unwrap<{ providers: Provider[] }>(raw.providers).providers ?? [];
  const requirements = unwrap<{ requirements: Requirement[] }>(raw.requirements).requirements ?? [];
  const credentials = unwrap<{ credentials: Credential[] }>(raw.credentials).credentials ?? [];
  const models = unwrap<{ models: Model[] }>(raw.models).models ?? [];
  const normalized = unwrap<{ providers: ProviderState[] }>(raw.normalizedState);
  const providerStates = normalized.providers ?? providers.map((provider) => ({ providerId: provider.id, label: provider.label, authMethod: provider.authMethod, dmmProviderStatus: provider.status, dmmCredentialStatus: provider.credentialStatus, ...(provider.credentialFingerprint ? { dmmCredentialFingerprint: provider.credentialFingerprint } : {}), externalSource: 'provider-view', ...(provider.providerKind ? { providerKind: provider.providerKind } : {}), ...(provider.upstreamProviderId ? { upstreamProviderId: provider.upstreamProviderId } : {}), ...(provider.role ? { role: provider.role } : {}), modelCount: provider.modelCount, harnessStates: requirementFor(requirements, provider.id)?.harnesses ?? [], updatedAt: provider.updatedAt }));
  return { providers, requirements, credentials, models, providerStates };
}
function requirementFor(requirements: Requirement[], id: string) { return requirements.find((item) => item.providerId === id); }
function providerFor(inventory: Inventory, id: string): Provider | undefined {
  const direct = inventory.providers.find((provider) => provider.id === id); if (direct) return direct;
  const state = inventory.providerStates.find((provider) => provider.providerId === id); if (!state) return undefined;
  return { id: state.providerId, label: state.label, authMethod: state.authMethod, status: state.dmmProviderStatus, credentialStatus: state.dmmCredentialStatus, ...(state.dmmCredentialFingerprint ? { credentialFingerprint: state.dmmCredentialFingerprint } : {}), modelCount: state.modelCount, harnesses: state.harnessStates.map((item) => item.harnessId), ...(state.providerKind ? { providerKind: state.providerKind } : {}), ...(state.upstreamProviderId ? { upstreamProviderId: state.upstreamProviderId } : {}), ...(state.role ? { role: state.role } : {}), updatedAt: state.updatedAt };
}
