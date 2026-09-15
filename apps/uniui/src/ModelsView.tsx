import { formatUserDate } from './userTime';
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
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconRefresh, IconSparkles } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, gateway } from './api';
import { oauthStart, oauthStatus } from './oauthResult';
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
    choices?: Array<{ value: string; label: string }>;
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
  values: Record<string, string>;
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
type DeploymentWizard = {
  step: number;
  providerId: string;
  setupValues: Record<string, string>;
  modelId: string;
  acknowledged: boolean;
  connectionVerified: boolean;
  discoveryVerified: boolean;
  selectionVerified: boolean;
  smokeVerified: boolean;
  readbackSourceVersion?: string;
  smokeSessionId?: string;
};
type OAuthSession = {
  provider: Provider;
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'error';
  expiresAt?: number;
  error?: string;
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
  const [deployment, setDeployment] = useState<DeploymentWizard | null>(null);
  const [oauth, setOauth] = useState<OAuthSession | null>(null);
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

  const runOauth = async (provider: Provider, reconnect = false) => {
    const requestedFramework = frameworkId;
    if (!requestedFramework) return;
    const operationType = reconnect ? 'provider.oauth.reconnect' : 'provider.oauth.start';
    setBusy(`${operationType}:${provider.id}`);
    setError('');
    try {
      const result = await gateway.mutate({
        operationType,
        target: {
          owner: 'hermes',
          kind: 'provider',
          nativeId: provider.id,
          frameworkId: requestedFramework,
        },
        payload: { expectedSourceVersion: provider.sourceVersion },
        mode: 'execute',
        confirmed: reconnect,
      });
      if (selectedFramework.current !== requestedFramework) return;
      const data = oauthStart(result);
      setOauth({
        provider,
        sessionId: data.sessionId,
        userCode: data.userCode,
        verificationUrl: data.verificationUrl,
        status: 'pending',
        expiresAt: Date.now() + data.expiresIn * 1000,
      });
    } catch (cause) {
      if (selectedFramework.current !== requestedFramework) return;
      setOauth(null);
      setError(cause instanceof Error ? cause.message : 'OAuth authorization could not start');
    } finally {
      if (selectedFramework.current === requestedFramework) setBusy('');
    }
  };

  useEffect(() => {
    if (!oauth || oauth.status !== 'pending' || !oauth.sessionId || !frameworkId) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await gateway.mutate({
            operationType: 'provider.oauth.status',
            target: { owner: 'hermes', kind: 'provider', nativeId: oauth.provider.id, frameworkId },
            payload: { sessionId: oauth.sessionId },
            mode: 'execute',
            confirmed: false,
          });
          if (selectedFramework.current !== frameworkId) return;
          const { status, error: errorMessage } = oauthStatus(result);
          setOauth((current) =>
            current
              ? {
                  ...current,
                  status,
                  ...(errorMessage ? { error: errorMessage } : {}),
                }
              : current,
          );
          if (status === 'approved') {
            setNotice(`${oauth.provider.displayName} OAuth authorization completed in Hermes.`);
            await load(true);
          }
        } catch (cause) {
          setOauth((current) =>
            current
              ? {
                  ...current,
                  status: 'error',
                  error: cause instanceof Error ? cause.message : 'OAuth status failed',
                }
              : current,
          );
        }
      })();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [frameworkId, load, oauth?.provider.id, oauth?.sessionId, oauth?.status]);

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
          provider.credentialMutable !== false &&
          ((provider.setupFields?.length ?? 0) > 0 ||
            provider.authType === 'api_key' ||
            provider.authType === 'unknown'),
      ),
    [providers],
  );
  const setupProvider = setup
    ? providers?.items.find((provider) => provider.id === setup.providerId)
    : undefined;
  const setupRequired = (setupProvider?.setupFields ?? []).every(
    (field) => !field.required || Boolean(setup?.values[field.id]?.trim()),
  );
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
  const deploymentProvider = deployment
    ? providers?.items.find((provider) => provider.id === deployment.providerId)
    : undefined;
  const deploymentModels = deployment ? (modelsByProvider.get(deployment.providerId) ?? []) : [];
  const deploymentModel = deploymentModels.find((model) => model.id === deployment?.modelId);
  const deploymentSetupRequired = (deploymentProvider?.setupFields ?? []).every(
    (field) => !field.required || Boolean(deployment?.setupValues[field.id]?.trim()),
  );

  const openDeployment = () => {
    const provider =
      selectedProvider ??
      providers?.items.find((item) => item.credentialStatus === 'configured') ??
      providers?.items[0];
    if (!provider || !frameworkId || !credentialEnabled || !modelEnabled) return;
    const providerModels = modelsByProvider.get(provider.id) ?? [];
    setDeployment({
      step: 0,
      providerId: provider.id,
      setupValues: Object.fromEntries(
        (provider.setupFields ?? []).map((field) => [
          field.id,
          field.type === 'choice' ? (field.choices?.[0]?.value ?? '') : '',
        ]),
      ),
      modelId: providerModels.find((model) => model.selected)?.id ?? providerModels[0]?.id ?? '',
      acknowledged: false,
      connectionVerified:
        provider.credentialStatus === 'configured' || provider.authType === 'none',
      discoveryVerified: false,
      selectionVerified: false,
      smokeVerified: false,
    });
    setError('');
    setNotice('');
  };

  const wizardMutation = async (
    operationType: string,
    kind: 'provider' | 'model',
    nativeId: string,
    payload: Record<string, unknown>,
    mode: 'dry-run' | 'execute' = 'execute',
  ) => {
    if (!frameworkId) throw new Error('Choose a verified Hermes framework first.');
    const result = await gateway.mutate(
      {
        operationType,
        target: { owner: 'hermes', kind, nativeId, frameworkId },
        payload,
        mode,
        confirmed: true,
      },
      crypto.randomUUID(),
    );
    if (result.operation.state !== 'verified')
      throw new Error(`${operationType} did not verify; state is ${result.operation.state}.`);
    return result;
  };

  const connectDeploymentProvider = async () => {
    if (!deployment || !deploymentProvider) return;
    setBusy('deployment.connect');
    setError('');
    try {
      if (
        deploymentProvider.credentialStatus !== 'configured' &&
        deploymentProvider.authType !== 'none'
      ) {
        if (!deploymentSetupRequired)
          throw new Error('Complete every required provider setup field before connecting.');
        const payload = {
          setup: deployment.setupValues,
          expectedSourceVersion: deploymentProvider.sourceVersion,
        };
        await wizardMutation(
          'provider.credential.set',
          'provider',
          deploymentProvider.id,
          payload,
          'dry-run',
        );
        await wizardMutation('provider.credential.set', 'provider', deploymentProvider.id, payload);
      } else {
        await wizardMutation('provider.validate', 'provider', deploymentProvider.id, {
          expectedSourceVersion: deploymentProvider.sourceVersion,
        });
      }
      await load(true);
      setDeployment((current) =>
        current ? { ...current, connectionVerified: true, setupValues: {}, step: 3 } : current,
      );
    } catch (cause) {
      setDeployment((current) =>
        current ? { ...current, setupValues: {}, connectionVerified: false } : current,
      );
      setError(cause instanceof Error ? cause.message : 'Provider connection failed.');
    } finally {
      setBusy('');
    }
  };

  const discoverDeploymentModels = async () => {
    if (!deployment || !deploymentProvider || !frameworkId) return;
    setBusy('deployment.discover');
    setError('');
    try {
      await wizardMutation('provider.models.refresh', 'provider', deployment.providerId, {
        expectedSourceVersion: models?.meta.sourceVersion,
      });
      const inventory = await api<Collection<Model>>(
        `/frameworks/${encodeURIComponent(frameworkId)}/models?limit=500&refresh=true`,
      );
      const discovered = inventory.items.filter(
        (model) => model.providerId === deployment.providerId,
      );
      if (!discovered.length) throw new Error('Hermes discovered no deployable models.');
      setModels(inventory);
      setDeployment((current) =>
        current
          ? {
              ...current,
              discoveryVerified: true,
              modelId:
                discovered.find((model) => model.id === current.modelId)?.id ?? discovered[0]!.id,
              step: 4,
            }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model discovery failed.');
    } finally {
      setBusy('');
    }
  };

  const deploySelectedModel = async () => {
    if (!deployment || !deploymentModel || !deployment.acknowledged || !frameworkId) return;
    setBusy('deployment.select');
    setError('');
    try {
      const payload = {
        providerId: deployment.providerId,
        confirmExpensiveModel: true,
        expectedSourceVersion: deploymentModel.sourceVersion,
      };
      await wizardMutation('model.select', 'model', deployment.modelId, payload, 'dry-run');
      await wizardMutation('model.select', 'model', deployment.modelId, payload);
      const inventory = await api<Collection<Model>>(
        `/frameworks/${encodeURIComponent(frameworkId)}/models?limit=500&refresh=true`,
      );
      const selected = inventory.items.find((model) => model.selected);
      if (
        !selected ||
        selected.providerId !== deployment.providerId ||
        selected.id !== deployment.modelId
      )
        throw new Error('Authoritative Hermes readback did not confirm the exact selected model.');
      setModels(inventory);
      setDeployment((current) =>
        current
          ? {
              ...current,
              selectionVerified: true,
              readbackSourceVersion: inventory.meta.sourceVersion,
              step: 5,
            }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model deployment failed.');
    } finally {
      setBusy('');
    }
  };

  const smokeTestDeployment = async () => {
    if (!deployment || !deployment.selectionVerified) return;
    setBusy('deployment.smoke');
    setError('');
    try {
      const result = await wizardMutation(
        'provider.inference.test',
        'provider',
        deployment.providerId,
        {
          modelId: deployment.modelId,
          expectedSourceVersion: models?.meta.sourceVersion,
        },
      );
      const evidence = (result.result ?? {}) as Record<string, unknown>;
      if (evidence.succeeded !== true)
        throw new Error('Hermes inference smoke test did not return success evidence.');
      setDeployment((current) =>
        current
          ? {
              ...current,
              smokeVerified: true,
              smokeSessionId: String(evidence.sessionId ?? ''),
              step: 6,
            }
          : current,
      );
      setNotice('Model deployment and real Hermes inference smoke test verified.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inference smoke test failed.');
    } finally {
      setBusy('');
    }
  };

  const runProviderCheck = async (
    provider: Provider,
    operationType:
      | 'provider.validate'
      | 'provider.models.refresh'
      | 'provider.inference.test'
      | 'provider.persistence.verify',
    setupValues?: Record<string, string>,
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
        ...(operationType === 'provider.validate' && setupValues ? { setup: setupValues } : {}),
      },
      true,
    );
  };

  const openSetup = (providerId = credentialProviders[0]?.id ?? '') => {
    if (!credentialEnabled || !providerId) return;
    setError('');
    setNotice('');
    setSetupStep(0);
    const provider = providers?.items.find((item) => item.id === providerId);
    const values = Object.fromEntries(
      (provider?.setupFields ?? []).map((field) => [
        field.id,
        field.type === 'choice' ? (field.choices?.[0]?.value ?? '') : '',
      ]),
    );
    setSetup({
      providerId,
      values,
      acknowledged: false,
      revision: 0,
      reviewedRevision: -1,
      dryRunKey: crypto.randomUUID(),
      executeKey: crypto.randomUUID(),
    });
  };

  const runProviderSetup = async (mode: 'dry-run' | 'execute') => {
    if (!setup || !setupProvider || !frameworkId || !credentialEnabled) return;
    if (!setupRequired || !setup.acknowledged) return;
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
          payload:
            provider.setupFields?.length === 1 && provider.setupFields[0]?.id === 'credential'
              ? {
                  credential: intent.values.credential,
                  expectedSourceVersion: provider.sourceVersion,
                }
              : {
                  setup: intent.values,
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
              values: Object.fromEntries(Object.keys(current.values).map((key) => [key, ''])),
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
            leftSection={<IconSparkles size={16} />}
            disabled={
              !credentialEnabled || !modelEnabled || !(providers?.items.length ?? 0) || !frameworkId
            }
            onClick={openDeployment}
          >
            Deploy a model
          </Button>
          <Button
            variant="light"
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
                        <Stack gap="xs">
                          <Text size="sm" c="dimmed">
                            Hermes uses a device-code authorization. UNIUI never receives or stores
                            the resulting access or refresh token.
                          </Text>
                          <Group>
                            <Button
                              variant="light"
                              disabled={!credentialEnabled || Boolean(busy)}
                              loading={busy === `provider.oauth.start:${provider.id}`}
                              onClick={() => void runOauth(provider)}
                            >
                              {provider.credentialStatus === 'configured'
                                ? 'Authorize again'
                                : 'Connect OAuth'}
                            </Button>
                            <Button
                              variant="default"
                              disabled={!credentialEnabled || Boolean(busy)}
                              onClick={() =>
                                void mutate('provider.oauth.status', 'provider', provider.id, {
                                  expectedSourceVersion: provider.sourceVersion,
                                })
                              }
                            >
                              Refresh status
                            </Button>
                            {provider.credentialStatus === 'configured' ? (
                              <>
                                <Button
                                  variant="default"
                                  disabled={!credentialEnabled || Boolean(busy)}
                                  loading={busy === `provider.oauth.reconnect:${provider.id}`}
                                  onClick={() => void runOauth(provider, true)}
                                >
                                  Reconnect
                                </Button>
                                <Button
                                  color="red"
                                  variant="light"
                                  disabled={!credentialEnabled || Boolean(busy)}
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `Disconnect ${provider.displayName} OAuth from Hermes?`,
                                      )
                                    )
                                      return;
                                    void mutate(
                                      'provider.oauth.disconnect',
                                      'provider',
                                      provider.id,
                                      { expectedSourceVersion: provider.sourceVersion },
                                      true,
                                    );
                                  }}
                                >
                                  Disconnect
                                </Button>
                              </>
                            ) : null}
                          </Group>
                        </Stack>
                      ) : provider.authMethod === 'external_cli' ? (
                        <Stack gap="xs">
                          <Alert
                            color={provider.credentialStatus === 'configured' ? 'teal' : 'yellow'}
                          >
                            UNIFY does not install or authenticate external CLIs. Validation checks
                            the Hermes runtime executable; account entitlement is proven only by a
                            governed inference test.
                          </Alert>
                          <Group>
                            <Button
                              variant="light"
                              disabled={!modelEnabled || Boolean(busy)}
                              onClick={() => void runProviderCheck(provider, 'provider.validate')}
                            >
                              Validate CLI prerequisite
                            </Button>
                            <Button
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
                              Verify CLI identity
                            </Button>
                          </Group>
                        </Stack>
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
                              ? provider.authMethod === 'cloud_identity'
                                ? 'Update cloud routing'
                                : 'Update credential'
                              : provider.authMethod === 'cloud_identity'
                                ? 'Configure cloud identity'
                                : 'Connect provider'}
                          </Button>
                          {provider.authMethod === 'cloud_identity' ? (
                            <Button
                              size="xs"
                              variant="default"
                              disabled={!modelEnabled || Boolean(busy)}
                              onClick={() => void runProviderCheck(provider, 'provider.validate')}
                            >
                              Validate runtime identity
                            </Button>
                          ) : null}
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
        opened={Boolean(deployment)}
        onClose={() => {
          if (!busy) setDeployment(null);
        }}
        title="Unified model deployment"
        size="xl"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
      >
        {deployment ? (
          <Stack>
            <Stepper active={deployment.step} size="sm">
              <Stepper.Step label="Persona" description="Herman or Alica" />
              <Stepper.Step label="Provider" description="Choose connection" />
              <Stepper.Step label="Connect" description="Validate setup" />
              <Stepper.Step label="Discover" description="Read live catalogue" />
              <Stepper.Step label="Default" description="Select and read back" />
              <Stepper.Step label="Smoke test" description="Run real inference" />
              <Stepper.Completed>Verified</Stepper.Completed>
            </Stepper>
            {deployment.step === 0 ? (
              <Stack>
                <Select
                  label="Hermes persona"
                  description="Every operation remains pinned to this exact framework."
                  data={frameworkOptions}
                  value={frameworkId || null}
                  onChange={(value) => {
                    if (value) selectFramework(value);
                  }}
                />
                <Group justify="flex-end">
                  <Button
                    disabled={!frameworkId}
                    onClick={() => setDeployment({ ...deployment, step: 1 })}
                  >
                    Choose provider
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {deployment.step === 1 ? (
              <Stack>
                <Select
                  label="Provider"
                  data={(providers?.items ?? [])
                    .filter(
                      (provider) =>
                        provider.credentialStatus === 'configured' ||
                        provider.authType === 'none' ||
                        (provider.setupFields?.length ?? 0) > 0,
                    )
                    .map((provider) => ({
                      value: provider.id,
                      label: `${provider.displayName} · ${provider.credentialStatus}`,
                    }))}
                  value={deployment.providerId}
                  onChange={(providerId) => {
                    const provider = providers?.items.find((item) => item.id === providerId);
                    if (!provider) return;
                    const available = modelsByProvider.get(provider.id) ?? [];
                    setDeployment({
                      ...deployment,
                      providerId: provider.id,
                      setupValues: Object.fromEntries(
                        (provider.setupFields ?? []).map((field) => [
                          field.id,
                          field.type === 'choice' ? (field.choices?.[0]?.value ?? '') : '',
                        ]),
                      ),
                      modelId:
                        available.find((model) => model.selected)?.id ?? available[0]?.id ?? '',
                      acknowledged: false,
                      connectionVerified:
                        provider.credentialStatus === 'configured' || provider.authType === 'none',
                      discoveryVerified: false,
                      selectionVerified: false,
                      smokeVerified: false,
                    });
                  }}
                />
                <Group justify="space-between">
                  <Button
                    variant="default"
                    onClick={() => setDeployment({ ...deployment, step: 0 })}
                  >
                    Back
                  </Button>
                  <Button
                    disabled={!deploymentProvider}
                    onClick={() => setDeployment({ ...deployment, step: 2 })}
                  >
                    Connect provider
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {deployment.step === 2 ? (
              <Stack>
                {deploymentProvider?.credentialStatus === 'configured' ||
                deploymentProvider?.authType === 'none' ? (
                  <Alert color="blue">
                    Hermes already reports this provider connected. The wizard will revalidate it
                    without replacing credentials.
                  </Alert>
                ) : (
                  (deploymentProvider?.setupFields ?? []).map((field) => {
                    const update = (value: string) =>
                      setDeployment({
                        ...deployment,
                        setupValues: { ...deployment.setupValues, [field.id]: value },
                        connectionVerified: false,
                      });
                    return field.type === 'choice' ? (
                      <Select
                        key={field.id}
                        label={field.label}
                        data={field.choices ?? []}
                        value={deployment.setupValues[field.id] ?? null}
                        onChange={(value) => update(value ?? '')}
                      />
                    ) : field.secret ? (
                      <PasswordInput
                        key={field.id}
                        label={field.label}
                        value={deployment.setupValues[field.id] ?? ''}
                        autoComplete="new-password"
                        onChange={(event) => update(event.currentTarget.value)}
                      />
                    ) : (
                      <TextInput
                        key={field.id}
                        label={field.label}
                        value={deployment.setupValues[field.id] ?? ''}
                        onChange={(event) => update(event.currentTarget.value)}
                      />
                    );
                  })
                )}
                <Text size="sm" c="dimmed">
                  Submitted secrets are cleared immediately after validation and never appear in
                  readback evidence.
                </Text>
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={Boolean(busy)}
                    onClick={() => setDeployment({ ...deployment, step: 1 })}
                  >
                    Back
                  </Button>
                  <Button
                    loading={busy === 'deployment.connect'}
                    disabled={
                      (!deploymentSetupRequired &&
                        deploymentProvider?.credentialStatus !== 'configured' &&
                        deploymentProvider?.authType !== 'none') ||
                      Boolean(busy)
                    }
                    onClick={() => void connectDeploymentProvider()}
                  >
                    Validate and connect
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {deployment.step === 3 ? (
              <Stack>
                <Alert color={deployment.connectionVerified ? 'teal' : 'red'}>
                  Provider connection {deployment.connectionVerified ? 'verified' : 'not verified'}
                  by Hermes. Discovery is an authoritative provider refresh, not cached UI data.
                </Alert>
                <Group justify="space-between">
                  <Button
                    variant="default"
                    onClick={() => setDeployment({ ...deployment, step: 2 })}
                  >
                    Back
                  </Button>
                  <Button
                    loading={busy === 'deployment.discover'}
                    disabled={!deployment.connectionVerified || Boolean(busy)}
                    onClick={() => void discoverDeploymentModels()}
                  >
                    Discover models
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {deployment.step === 4 ? (
              <Stack>
                <Alert color="teal">
                  Hermes discovered {deploymentModels.length} model(s) for this exact provider.
                </Alert>
                <Select
                  label="Default model for new sessions"
                  searchable
                  data={deploymentModels.map((model) => ({
                    value: model.id,
                    label: `${model.displayName}${model.costTier ? ` · ${model.costTier}` : ''}`,
                  }))}
                  value={deployment.modelId || null}
                  onChange={(modelId) =>
                    setDeployment({
                      ...deployment,
                      modelId: modelId ?? '',
                      acknowledged: false,
                      selectionVerified: false,
                    })
                  }
                />
                <Checkbox
                  checked={deployment.acknowledged}
                  label="I authorize this exact default-model change and acknowledge provider pricing."
                  onChange={(event) =>
                    setDeployment({ ...deployment, acknowledged: event.currentTarget.checked })
                  }
                />
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={Boolean(busy)}
                    onClick={() => setDeployment({ ...deployment, step: 3 })}
                  >
                    Back
                  </Button>
                  <Button
                    loading={busy === 'deployment.select'}
                    disabled={!deploymentModel || !deployment.acknowledged || Boolean(busy)}
                    onClick={() => void deploySelectedModel()}
                  >
                    Select default and verify readback
                  </Button>
                </Group>
              </Stack>
            ) : null}
            {deployment.step === 5 ? (
              <Stack>
                <Alert color="teal">
                  Authoritative readback confirmed{' '}
                  <Code>
                    {deployment.providerId}/{deployment.modelId}
                  </Code>{' '}
                  at source version <Code>{deployment.readbackSourceVersion}</Code>.
                </Alert>
                <Text size="sm">
                  The final check creates an isolated Hermes smoke-test session and requests a real
                  response from this exact provider/model. It does not reuse a browser-side success.
                </Text>
                <Button
                  loading={busy === 'deployment.smoke'}
                  disabled={!deployment.selectionVerified || Boolean(busy)}
                  onClick={() => void smokeTestDeployment()}
                >
                  Run inference smoke test
                </Button>
              </Stack>
            ) : null}
            {deployment.step === 6 ? (
              <Stack>
                <Alert color="teal" title="Deployment verified">
                  Provider connection, live discovery, default selection, authoritative readback,
                  and real inference all passed.
                </Alert>
                <Text size="sm">
                  Persona <Code>{frameworkId}</Code> · model{' '}
                  <Code>
                    {deployment.providerId}/{deployment.modelId}
                  </Code>{' '}
                  · smoke session <Code>{deployment.smokeSessionId || 'recorded by Hermes'}</Code>
                </Text>
                <Group justify="flex-end">
                  <Button onClick={() => setDeployment(null)}>Done</Button>
                </Group>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Modal>
      <Modal
        opened={Boolean(oauth)}
        onClose={() => setOauth(null)}
        title={`${oauth?.provider.displayName ?? 'Provider'} OAuth authorization`}
        closeOnClickOutside={oauth?.status !== 'pending'}
        closeOnEscape={oauth?.status !== 'pending'}
      >
        {oauth ? (
          <Stack>
            <Badge
              color={
                oauth.status === 'approved' ? 'teal' : oauth.status === 'pending' ? 'blue' : 'red'
              }
            >
              {oauth.status}
            </Badge>
            {oauth.status === 'pending' ? (
              <>
                <Text>Open the provider authorization page and enter this device code:</Text>
                <Code block>{oauth.userCode}</Code>
                <Button
                  component="a"
                  href={oauth.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  disabled={!oauth.verificationUrl}
                >
                  Open authorization page
                </Button>
                <Text size="sm" c="dimmed">
                  Hermes is polling for approval. This authorization expires at{' '}
                  {oauth.expiresAt
                    ? new Date(oauth.expiresAt).toLocaleTimeString()
                    : 'the provider deadline'}
                  .
                </Text>
              </>
            ) : null}
            {oauth.status === 'approved' ? (
              <Alert color="teal">Authorization completed and stored by Hermes.</Alert>
            ) : null}
            {oauth.status === 'expired' ? (
              <Alert color="yellow">
                The device code expired. Close this dialog and reconnect to get a new code.
              </Alert>
            ) : null}
            {oauth.error ? <Alert color="red">{oauth.error}</Alert> : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOauth(null)}>
                {oauth.status === 'pending' ? 'Hide' : 'Close'}
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
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
                            values: Object.fromEntries(
                              (
                                providers?.items.find((item) => item.id === providerId)
                                  ?.setupFields ?? []
                              ).map((field) => [
                                field.id,
                                field.type === 'choice' ? (field.choices?.[0]?.value ?? '') : '',
                              ]),
                            ),
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
                  Dedicated setup-capable providers advertised by this Hermes framework are
                  selectable. Endpoint reachability, loaded models, and composite dependencies are
                  validated before persistence. OAuth remains owned by Hermes.
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
                {(setupProvider?.setupFields ?? []).map((field) => {
                  const common = {
                    label:
                      field.id === 'credential' && (setupProvider?.setupFields?.length ?? 0) === 1
                        ? `API credential for ${setupProvider?.displayName ?? setup.providerId}`
                        : `${field.label}${field.required ? '' : ' (optional)'}`,
                    value: setup.values[field.id] ?? '',
                    disabled: Boolean(busy),
                    onChange: (value: string) =>
                      setSetup((current) =>
                        current
                          ? {
                              ...current,
                              values: { ...current.values, [field.id]: value },
                              acknowledged: false,
                              revision: current.revision + 1,
                              reviewedRevision: -1,
                              preflight: undefined,
                              dryRunKey: crypto.randomUUID(),
                              executeKey: crypto.randomUUID(),
                            }
                          : current,
                      ),
                  };
                  return field.type === 'choice' ? (
                    <Select
                      key={field.id}
                      label={common.label}
                      data={field.choices ?? []}
                      value={common.value || null}
                      disabled={common.disabled}
                      onChange={(value) => common.onChange(value ?? '')}
                    />
                  ) : field.secret ? (
                    <PasswordInput
                      key={field.id}
                      label={common.label}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      value={common.value}
                      disabled={common.disabled}
                      autoComplete="new-password"
                      onChange={(event) => common.onChange(event.currentTarget.value)}
                    />
                  ) : (
                    <TextInput
                      key={field.id}
                      label={common.label}
                      placeholder={field.type === 'url' ? 'https://provider.example/v1' : ''}
                      value={common.value}
                      disabled={common.disabled}
                      onChange={(event) => common.onChange(event.currentTarget.value)}
                    />
                  );
                })}
                <Group justify="space-between">
                  <Button
                    variant="default"
                    disabled={Boolean(busy)}
                    onClick={() => setSetupStep(0)}
                  >
                    Back
                  </Button>
                  <Button
                    disabled={!setupRequired || Boolean(busy)}
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
                  Secret fields are entered and hidden. Endpoint routes, model IDs, and preset names
                  are persisted only after governed readiness validation. Secret values never appear
                  in operation evidence or inventory responses.
                </Text>
                <Checkbox
                  checked={setup.acknowledged}
                  disabled={Boolean(busy)}
                  label="I authorize Hermes to validate and persist this provider setup."
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
                      disabled={!setup.acknowledged || !setupRequired || Boolean(busy)}
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
  return Number.isNaN(date.valueOf()) ? value : formatUserDate(date);
}
