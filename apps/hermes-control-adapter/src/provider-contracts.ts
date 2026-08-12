import type { HermesProvider } from '@aquiero/contracts';

type AuthMethod = HermesProvider['authMethod'];
type SetupField = NonNullable<HermesProvider['setupFields']>[number];
type Prerequisite = NonNullable<HermesProvider['prerequisites']>[number];

type ProviderDefinition = {
  authMethod: AuthMethod;
  setupFields?: SetupField[];
  prerequisites?: Array<Omit<Prerequisite, 'status'>>;
  setupSupported?: boolean;
};

const secret = (label = 'API key'): SetupField => ({
  id: 'credential',
  label,
  type: 'secret',
  required: true,
  secret: true,
});
const field = (
  id: string,
  label: string,
  type: SetupField['type'],
  required = true,
): SetupField => ({
  id,
  label,
  type,
  required,
  secret: type === 'secret' || type === 'secret_file',
});
const prerequisite = (
  id: string,
  label: string,
  kind: Prerequisite['kind'],
): Omit<Prerequisite, 'status'> => ({ id, label, kind });

const singleKey = (label = 'API key'): ProviderDefinition => ({
  authMethod: 'api_key',
  setupFields: [secret(label)],
  setupSupported: true,
});
const alternativeKeys = (...labels: string[]): ProviderDefinition => ({
  authMethod: 'api_key',
  setupFields: [field('credentialType', 'Credential type', 'choice'), secret(labels.join(' / '))],
});
const oauth = (authMethod: 'oauth_device_code' | 'oauth_browser'): ProviderDefinition => ({
  authMethod,
  prerequisites: [
    prerequisite('interactive-authorization', 'Interactive account authorization', 'account'),
  ],
});

// Pinned Hermes 0.20.0 provider catalogue. This contains only non-secret setup metadata.
// It intentionally fails closed: a provider is mutable only when its complete current
// setup is the supported one-secret operation.
const DEFINITIONS: Record<string, ProviderDefinition> = {
  nous: oauth('oauth_device_code'),
  fireworks: singleKey(),
  openrouter: singleKey(),
  moa: {
    authMethod: 'composite',
    setupFields: [field('preset', 'MOA preset', 'choice')],
    prerequisites: [
      prerequisite('reference-models', 'Configured reference and aggregator models', 'provider'),
    ],
  },
  novita: {
    ...singleKey(),
    setupFields: [secret(), field('baseUrl', 'Base URL override', 'url', false)],
    setupSupported: false,
  },
  lmstudio: {
    authMethod: 'endpoint',
    setupFields: [field('baseUrl', 'LM Studio server URL', 'url'), secret('Optional API key')],
    prerequisites: [
      prerequisite(
        'reachable-server',
        'LM Studio model server reachable from this runtime',
        'network',
      ),
    ],
  },
  anthropic: alternativeKeys('Anthropic API key', 'Anthropic token', 'Claude Code OAuth token'),
  'openai-codex': oauth('oauth_browser'),
  'openai-api': { authMethod: 'api_key', setupFields: [secret('OpenAI API key')] },
  alibaba: singleKey('DashScope API key'),
  'xai-oauth': oauth('oauth_browser'),
  xiaomi: singleKey(),
  'tencent-tokenhub': { authMethod: 'api_key', setupFields: [secret('Tencent TokenHub key')] },
  nvidia: singleKey(),
  copilot: {
    authMethod: 'oauth_device_code',
    setupFields: [field('method', 'Copilot authentication method', 'choice')],
    prerequisites: [prerequisite('copilot-entitlement', 'GitHub Copilot entitlement', 'account')],
  },
  'copilot-acp': {
    authMethod: 'external_cli',
    prerequisites: [
      prerequisite('copilot-cli', 'Supported Copilot CLI installed', 'executable'),
      prerequisite('copilot-login', 'Copilot CLI authenticated', 'account'),
    ],
  },
  huggingface: singleKey('Hugging Face token'),
  gemini: alternativeKeys('Google API key', 'Gemini API key'),
  vertex: {
    authMethod: 'cloud_identity',
    setupFields: [
      field('project', 'Google Cloud project', 'project'),
      field('location', 'Google Cloud location', 'region'),
      field('credentials', 'Service-account credentials', 'secret_file', false),
    ],
    prerequisites: [
      prerequisite(
        'google-adc',
        'Google Application Default Credentials or workload identity',
        'cloud_identity',
      ),
    ],
  },
  deepseek: singleKey(),
  xai: singleKey(),
  zai: alternativeKeys('GLM API key', 'Z.AI API key'),
  'kimi-coding': alternativeKeys('Kimi API key', 'Kimi Coding Plan API key'),
  'kimi-coding-cn': singleKey(),
  stepfun: singleKey(),
  minimax: singleKey(),
  'minimax-oauth': oauth('oauth_browser'),
  'minimax-cn': singleKey(),
  'ollama-cloud': singleKey(),
  arcee: singleKey(),
  gmi: {
    ...singleKey(),
    setupFields: [secret(), field('baseUrl', 'Base URL override', 'url', false)],
    setupSupported: false,
  },
  kilocode: singleKey(),
  'opencode-zen': singleKey(),
  'opencode-go': singleKey(),
  bedrock: {
    authMethod: 'cloud_identity',
    setupFields: [
      field('authMethod', 'AWS authentication method', 'choice'),
      field('region', 'AWS region', 'region'),
      field('profile', 'AWS profile', 'text', false),
      field('credential', 'Bedrock API key', 'secret', false),
    ],
    prerequisites: [
      prerequisite(
        'aws-identity',
        'AWS IAM identity, profile, workload identity, or Bedrock API key',
        'cloud_identity',
      ),
    ],
  },
  'azure-foundry': {
    authMethod: 'cloud_identity',
    setupFields: [
      field('baseUrl', 'Azure Foundry endpoint', 'url'),
      field('authMethod', 'Azure authentication method', 'choice'),
      field('credential', 'Azure Foundry API key', 'secret', false),
    ],
    prerequisites: [
      prerequisite('azure-identity', 'API key or Microsoft Entra identity', 'cloud_identity'),
    ],
  },
  'ai-gateway': singleKey(),
  'qwen-oauth': oauth('oauth_browser'),
  'alibaba-coding-plan': {
    authMethod: 'api_key',
    setupFields: [
      field('credentialType', 'Credential type', 'choice'),
      secret('Coding Plan or DashScope API key'),
      field('baseUrl', 'Coding Plan base URL', 'url', false),
    ],
  },
  custom: {
    authMethod: 'endpoint',
    setupFields: [
      field('baseUrl', 'Provider base URL', 'url'),
      field('apiMode', 'API compatibility mode', 'choice'),
      field('credential', 'API key', 'secret', false),
      field('model', 'Model ID', 'text', false),
    ],
    prerequisites: [
      prerequisite('reachable-endpoint', 'Endpoint reachable from this runtime', 'network'),
    ],
  },
  deepinfra: {
    ...singleKey(),
    setupFields: [secret(), field('baseUrl', 'Base URL override', 'url', false)],
    setupSupported: false,
  },
  upstage: {
    ...singleKey(),
    setupFields: [secret(), field('baseUrl', 'Base URL override', 'url', false)],
    setupSupported: false,
  },
};

export function truthfulProviderContract(input: {
  id: string;
  authenticated: boolean;
  selected: boolean;
  modelCount: number;
}): Pick<
  HermesProvider,
  | 'authType'
  | 'authMethod'
  | 'credentialMutable'
  | 'setupSupported'
  | 'setupFields'
  | 'prerequisites'
  | 'connectionState'
  | 'deploymentReadiness'
  | 'readinessReasonCodes'
> {
  const definition = DEFINITIONS[input.id];
  const authMethod = definition?.authMethod ?? 'unknown';
  const connectionState =
    authMethod === 'none'
      ? 'not_required'
      : input.authenticated
        ? 'connected'
        : authMethod === 'unknown'
          ? 'unknown'
          : 'disconnected';
  const prerequisites = (definition?.prerequisites ?? []).map((item) => ({
    ...item,
    status: input.authenticated ? ('satisfied' as const) : ('unknown' as const),
  }));
  const reasons: string[] = [];
  let deploymentReadiness: HermesProvider['deploymentReadiness'];
  if (authMethod === 'unknown') {
    deploymentReadiness = 'unsupported';
    reasons.push('SETUP_CONTRACT_UNKNOWN');
  } else if (!input.authenticated && authMethod !== 'none') {
    deploymentReadiness = 'needs_configuration';
    reasons.push('PROVIDER_NOT_CONNECTED');
  } else if (input.modelCount === 0) {
    deploymentReadiness = 'needs_model';
    reasons.push('NO_MODELS_DISCOVERED');
  } else if (!input.selected) {
    deploymentReadiness = 'needs_selection';
    reasons.push('NO_DEFAULT_MODEL_SELECTED');
  } else {
    deploymentReadiness = 'ready';
  }
  return {
    authType:
      authMethod === 'api_key'
        ? 'api_key'
        : authMethod === 'oauth_browser' || authMethod === 'oauth_device_code'
          ? 'oauth'
          : authMethod === 'none'
            ? 'none'
            : 'unknown',
    authMethod,
    credentialMutable: definition?.setupSupported === true,
    setupSupported: definition?.setupSupported === true,
    setupFields: definition?.setupFields ?? [],
    prerequisites,
    connectionState,
    deploymentReadiness,
    readinessReasonCodes: reasons,
  };
}
