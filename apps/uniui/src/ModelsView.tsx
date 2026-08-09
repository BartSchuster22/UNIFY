import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  PasswordInput,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconRefresh, IconSparkles } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, gateway } from './api';
import { useFrameworkContext } from './FrameworkContext';
type Provider = {
  id: string;
  displayName: string;
  credentialStatus: 'configured' | 'missing' | 'unknown';
  selected: boolean;
  authType?: 'api_key' | 'oauth' | 'none' | 'unknown';
  credentialMutable?: boolean;
  modelCount?: number;
  owner: 'hermes';
  frameworkId: string;
  sourceVersion: string;
  observedAt: string;
};
type Model = {
  id: string;
  providerId: string;
  displayName: string;
  capabilities: string[];
  selected: boolean;
  costTier?: 'free' | 'standard' | 'premium' | 'unknown';
  owner: 'hermes';
  frameworkId: string;
  sourceVersion: string;
  observedAt: string;
};
type Collection<T> = {
  meta: {
    owner: 'hermes';
    frameworkId: string;
    frameworkVersion: string;
    frameworkCommit: string;
    sourceVersion: string;
    observedAt: string;
    freshness: 'current';
  };
  items: T[];
  page: { hasMore: boolean; nextCursor?: string };
};
type Capabilities = {
  meta: Collection<Provider>['meta'];
  data: {
    capabilities: Record<
      string,
      { status: 'supported' | 'unsupported' | 'unavailable' | 'forbidden'; reasonCode?: string }
    >;
  };
};

type Props = { canManageCredentials: boolean; canManageModels: boolean };

export function ModelsView({ canManageCredentials, canManageModels }: Props) {
  const {
    frameworks,
    frameworkId,
    loading: frameworksLoading,
    error: frameworkError,
    selectionIssue,
    selectFramework,
  } = useFrameworkContext();
  const [providers, setProviders] = useState<Collection<Provider> | null>(null);
  const [models, setModels] = useState<Collection<Model> | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (!frameworkId) {
        setProviders(null);
        setModels(null);
        setCapabilities(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const query = `limit=500${refresh ? '&refresh=true' : ''}`;
        const [providerInventory, modelInventory, manifest] = await Promise.all([
          api<Collection<Provider>>(
            `/frameworks/${encodeURIComponent(frameworkId)}/providers?${query}`,
          ),
          api<Collection<Model>>(`/frameworks/${encodeURIComponent(frameworkId)}/models?${query}`),
          api<Capabilities>(`/frameworks/${encodeURIComponent(frameworkId)}/capabilities`),
        ]);
        setProviders(providerInventory);
        setModels(modelInventory);
        setCapabilities(manifest);
      } catch (cause) {
        setProviders(null);
        setModels(null);
        setCapabilities(null);
        setError(cause instanceof Error ? cause.message : 'Hermes model inventory unavailable');
      } finally {
        setLoading(false);
      }
    },
    [frameworkId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (
    operationType: string,
    kind: 'model' | 'provider',
    nativeId: string,
    payload: Record<string, unknown>,
    confirmed = false,
  ) => {
    setBusy(`${operationType}:${nativeId}`);
    setError('');
    setNotice('');
    try {
      await gateway.mutate({
        operationType,
        target: { owner: 'hermes', kind, nativeId, frameworkId },
        payload,
        mode: 'execute',
        confirmed,
      });
      setCredentials((current) => ({ ...current, [nativeId]: '' }));
      setNotice(
        operationType === 'model.select'
          ? 'Model selection saved in Hermes. Existing sessions keep their current model; new sessions use the new selection.'
          : 'Provider credential state updated in Hermes.',
      );
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hermes model-management operation failed');
    } finally {
      setBusy('');
    }
  };

  const credentialCapability = capabilities?.data.capabilities['providers.credentials.execute'];
  const modelCapability = capabilities?.data.capabilities['models.execute'];
  const credentialEnabled = canManageCredentials && credentialCapability?.status === 'supported';
  const modelEnabled = canManageModels && modelCapability?.status === 'supported';
  const configured =
    providers?.items.filter((item) => item.credentialStatus === 'configured').length ?? 0;
  const selectedProvider = providers?.items.find((item) => item.selected);
  const selectedModel = models?.items.find((item) => item.selected);
  const frameworkOptions = useMemo(
    () => frameworks.map((item) => ({ value: item.frameworkId, label: item.displayName })),
    [frameworks],
  );
  const modelsByProvider = useMemo(() => {
    const result = new Map<string, Model[]>();
    for (const model of models?.items ?? []) {
      const current = result.get(model.providerId) ?? [];
      current.push(model);
      result.set(model.providerId, current);
    }
    return result;
  }, [models]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} tt="uppercase">
            Hermes source of truth
          </Text>
          <Title order={1}>Models & Providers</Title>
          <Text c="dimmed">
            Catalogue, selection, and credential status come directly from the selected Hermes
            framework.
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={() => void load(true)}
          loading={loading}
        >
          Refresh from Hermes
        </Button>
      </Group>
      <Select
        label="Hermes framework"
        value={frameworkId || null}
        data={frameworkOptions}
        onChange={(value) => selectFramework(value ?? '')}
        placeholder="No verified Hermes framework"
        disabled={frameworksLoading}
      />
      {frameworkError || selectionIssue || error ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {frameworkError || selectionIssue || error}
        </Alert>
      ) : null}
      {notice ? <Alert color="teal">{notice}</Alert> : null}
      {!frameworksLoading && !frameworks.length ? (
        <Alert color="yellow">No enabled, verified Hermes framework is registered.</Alert>
      ) : null}
      {credentialCapability?.status !== 'supported' ? (
        <CapabilityAlert label="Provider credential changes" capability={credentialCapability} />
      ) : !canManageCredentials ? (
        <Alert color="blue">Provider credentials are read-only for your role.</Alert>
      ) : null}
      {modelCapability?.status !== 'supported' ? (
        <CapabilityAlert label="Model selection" capability={modelCapability} />
      ) : !canManageModels ? (
        <Alert color="blue">Model selection is read-only for your role.</Alert>
      ) : null}
      {loading && !providers ? (
        <Group>
          <Loader size="sm" />
          <Text>Loading Hermes catalogue…</Text>
        </Group>
      ) : null}
      {providers && models ? (
        <>
          <Group>
            <Badge color="teal">Hermes · current</Badge>
            <Text size="sm" c="dimmed">
              Framework {providers.meta.frameworkId}
            </Text>
            <Text size="sm" c="dimmed">
              Observed {formatDate(providers.meta.observedAt)}
            </Text>
          </Group>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Summary label="Providers" value={providers.items.length} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Summary label="Models" value={models.items.length} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Summary label="Credentials configured" value={configured} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <Summary
                label="Selected"
                value={selectedModel?.displayName ?? selectedProvider?.displayName ?? 'Unknown'}
              />
            </Grid.Col>
          </Grid>
          <Grid>
            {providers.items.map((provider) => {
              const providerModels = modelsByProvider.get(provider.id) ?? [];
              const credentialKey = `provider.credential.set:${provider.id}`;
              return (
                <Grid.Col key={`${provider.frameworkId}:${provider.id}`} span={{ base: 12, lg: 6 }}>
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
                          <Badge leftSection={<IconSparkles size={12} />}>Selected provider</Badge>
                        ) : null}
                      </Group>
                      <Group>
                        <Badge color={credentialColor(provider.credentialStatus)}>
                          Auth: {provider.credentialStatus}
                        </Badge>
                        <Badge variant="light">{provider.authType ?? 'unknown auth'}</Badge>
                        <Badge variant="light">{providerModels.length} models</Badge>
                      </Group>
                      {providerModels.length ? (
                        <Stack gap="xs">
                          {providerModels.map((model) => (
                            <Group
                              key={`${provider.id}:${model.id}`}
                              justify="space-between"
                              wrap="nowrap"
                            >
                              <div>
                                <Text size="sm" fw={model.selected ? 700 : 500}>
                                  {model.displayName}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {model.id}
                                  {model.costTier ? ` · ${model.costTier}` : ''}
                                </Text>
                              </div>
                              <Button
                                size="xs"
                                variant={model.selected ? 'filled' : 'light'}
                                disabled={!modelEnabled || model.selected}
                                loading={busy === `model.select:${model.id}`}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      'Select this Hermes model for new sessions? Model pricing may differ. Existing sessions are unchanged.',
                                    )
                                  )
                                    return;
                                  void mutate('model.select', 'model', model.id, {
                                    providerId: provider.id,
                                    confirmExpensiveModel: true,
                                  });
                                }}
                              >
                                {model.selected ? 'Selected' : 'Select'}
                              </Button>
                            </Group>
                          ))}
                        </Stack>
                      ) : (
                        <Text size="sm" c="dimmed">
                          Hermes reports no models for this provider.
                        </Text>
                      )}
                      {provider.authType === 'oauth' ? (
                        <Text size="sm" c="dimmed">
                          OAuth sign-in is managed by Hermes. No token field is exposed here.
                        </Text>
                      ) : (
                        <Group align="flex-end" wrap="nowrap">
                          <PasswordInput
                            label="API credential"
                            placeholder="Stored only by Hermes"
                            value={credentials[provider.id] ?? ''}
                            disabled={!credentialEnabled}
                            onChange={(event) =>
                              setCredentials((current) => ({
                                ...current,
                                [provider.id]: event.currentTarget.value,
                              }))
                            }
                            style={{ flex: 1 }}
                          />
                          <Button
                            disabled={
                              !credentialEnabled || !(credentials[provider.id] ?? '').trim()
                            }
                            loading={busy === credentialKey}
                            onClick={() =>
                              void mutate('provider.credential.set', 'provider', provider.id, {
                                credential: credentials[provider.id],
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button
                            color="red"
                            variant="light"
                            disabled={
                              !credentialEnabled || provider.credentialStatus !== 'configured'
                            }
                            loading={busy === `provider.credential.remove:${provider.id}`}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Remove the ${provider.displayName} credential from Hermes?`,
                                )
                              )
                                return;
                              void mutate(
                                'provider.credential.remove',
                                'provider',
                                provider.id,
                                {},
                                true,
                              );
                            }}
                          >
                            Remove
                          </Button>
                        </Group>
                      )}
                      <Text size="xs" c="dimmed">
                        Credential values, fingerprints, variable names, and secret locations are
                        never returned to UNIUI.
                      </Text>
                    </Stack>
                  </Card>
                </Grid.Col>
              );
            })}
          </Grid>
          {!providers.items.length ? (
            <Alert color="yellow">
              Hermes returned no providers. UNIFY uses no external fallback.
            </Alert>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}

function CapabilityAlert({
  label,
  capability,
}: {
  label: string;
  capability: { status: string; reasonCode?: string } | undefined;
}) {
  return (
    <Alert color="blue">
      {label} {capability ? `are ${capability.status}` : 'are unavailable'}
      {capability?.reasonCode ? ` (${capability.reasonCode})` : ''}.
    </Alert>
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
