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
  choices?: Array<{ value: string; label: string }>,
): SetupField => ({
  id,
  label,
  type,
  required,
  secret: type === 'secret' || type === 'secret_file',
  ...(choices ? { choices } : {}),
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
const credentialChoice = (...choices: Array<[string, string]>): SetupField =>
  field(
    'credentialType',
    'Credential type',
    'choice',
    true,
    choices.map(([value, label]) => ({ value, label })),
  );
const oauth = (authMethod: 'oauth_device_code' | 'oauth_browser'): ProviderDefinition => ({
  authMethod,
  setupSupported: true,
  prerequisites: [
    prerequisite('interactive-authorization', 'Interactive account authorization', 'account'),
  ],
});

export const STANDARD_API_KEY_PROVIDER_IDS = [
  'fireworks',
  'openrouter',
  'novita',
  'alibaba',
  'xiaomi',
  'nvidia',
  'huggingface',
  'deepseek',
  'xai',
  'kimi-coding-cn',
  'stepfun',
  'minimax',
  'minimax-cn',
  'ollama-cloud',
  'arcee',
  'gmi',
  'kilocode',
  'opencode-zen',
  'opencode-go',
  'ai-gateway',
  'deepinfra',
  'upstage',
] as const;

export const ADVANCED_KEY_ENDPOINT_PROVIDER_IDS = [
  'anthropic',
  'gemini',
  'vertex',
  'zai',
  'kimi-coding',
  'alibaba',
  'bedrock',
  'alibaba-coding-plan',
  'azure-foundry',
] as const;

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
    setupSupported: true,
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
  anthropic: {
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [
      credentialChoice(
        ['api_key', 'Anthropic API key'],
        ['token', 'Anthropic token'],
        ['claude_oauth', 'Claude Code OAuth token'],
      ),
      secret('Credential'),
      field('baseUrl', 'Anthropic base URL override', 'url', false),
    ],
  },
  'openai-codex': oauth('oauth_device_code'),
  'openai-api': { authMethod: 'api_key', setupFields: [secret('OpenAI API key')] },
  alibaba: {
    ...singleKey('DashScope API key'),
    setupFields: [
      secret('DashScope API key'),
      field('baseUrl', 'DashScope base URL override', 'url', false),
    ],
  },
  'xai-oauth': oauth('oauth_device_code'),

  xiaomi: singleKey(),
  'tencent-tokenhub': { authMethod: 'api_key', setupFields: [secret('Tencent TokenHub key')] },
  nvidia: singleKey(),
  copilot: {
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [secret('GitHub token with Copilot access')],
    prerequisites: [
      prerequisite(
        'copilot-entitlement',
        'GitHub account with an active Copilot entitlement',
        'account',
      ),
    ],
  },
  'copilot-acp': {
    authMethod: 'external_cli',
    setupSupported: false,
    setupFields: [],
    prerequisites: [
      prerequisite(
        'copilot-cli',
        'GitHub Copilot CLI available in the Hermes runtime',
        'executable',
      ),
      prerequisite(
        'copilot-login',
        'Copilot CLI authenticated to an entitled GitHub account',
        'account',
      ),
    ],
  },
  huggingface: singleKey('Hugging Face token'),
  gemini: {
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [
      credentialChoice(['google', 'Google API key'], ['gemini', 'Gemini API key']),
      secret('Credential'),
      field('baseUrl', 'Gemini base URL override', 'url', false),
    ],
  },
  vertex: {
    authMethod: 'cloud_identity',
    setupSupported: true,
    setupFields: [
      credentialChoice(
        ['adc', 'Application Default Credentials'],
        ['service_account', 'Service-account JSON path'],
      ),
      field('project', 'Google Cloud project', 'project', false),
      field('region', 'Google Cloud location', 'region', true, [
        { value: 'global', label: 'Global' },
        { value: 'us-central1', label: 'US Central 1' },
        { value: 'europe-west1', label: 'Europe West 1' },
        { value: 'asia-northeast1', label: 'Asia Northeast 1' },
      ]),
      field('credentials', 'Service-account JSON path', 'secret_file', false),
    ],
    prerequisites: [
      prerequisite(
        'google-adc',
        'Google Application Default Credentials, workload identity, or a runtime-mounted service-account file',
        'cloud_identity',
      ),
      prerequisite('google-project', 'Vertex-enabled Google Cloud project', 'provider'),
    ],
  },
  deepseek: singleKey(),
  xai: singleKey(),
  zai: {
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [
      credentialChoice(['glm', 'GLM API key'], ['zai', 'Z.AI API key'], ['z_ai', 'Z_AI API key']),
      secret('Credential'),
      field('baseUrl', 'Z.AI base URL override', 'url', false),
    ],
  },
  'kimi-coding': {
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [
      credentialChoice(
        ['moonshot', 'Kimi / Moonshot API key'],
        ['coding', 'Kimi Coding Plan API key'],
      ),
      secret('Credential'),
      field('baseUrl', 'Kimi base URL override', 'url', false),
    ],
  },
  'kimi-coding-cn': singleKey(),
  stepfun: singleKey(),
  minimax: singleKey(),
  'minimax-oauth': oauth('oauth_device_code'),
  'minimax-cn': singleKey(),
  'ollama-cloud': singleKey(),
  arcee: singleKey(),
  gmi: {
    ...singleKey(),
    setupFields: [secret(), field('baseUrl', 'Base URL override', 'url', false)],
    setupSupported: true,
  },
  kilocode: singleKey(),
  'opencode-zen': singleKey(),
  'opencode-go': singleKey(),
  bedrock: {
    authMethod: 'cloud_identity',
    setupSupported: true,
    setupFields: [
      credentialChoice(['sdk', 'AWS SDK identity / profile'], ['bearer', 'Bedrock API key']),
      field('region', 'AWS region', 'region', true, [
        { value: 'us-east-1', label: 'US East (N. Virginia)' },
        { value: 'us-west-2', label: 'US West (Oregon)' },
        { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
        { value: 'eu-west-1', label: 'Europe (Ireland)' },
        { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
      ]),
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
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [
      field('baseUrl', 'Azure Foundry endpoint', 'url'),
      secret('Azure Foundry API key'),
    ],
    prerequisites: [prerequisite('azure-endpoint', 'Azure Foundry deployment endpoint', 'network')],
  },

  'ai-gateway': singleKey(),
  'qwen-oauth': oauth('oauth_device_code'),
  'alibaba-coding-plan': {
    authMethod: 'api_key',
    setupSupported: true,
    setupFields: [
      secret('Alibaba Coding Plan API key'),
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
    setupSupported: true,
  },
  upstage: {
    ...singleKey(),
    setupFields: [secret(), field('baseUrl', 'Base URL override', 'url', false)],
    setupSupported: true,
  },
};

export function truthfulProviderContract(input: {
  id: string;
  authenticated: boolean;
  selected: boolean;
  modelCount: number;
  prerequisiteStatuses?: Record<string, 'satisfied' | 'missing' | 'unknown'>;
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
  const prerequisites = (definition?.prerequisites ?? []).map((item) => {
    const rawStatus = input.prerequisiteStatuses?.[item.id];
    return {
      ...item,
      status:
        rawStatus === 'satisfied' || rawStatus === 'missing' || rawStatus === 'unknown'
          ? rawStatus
          : input.authenticated
            ? ('satisfied' as const)
            : ('unknown' as const),
    };
  });
  const reasons: string[] = [];
  const hasMissingPrerequisite = prerequisites.some((item) => item.status === 'missing');
  let deploymentReadiness: HermesProvider['deploymentReadiness'];
  if (authMethod === 'unknown') {
    deploymentReadiness = 'unsupported';
    reasons.push('SETUP_CONTRACT_UNKNOWN');
  } else if (hasMissingPrerequisite) {
    deploymentReadiness = 'needs_configuration';
    reasons.push('PROVIDER_PREREQUISITE_MISSING');
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
