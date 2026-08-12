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
  Modal,
  PasswordInput,
  Select,
  Stack,
  Stepper,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconRefresh, IconSparkles } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, gateway } from './api';
import type { MutationResponse } from './types';
import { useFrameworkContext } from './FrameworkContext';
type Provider = {
  id: string;
  displayName: string;
  credentialStatus: 'configured' | 'missing' | 'unknown';
  selected: boolean;
  authType?: 'api_key' | 'oauth' | 'none' | 'unknown';
  authMethod?:
    | 'api_key'
    | 'oauth_device_code'
    | 'oauth_browser'
    | 'external_cli'
    | 'cloud_identity'
    | 'endpoint'
    | 'composite'
    | 'none'
    | 'unknown';
  credentialMutable?: boolean;
  setupSupported?: boolean;
  setupFields?: Array<{
    id: string;
    label: string;
    type: 'secret' | 'secret_file' | 'text' | 'url' | 'choice' | 'region' | 'project';
    required: boolean;
    secret: boolean;
  }>;
  prerequisites?: Array<{
    id: string;
    label: string;
    kind: 'account' | 'executable' | 'cloud_identity' | 'network' | 'provider';
    status: 'satisfied' | 'missing' | 'unknown';
  }>;
  connectionState?:
    'connected' | 'disconnected' | 'authorization_pending' | 'expired' | 'not_required' | 'unknown';
  deploymentReadiness?:
    'ready' | 'needs_configuration' | 'needs_model' | 'needs_selection' | 'blocked' | 'unsupported';
  readinessReasonCodes?: string[];
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
type ProviderSetup = {
  providerId: string;
  credential: string;
  acknowledged: boolean;
  revision: number;
  reviewedRevision: number;
  preflight?: MutationResponse | undefined;
  dryRunKey: string;
  executeKey: string;
};
type ModelSetup = {
  providerId: string;
  modelId: string;
  acknowledged: boolean;
  revision: number;
  reviewedRevision: number;
  preflight?: MutationResponse | undefined;
  dryRunKey: string;
  executeKey: string;
};

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
  const [setup, setSetup] = useState<ProviderSetup | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [modelSetup, setModelSetup] = useState<ModelSetup | null>(null);
  const [modelSetupStep, setModelSetupStep] = useState(0);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const selectedFramework = useRef(frameworkId);
  const currentSetup = useRef(setup);
  const currentModelSetup = useRef(modelSetup);
  selectedFramework.current = frameworkId;
  currentSetup.current = setup;
  currentModelSetup.current = modelSetup;

  const load = useCallback(
    async (refresh = false) => {
      const requestGeneration = ++generation.current;
      const requestedFramework = frameworkId;
      if (!requestedFramework) {
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
            `/frameworks/${encodeURIComponent(requestedFramework)}/providers?${query}`,
          ),
          api<Collection<Model>>(
            `/frameworks/${encodeURIComponent(requestedFramework)}/models?${query}`,
          ),
          api<Capabilities>(`/frameworks/${encodeURIComponent(requestedFramework)}/capabilities`),
        ]);
        if (
          requestGeneration !== generation.current ||
          selectedFramework.current !== requestedFramework
        )
          return;
        setProviders(providerInventory);
        setModels(modelInventory);
        setCapabilities(manifest);
      } catch (cause) {
        if (
          requestGeneration !== generation.current ||
          selectedFramework.current !== requestedFramework
        )
          return;
        setProviders(null);
        setModels(null);
        setCapabilities(null);
        setError(cause instanceof Error ? cause.message : 'Hermes model inventory unavailable');
      } finally {
        if (
          requestGeneration === generation.current &&
          selectedFramework.current === requestedFramework
        )
          setLoading(false);
      }
    },
    [frameworkId],
  );

  useEffect(() => {
    setSetup(null);
    setSetupStep(0);
    setModelSetup(null);
    setModelSetupStep(0);
    setBusy('');
    setNotice('');
    setError('');
    void load();
  }, [load]);

  const mutate = async (
    operationType: string,
    kind: 'model' | 'provider',
    nativeId: string,
    payload: Record<string, unknown>,
    confirmed = false,
  ) => {
    const requestedFramework = frameworkId;
    if (!requestedFramework) return;
    setBusy(`${operationType}:${nativeId}`);
    setError('');
    setNotice('');
    try {
      const result = await gateway.mutate({
        operationType,
        target: { owner: 'hermes', kind, nativeId, frameworkId: requestedFramework },
        payload,
        mode: 'execute',
        confirmed,
      });
      if (selectedFramework.current !== requestedFramework) return;
      if (result.operation.state !== 'verified')
        throw new Error(
          `Hermes model-management operation did not verify; state is ${result.operation.state}.`,
        );
      setNotice(
        operationType === 'model.select'
          ? 'Model selection saved in Hermes. Existing sessions keep their current model; new sessions use the new selection.'
          : operationType === 'provider.validate'
            ? 'Hermes validated the connected provider through live model discovery.'
            : operationType === 'provider.models.refresh'
              ? 'Hermes refreshed and authoritatively read back the provider model catalogue.'
              : operationType === 'provider.inference.test'
                ? 'Real Hermes inference smoke test succeeded.'
                : operationType === 'provider.persistence.verify'
                  ? 'Hermes authoritative environment readback confirms credential persistence.'
                  : 'Provider credential state updated in Hermes.',
      );
      await load(true);
    } catch (cause) {
      if (selectedFramework.current !== requestedFramework) return;
      setError(cause instanceof Error ? cause.message : 'Hermes model-management operation failed');
    } finally {
      if (selectedFramework.current === requestedFramework) setBusy('');
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
  const credentialProviders = useMemo(
    () =>
      (providers?.items ?? []).filter(
        (provider) =>
          (provider.authType === 'api_key' || provider.authType === 'unknown') &&
          provider.credentialMutable !== false,
      ),
    [providers],
  );
  const setupProvider = setup
    ? providers?.items.find((provider) => provider.id === setup.providerId)
    : undefined;
  const setupReviewed = Boolean(
    setup?.preflight && setup.reviewedRevision === setup.revision && setup.acknowledged,
  );
  const modelProviders = useMemo(
    () =>
      (providers?.items ?? []).filter(
        (provider) =>
          (provider.credentialStatus === 'configured' || provider.authType === 'none') &&
          (modelsByProvider.get(provider.id)?.length ?? 0) > 0,
      ),
    [modelsByProvider, providers],
  );
  const modelSetupProvider = modelSetup
    ? providers?.items.find((provider) => provider.id === modelSetup.providerId)
    : undefined;
  const modelSetupModels = modelSetup ? (modelsByProvider.get(modelSetup.providerId) ?? []) : [];
  const modelSetupModel = modelSetupModels.find((model) => model.id === modelSetup?.modelId);
  const modelAlreadySelected = modelSetupModel?.selected === true;
  const modelSetupReviewed = Boolean(
    modelSetup?.preflight &&
    modelSetup.reviewedRevision === modelSetup.revision &&
    modelSetup.acknowledged,
  );

  const runProviderCheck = async (
    provider: Provider,
    operationType:
      | 'provider.validate'
      | 'provider.models.refresh'
      | 'provider.inference.test'
      | 'provider.persistence.verify',
  ) => {
    const modelId = (modelsByProvider.get(provider.id) ?? []).find((item) => item.selected)?.id;
    await mutate(
      operationType,
      'provider',
      provider.id,
      {
        expectedSourceVersion:
          operationType === 'provider.models.refresh' || operationType === 'provider.inference.test'
            ? models?.meta.sourceVersion
            : provider.sourceVersion,
        ...(operationType === 'provider.inference.test' && modelId ? { modelId } : {}),
      },
      true,
    );
  };

  const openSetup = (providerId = credentialProviders[0]?.id ?? '') => {
    if (!credentialEnabled || !providerId) return;
    setError('');
    setNotice('');
    setSetupStep(0);
    setSetup({
      providerId,
      credential: '',
      acknowledged: false,
      revision: 0,
      reviewedRevision: -1,
      dryRunKey: crypto.randomUUID(),
      executeKey: crypto.randomUUID(),
    });
  };

  const runProviderSetup = async (mode: 'dry-run' | 'execute') => {
    if (!setup || !setupProvider || !frameworkId || !credentialEnabled) return;
    if (!setup.credential.trim() || !setup.acknowledged) return;
    if (mode === 'execute' && !setupReviewed) return;
    const intent = setup;
    const provider = setupProvider;
    const requestedFramework = frameworkId;
    setBusy(`provider.setup.${mode}`);
    setError('');
    setNotice('');
    try {
      const result = await gateway.mutate(
        {
          operationType: 'provider.credential.set',
          target: {
            owner: 'hermes',
            kind: 'provider',
            nativeId: provider.id,
            frameworkId: requestedFramework,
          },
          payload: {
            credential: intent.credential,
            expectedSourceVersion: provider.sourceVersion,
          },
          mode,
          confirmed: true,
        },
        mode === 'dry-run' ? intent.dryRunKey : intent.executeKey,
      );
      if (selectedFramework.current !== requestedFramework) return;
      if (
        mode === 'dry-run' &&
        (currentSetup.current?.providerId !== intent.providerId ||
          currentSetup.current.revision !== intent.revision)
      )
        return;
      if (result.operation.state !== 'verified')
        throw new Error(
          `Governed provider setup did not verify; operation state is ${result.operation.state}.`,
        );
      if (mode === 'dry-run') {
        setSetup((current) =>
          current?.providerId === provider.id
            ? { ...current, preflight: result, reviewedRevision: intent.revision }
            : current,
        );
        setNotice('Hermes validated the credential update and completed the governed dry-run.');
      } else {
        setSetup(null);
        setSetupStep(0);
        setNotice(
          result.replayed
            ? `${provider.displayName} was already configured; governed evidence was replayed.`
            : `${provider.displayName} was configured in Hermes and verified by authoritative readback.`,
        );
        await load(true);
      }
    } catch (cause) {
      if (selectedFramework.current !== requestedFramework) return;
      setSetup((current) =>
        current?.providerId === provider.id
          ? {
              ...current,
              credential: '',
              acknowledged: false,
              revision: current.revision + 1,
              reviewedRevision: -1,
              preflight: undefined,
              dryRunKey: crypto.randomUUID(),
              executeKey: crypto.randomUUID(),
            }
          : current,
      );
      setSetupStep(1);
      setError(
        cause instanceof Error
          ? `${cause.message} The credential field was cleared.`
          : 'Hermes provider setup failed. The credential field was cleared.',
      );
    } finally {
      if (selectedFramework.current === requestedFramework) setBusy('');
    }
  };

  const openModelSetup = (
    providerId = selectedProvider?.id ?? modelProviders[0]?.id ?? '',
    modelId?: string,
  ) => {
    if (!modelEnabled || !providerId) return;
    const providerModels = modelsByProvider.get(providerId) ?? [];
    const targetModel =
      providerModels.find((model) => model.id === modelId) ??
      providerModels.find((model) => !model.selected) ??
      providerModels[0];
    if (!targetModel) return;
    setError('');
    setNotice('');
    setModelSetupStep(modelId ? 2 : 0);
    setModelSetup({
      providerId,
      modelId: targetModel.id,
      acknowledged: false,
      revision: 0,
      reviewedRevision: -1,
      dryRunKey: crypto.randomUUID(),
      executeKey: crypto.randomUUID(),
    });
  };

  const runModelSetup = async (mode: 'dry-run' | 'execute') => {
    if (
      !modelSetup ||
      !modelSetupProvider ||
      !modelSetupModel ||
      !frameworkId ||
      !modelEnabled ||
      !modelSetup.acknowledged
    )
      return;
    if (mode === 'execute' && !modelSetupReviewed) return;
    const intent = modelSetup;
    const model = modelSetupModel;
    const provider = modelSetupProvider;
    const requestedFramework = frameworkId;
    setBusy(`model.setup.${mode}`);
    setError('');
    setNotice('');
    try {
      const result = await gateway.mutate(
        {
          operationType: 'model.select',
          target: {
            owner: 'hermes',
            kind: 'model',
            nativeId: model.id,
            frameworkId: requestedFramework,
          },
          payload: {
            providerId: provider.id,
            confirmExpensiveModel: intent.acknowledged,
            expectedSourceVersion: model.sourceVersion,
          },
          mode,
          confirmed: true,
        },
        mode === 'dry-run' ? intent.dryRunKey : intent.executeKey,
      );
      if (selectedFramework.current !== requestedFramework) return;
      if (
        mode === 'dry-run' &&
        (currentModelSetup.current?.providerId !== intent.providerId ||
          currentModelSetup.current.modelId !== intent.modelId ||
          currentModelSetup.current.revision !== intent.revision)
      )
        return;
      if (result.operation.state !== 'verified')
        throw new Error(
          `Governed model selection did not verify; operation state is ${result.operation.state}.`,
        );
      if (mode === 'dry-run') {
        setModelSetup((current) =>
          current?.providerId === provider.id && current.modelId === model.id
            ? { ...current, preflight: result, reviewedRevision: intent.revision }
            : current,
        );
        setNotice(
          'Hermes validated this exact model selection and completed the governed dry-run.',
        );
      } else {
        setModelSetup(null);
        setModelSetupStep(0);
        setNotice(
          result.replayed
            ? `${model.displayName} was already selected; governed evidence was replayed.`
            : `${model.displayName} was selected in Hermes and verified by authoritative readback. Existing sessions are unchanged.`,
        );
        await load(true);
      }
    } catch (cause) {
      if (selectedFramework.current !== requestedFramework) return;
      setModelSetup((current) =>
        current?.providerId === provider.id && current.modelId === model.id
          ? {
              ...current,
              acknowledged: false,
              revision: current.revision + 1,
              reviewedRevision: -1,
              preflight: undefined,
              dryRunKey: crypto.randomUUID(),
              executeKey: crypto.randomUUID(),
            }
          : current,
      );
      setModelSetupStep(2);
      const message =
        cause instanceof Error ? cause.message : 'Hermes model selection workflow failed.';
      await load(true);
      if (selectedFramework.current === requestedFramework)
        setError(`${message} Review refreshed Hermes inventory before retrying.`);
    } finally {
      if (selectedFramework.current === requestedFramework) setBusy('');
    }
  };

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
        <Group>
          <Button
            disabled={!modelEnabled || !modelProviders.length}
            onClick={() => openModelSetup()}
          >
            Guided model selection
          </Button>
          <Button
            variant="light"
            disabled={!credentialEnabled || !credentialProviders.length}
            onClick={() => openSetup()}
          >
            Guided provider setup
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void load(true)}
            loading={loading}
          >
            Refresh from Hermes
          </Button>
        </Group>
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
              const providerReady =
                provider.credentialStatus === 'configured' || provider.authType === 'none';
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
                          Connection: {provider.connectionState ?? provider.credentialStatus}
                        </Badge>
                        <Badge variant="light">
                          {formatContractValue(
                            provider.authMethod ?? provider.authType ?? 'unknown',
                          )}
                        </Badge>
                        <Badge color={readinessColor(provider.deploymentReadiness)}>
                          {formatContractValue(provider.deploymentReadiness ?? 'unsupported')}
                        </Badge>
                        <Badge variant="light">{providerModels.length} models</Badge>
                      </Group>
                      {provider.setupFields?.length ? (
                        <Text size="sm" c="dimmed">
                          Required setup:{' '}
                          {provider.setupFields
                            .map((field) => `${field.label}${field.required ? '' : ' (optional)'}`)
                            .join(', ')}
                        </Text>
                      ) : null}
                      {provider.prerequisites?.length ? (
                        <Text size="sm" c="dimmed">
                          Prerequisites:{' '}
                          {provider.prerequisites
                            .map((item) => `${item.label} · ${formatContractValue(item.status)}`)
                            .join(', ')}
                        </Text>
                      ) : null}
                      {provider.readinessReasonCodes?.length ? (
                        <Text size="xs" c="dimmed">
                          Readiness:{' '}
                          {provider.readinessReasonCodes.map(formatContractValue).join(', ')}
                        </Text>
                      ) : null}
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
                                disabled={!modelEnabled || model.selected || !providerReady}
                                loading={Boolean(busy) && modelSetup?.modelId === model.id}
                                onClick={() => openModelSetup(provider.id, model.id)}
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
                      {provider.authMethod === 'oauth_browser' ||
                      provider.authMethod === 'oauth_device_code' ? (
                        <Text size="sm" c="dimmed">
                          OAuth sign-in is required. This release exposes the truthful requirement;
                          the governed OAuth connection flow is not implemented yet.
                        </Text>
                      ) : provider.authMethod === 'none' ? (
                        <Text size="sm" c="dimmed">
                          Hermes reports that this provider requires no credential.
                        </Text>
                      ) : provider.setupSupported && provider.credentialMutable ? (
                        <Group>
                          <Button
                            variant="light"
                            disabled={!credentialEnabled}
                            onClick={() => openSetup(provider.id)}
                          >
                            {provider.credentialStatus === 'configured'
                              ? 'Update credential'
                              : 'Connect provider'}
                          </Button>
                          {provider.credentialStatus === 'configured' ? (
                            <>
                              <Button
                                size="xs"
                                variant="default"
                                disabled={!modelEnabled || Boolean(busy)}
                                onClick={() => void runProviderCheck(provider, 'provider.validate')}
                              >
                                Validate
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                disabled={!modelEnabled || Boolean(busy)}
                                onClick={() =>
                                  void runProviderCheck(provider, 'provider.models.refresh')
                                }
                              >
                                Discover models
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                disabled={
                                  !modelEnabled ||
                                  Boolean(busy) ||
                                  !providerModels.some((item) => item.selected)
                                }
                                onClick={() =>
                                  void runProviderCheck(provider, 'provider.inference.test')
                                }
                              >
                                Test inference
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                disabled={!modelEnabled || Boolean(busy)}
                                onClick={() =>
                                  void runProviderCheck(provider, 'provider.persistence.verify')
                                }
                              >
                                Verify persistence
                              </Button>
                            </>
                          ) : null}
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
                                { expectedSourceVersion: provider.sourceVersion },
                                true,
                              );
                            }}
                          >
                            Remove credential
                          </Button>
                        </Group>
                      ) : (
                        <Alert color="blue">
                          This provider requires a dedicated governed setup flow. Generic credential
                          entry is disabled to prevent an incomplete or incorrect configuration.
                        </Alert>
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
      <Modal
        opened={Boolean(modelSetup)}
        onClose={() => {
          if (busy) return;
          setModelSetup(null);
          setModelSetupStep(0);
        }}
        title="Select a Hermes model"
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        closeButtonProps={{ 'aria-label': 'Close model setup' }}
      >
        {modelSetup ? (
          <Stack>
            <Stepper active={modelSetupStep}>
              <Stepper.Step label="Provider" description="Choose configured owner" />
              <Stepper.Step label="Model" description="Choose catalogue entry" />
              <Stepper.Step label="Review" description="Dry-run and select" />
            </Stepper>
            {modelSetupStep === 0 ? (
              <Stack>
                <Select
                  label="Model provider"
                  data={modelProviders.map((provider) => ({
                    value: provider.id,
                    label: `${provider.displayName} · ${modelsByProvider.get(provider.id)?.length ?? 0} models`,
                  }))}
                  value={modelSetup.providerId}
                  onChange={(providerId) => {
                    if (!providerId) return;
                    const firstModel = modelsByProvider.get(providerId)?.[0];
                    setModelSetup((current) =>
                      current && firstModel
                        ? {
                            ...current,
                            providerId,
                            modelId: firstModel.id,
                            acknowledged: false,
                            revision: current.revision + 1,
                            reviewedRevision: -1,
                            preflight: undefined,
                            dryRunKey: crypto.randomUUID(),
                            executeKey: crypto.randomUUID(),
                          }
                        : current,
                    );
                  }}
                />
                <Text size="sm" c="dimmed">
                  Only providers that Hermes reports as credential-ready, or credential-free, are
                  offered. Configure a missing provider credential first.
                </Text>
                <Group justify="flex-end">
                  <Button disabled={!modelSetupProvider} onClick={() => setModelSetupStep(1)}>
                    Continue
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {modelSetupStep === 1 ? (
              <Stack>
                <Select
                  label="Model"
                  data={modelSetupModels.map((model) => ({
                    value: model.id,
                    label: `${model.displayName}${model.costTier ? ` · ${model.costTier}` : ''}${model.selected ? ' · selected' : ''}`,
                  }))}
                  value={modelSetup.modelId}
                  onChange={(modelId) =>
                    setModelSetup((current) =>
                      current && modelId
                        ? {
                            ...current,
                            modelId,
                            acknowledged: false,
                            revision: current.revision + 1,
                            reviewedRevision: -1,
                            preflight: undefined,
                            dryRunKey: crypto.randomUUID(),
                            executeKey: crypto.randomUUID(),
                          }
                        : current,
                    )
                  }
                />
                {modelSetupModel ? (
                  <Group>
                    <Badge>{modelSetupModel.costTier ?? 'unknown cost'}</Badge>
                    {modelSetupModel.capabilities.map((capability) => (
                      <Badge key={capability} variant="light">
                        {capability}
                      </Badge>
                    ))}
                  </Group>
                ) : null}
                <Group justify="space-between">
                  <Button variant="default" onClick={() => setModelSetupStep(0)}>
                    Back
                  </Button>
                  <Button disabled={!modelSetupModel} onClick={() => setModelSetupStep(2)}>
                    Review
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {modelSetupStep === 2 ? (
              <Stack>
                <Text>
                  Model: <strong>{modelSetupModel?.displayName ?? modelSetup.modelId}</strong>
                </Text>
                <Text size="sm">
                  Framework <Code>{frameworkId}</Code> · provider{' '}
                  <Code>{modelSetup.providerId}</Code> · native model{' '}
                  <Code>{modelSetup.modelId}</Code>
                </Text>
                <Text size="sm">
                  Cost tier <Code>{modelSetupModel?.costTier ?? 'unknown'}</Code> · source
                  precondition <Code>{modelSetupModel?.sourceVersion ?? 'unavailable'}</Code>
                </Text>
                <Alert color="blue">
                  Existing sessions keep their current model. This selection applies to new Hermes
                  sessions. Actual pricing and availability remain controlled by the provider.
                </Alert>
                {modelAlreadySelected ? (
                  <Alert color="teal">
                    This model is already selected in authoritative Hermes inventory.
                  </Alert>
                ) : null}
                <Checkbox
                  checked={modelSetup.acknowledged}
                  disabled={Boolean(busy) || modelAlreadySelected}
                  label="I authorize this model selection and acknowledge that provider pricing may differ, including premium or unknown cost tiers."
                  onChange={(event) => {
                    const acknowledged = event.currentTarget.checked;
                    setModelSetup((current) =>
                      current
                        ? { ...current, acknowledged, preflight: undefined, reviewedRevision: -1 }
                        : current,
                    );
                  }}
                />
                {modelSetupReviewed ? (
                  <Alert color="teal">
                    Governed dry-run passed for this exact framework, provider, model, source
                    version, and acknowledgement.
                  </Alert>
                ) : null}
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={Boolean(busy)}
                    onClick={() => setModelSetupStep(1)}
                  >
                    Back
                  </Button>
                  <Group>
                    <Button
                      variant="light"
                      disabled={!modelSetup.acknowledged || modelAlreadySelected || Boolean(busy)}
                      loading={busy === 'model.setup.dry-run'}
                      onClick={() => void runModelSetup('dry-run')}
                    >
                      Validate and dry-run
                    </Button>
                    <Button
                      disabled={!modelSetupReviewed || modelAlreadySelected || Boolean(busy)}
                      loading={busy === 'model.setup.execute'}
                      onClick={() => void runModelSetup('execute')}
                    >
                      Select in Hermes
                    </Button>
                  </Group>
                </Group>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Modal>
      <Modal
        opened={Boolean(setup)}
        onClose={() => {
          if (busy) return;
          setSetup(null);
          setSetupStep(0);
        }}
        title="Connect a Hermes provider"
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        closeButtonProps={{ 'aria-label': 'Close provider setup' }}
      >
        {setup ? (
          <Stack>
            <Stepper active={setupStep}>
              <Stepper.Step label="Provider" description="Choose owner" />
              <Stepper.Step label="Credential" description="Enter once" />
              <Stepper.Step label="Review" description="Dry-run and apply" />
            </Stepper>
            {setupStep === 0 ? (
              <Stack>
                <Select
                  label="Provider"
                  data={credentialProviders.map((provider) => ({
                    value: provider.id,
                    label: `${provider.displayName} · ${provider.credentialStatus}`,
                  }))}
                  value={setup.providerId}
                  onChange={(providerId) =>
                    setSetup((current) =>
                      current && providerId
                        ? {
                            ...current,
                            providerId,
                            credential: '',
                            acknowledged: false,
                            revision: current.revision + 1,
                            reviewedRevision: -1,
                            preflight: undefined,
                            dryRunKey: crypto.randomUUID(),
                            executeKey: crypto.randomUUID(),
                          }
                        : current,
                    )
                  }
                />
                <Text size="sm" c="dimmed">
                  Only credential-mutable API-key providers advertised by this Hermes framework are
                  selectable. OAuth remains owned by Hermes.
                </Text>
                <Group justify="flex-end">
                  <Button disabled={!setupProvider} onClick={() => setSetupStep(1)}>
                    Continue
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {setupStep === 1 ? (
              <Stack>
                <Alert color="blue">
                  The value remains only in this open form, is sent only in governed mutation
                  bodies, and is cleared after success, failure, close, or framework change.
                </Alert>
                <PasswordInput
                  label={`API credential for ${setupProvider?.displayName ?? setup.providerId}`}
                  placeholder="Enter credential"
                  value={setup.credential}
                  disabled={Boolean(busy)}
                  autoComplete="new-password"
                  onChange={(event) => {
                    const credential = event.currentTarget.value;
                    setSetup((current) =>
                      current
                        ? {
                            ...current,
                            credential,
                            acknowledged: false,
                            revision: current.revision + 1,
                            reviewedRevision: -1,
                            preflight: undefined,
                            dryRunKey: crypto.randomUUID(),
                            executeKey: crypto.randomUUID(),
                          }
                        : current,
                    );
                  }}
                />
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={Boolean(busy)}
                    onClick={() => setSetupStep(0)}
                  >
                    Back
                  </Button>
                  <Button
                    disabled={!setup.credential.trim() || Boolean(busy)}
                    onClick={() => setSetupStep(2)}
                  >
                    Review
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {setupStep === 2 ? (
              <Stack>
                <Text>
                  Provider: <strong>{setupProvider?.displayName ?? setup.providerId}</strong>
                </Text>
                <Text size="sm">
                  Framework <Code>{frameworkId}</Code> · native provider{' '}
                  <Code>{setup.providerId}</Code>
                </Text>
                <Text size="sm">
                  Source precondition <Code>{setupProvider?.sourceVersion ?? 'unavailable'}</Code>
                </Text>
                <Text size="sm" c="dimmed">
                  Credential: entered and hidden. It will not appear in operation evidence or
                  inventory responses.
                </Text>
                <Checkbox
                  checked={setup.acknowledged}
                  disabled={Boolean(busy)}
                  label="I authorize Hermes to store or replace this provider credential."
                  onChange={(event) => {
                    const acknowledged = event.currentTarget.checked;
                    setSetup((current) => (current ? { ...current, acknowledged } : current));
                  }}
                />
                {setupReviewed ? (
                  <Alert color="teal">
                    Governed dry-run passed for this exact provider, framework, source version, and
                    credential revision.
                  </Alert>
                ) : null}
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={Boolean(busy)}
                    onClick={() => setSetupStep(1)}
                  >
                    Back
                  </Button>
                  <Group>
                    <Button
                      variant="light"
                      disabled={!setup.acknowledged || !setup.credential.trim() || Boolean(busy)}
                      loading={busy === 'provider.setup.dry-run'}
                      onClick={() => void runProviderSetup('dry-run')}
                    >
                      Validate and dry-run
                    </Button>
                    <Button
                      disabled={!setupReviewed || Boolean(busy)}
                      loading={busy === 'provider.setup.execute'}
                      onClick={() => void runProviderSetup('execute')}
                    >
                      Save in Hermes
                    </Button>
                  </Group>
                </Group>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Modal>
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
function readinessColor(status: Provider['deploymentReadiness']) {
  return status === 'ready'
    ? 'teal'
    : status === 'needs_selection' || status === 'needs_model'
      ? 'yellow'
      : status === 'needs_configuration'
        ? 'orange'
        : 'gray';
}
function formatContractValue(value: string) {
  return value.replaceAll('_', ' ');
}
function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
