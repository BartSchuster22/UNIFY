type JsonRecord = Record<string, unknown>;

export type HermesManagementInventory = {
  providers: JsonRecord[];
  provider: string;
  model: string;
};

export type ProviderSetupValues = Record<string, string>;

const ADVANCED_PROVIDER_ENV: Record<
  string,
  {
    credentials: Record<string, string>;
    defaultCredential: string;
    fields: Record<string, string>;
    configFields?: Record<string, string>;
  }
> = {
  anthropic: {
    credentials: {
      api_key: 'ANTHROPIC_API_KEY',
      token: 'ANTHROPIC_TOKEN',
      claude_oauth: 'CLAUDE_CODE_OAUTH_TOKEN',
    },
    defaultCredential: 'api_key',
    fields: { baseUrl: 'ANTHROPIC_BASE_URL' },
  },
  gemini: {
    credentials: { google: 'GOOGLE_API_KEY', gemini: 'GEMINI_API_KEY' },
    defaultCredential: 'google',
    fields: { baseUrl: 'GEMINI_BASE_URL' },
  },
  zai: {
    credentials: { glm: 'GLM_API_KEY', zai: 'ZAI_API_KEY', z_ai: 'Z_AI_API_KEY' },
    defaultCredential: 'glm',
    fields: { baseUrl: 'GLM_BASE_URL' },
  },
  'kimi-coding': {
    credentials: { moonshot: 'KIMI_API_KEY', coding: 'KIMI_CODING_API_KEY' },
    defaultCredential: 'moonshot',
    fields: { baseUrl: 'KIMI_BASE_URL' },
  },
  alibaba: {
    credentials: { default: 'DASHSCOPE_API_KEY' },
    defaultCredential: 'default',
    fields: { baseUrl: 'DASHSCOPE_BASE_URL' },
  },
  'alibaba-coding-plan': {
    credentials: { default: 'ALIBABA_CODING_PLAN_API_KEY' },
    defaultCredential: 'default',
    fields: { baseUrl: 'ALIBABA_CODING_PLAN_BASE_URL' },
  },
  'azure-foundry': {
    credentials: { default: 'AZURE_FOUNDRY_API_KEY' },
    defaultCredential: 'default',
    fields: { baseUrl: 'AZURE_FOUNDRY_BASE_URL' },
  },
  bedrock: {
    credentials: { bearer: 'AWS_BEARER_TOKEN_BEDROCK' },
    defaultCredential: 'sdk',
    fields: { region: 'AWS_REGION', profile: 'AWS_PROFILE' },
  },
  vertex: {
    credentials: {},
    defaultCredential: 'adc',
    fields: { credentials: 'VERTEX_CREDENTIALS_PATH' },
    configFields: { project: 'project_id', region: 'region' },
  },
};

export class HermesManagementApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sessionToken?: string,
  ) {
    this.baseUrl = validateManagementBaseUrl(baseUrl);
  }

  async inventory(refresh = false): Promise<HermesManagementInventory> {
    const query = new URLSearchParams({ include_unconfigured: 'true' });
    if (refresh) query.set('refresh', 'true');
    const value = record(await this.request(`/api/model/options?${query.toString()}`));
    return {
      providers: Array.isArray(value.providers)
        ? value.providers.filter(
            (item): item is JsonRecord =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [],
      provider: string(value.provider),
      model: string(value.model),
    };
  }

  async selectModel(provider: string, model: string, confirmExpensiveModel = false) {
    return record(
      await this.request('/api/model/set', 'POST', {
        scope: 'main',
        provider,
        model,
        confirm_expensive_model: confirmExpensiveModel,
      }),
    );
  }

  async validateCredential(providerId: string, credential: string) {
    const key = await this.providerCredentialKey(providerId);
    const result = record(
      await this.request('/api/providers/validate', 'POST', { key, value: credential }),
    );
    const accepted = result.ok === true;
    const reachable = result.reachable === true;
    return {
      providerId,
      accepted,
      reachable,
      verified: accepted && reachable,
      ...(typeof result.message === 'string' && result.message
        ? { message: result.message.slice(0, 500) }
        : {}),
    };
  }

  async setCredential(providerId: string, credential: string) {
    const validation = await this.validateCredential(providerId, credential);
    if (!validation.verified)
      throw new HermesManagementError(
        validation.reachable ? 422 : 503,
        validation.message ??
          (validation.reachable
            ? 'Hermes rejected the provider credential'
            : 'Hermes could not reach the provider; credential was not persisted'),
      );
    const key = await this.providerCredentialKey(providerId);
    const result = record(
      await this.request('/api/env/batch', 'PUT', { entries: [{ key, value: credential }] }),
    );
    return {
      configured: true,
      changed: result.changed !== false,
      providerId,
      validation: {
        accepted: validation.accepted,
        reachable: validation.reachable,
        verified: validation.verified,
      },
    };
  }

  async setProviderSetup(providerId: string, values: ProviderSetupValues) {
    const definition = ADVANCED_PROVIDER_ENV[providerId];
    if (!definition)
      return this.setCredential(providerId, requiredSetupValue(values, 'credential'));
    const variables = record(await this.request('/api/env'));
    const credentialType = values.credentialType || definition.defaultCredential;
    if (
      credentialType === 'sdk' ||
      credentialType === 'adc' ||
      credentialType === 'service_account'
    ) {
      if (values.credential?.trim())
        throw new HermesManagementError(
          422,
          'This cloud-identity method does not accept a stored credential',
        );
      if (credentialType === 'service_account') requiredSetupValue(values, 'credentials');
      return this.setCloudIdentitySetup(providerId, values, variables, definition);
    }
    const credentialKey = definition.credentials[credentialType];
    if (!credentialKey || !advertisedVariable(variables, credentialKey, providerId, true))
      throw new HermesManagementError(
        422,
        'Credential type is not advertised by this Hermes provider',
      );
    const credential = requiredSetupValue(values, 'credential');
    const validation = await this.validateCredentialKey(
      providerId,
      credentialKey,
      credential,
      values.baseUrl?.trim(),
    );
    if (!validation.verified)
      throw new HermesManagementError(
        validation.reachable ? 422 : 503,
        validation.message ?? 'Hermes could not verify the provider credential',
      );
    const endpointEntries: Array<{ key: string; value: string }> = [];
    for (const [fieldId, envKey] of Object.entries(definition.fields)) {
      const value = values[fieldId]?.trim();
      if (!value) continue;
      validateProviderUrl(value);
      if (!advertisedVariable(variables, envKey, providerId, false))
        throw new HermesManagementError(422, 'Provider endpoint field is not advertised by Hermes');
      endpointEntries.push({ key: envKey, value });
    }
    const entries = [...endpointEntries, { key: credentialKey, value: credential }];
    await this.request('/api/env/batch', 'PUT', { entries });
    return {
      providerId,
      configured: true,
      changed: true,
      credentialType,
      configuredFields: Object.keys(definition.fields).filter((id) => Boolean(values[id]?.trim())),
      validation: { accepted: true, reachable: true, verified: true },
    };
  }

  async refreshProviderModels(providerId: string) {
    const inventory = await this.inventory(true);
    const provider = inventory.providers.find((item) => string(item.slug) === providerId);
    if (!provider) throw new HermesManagementError(404, 'Provider is not in Hermes inventory');
    const models = Array.isArray(provider.models)
      ? provider.models.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : [];
    return { providerId, discovered: models.length, models };
  }

  async verifyPersistence(providerId: string) {
    const definition = ADVANCED_PROVIDER_ENV[providerId];
    if (definition) {
      const env = record(await this.request('/api/env', 'GET'));
      const credentialConfigured = Object.values(definition.credentials).some(
        (key) => record(env[key]).is_set === true,
      );
      return {
        providerId,
        configured: credentialConfigured,
        persisted: credentialConfigured,
        fields: Object.fromEntries(
          Object.entries(definition.fields).map(([id, key]) => [
            id,
            record(env[key]).is_set === true,
          ]),
        ),
      };
    }
    const key = await this.providerCredentialKey(providerId);
    const env = record(await this.request('/api/env', 'GET'));
    const status = record(env[key]);
    return { providerId, configured: status.is_set === true, persisted: status.is_set === true };
  }

  async removeCredential(providerId: string) {
    const definition = ADVANCED_PROVIDER_ENV[providerId];
    if (definition) {
      const keys = [...Object.values(definition.credentials), ...Object.values(definition.fields)];
      let changed = false;
      for (const key of keys) changed = (await this.safeRemoveEnv(key)) || changed;
      return { configured: false, changed, providerId };
    }
    const key = await this.providerCredentialKey(providerId);
    try {
      await this.request('/api/env', 'DELETE', { key });
      return { configured: false, changed: true, providerId };
    } catch (error) {
      if (error instanceof HermesManagementError && error.statusCode === 404)
        return { configured: false, changed: false, providerId };
      throw error;
    }
  }

  private async setCloudIdentitySetup(
    providerId: string,
    values: ProviderSetupValues,
    variables: JsonRecord,
    definition: (typeof ADVANCED_PROVIDER_ENV)[string],
  ) {
    const envEntries: Array<{ key: string; value: string }> = [];
    for (const [fieldId, envKey] of Object.entries(definition.fields)) {
      const value = values[fieldId]?.trim();
      if (!value) continue;
      validateCloudField(fieldId, value);
      if (!advertisedVariable(variables, envKey, providerId, false))
        throw new HermesManagementError(422, 'Cloud identity field is not advertised by Hermes');
      envEntries.push({ key: envKey, value });
    }
    const config = definition.configFields ? record(await this.request('/api/config', 'GET')) : {};
    const providerConfig = { ...record(config[providerId]) };
    for (const [fieldId, configKey] of Object.entries(definition.configFields ?? {})) {
      const value = values[fieldId]?.trim();
      if (!value) continue;
      validateCloudField(fieldId, value);
      providerConfig[configKey] = value;
    }
    const result = record(
      await this.request('/api/provider-setup/batch', 'PUT', {
        env: envEntries,
        ...(definition.configFields ? { config: { [providerId]: providerConfig } } : {}),
      }),
    );
    return {
      providerId,
      configured: result.configured === true,
      changed: result.changed === true,
      credentialType: values.credentialType || definition.defaultCredential,
      configuredFields: [
        ...Object.keys(definition.fields),
        ...Object.keys(definition.configFields ?? {}),
      ].filter((id) => Boolean(values[id]?.trim())),
      validation: {
        accepted: true,
        reachable: false,
        verified: false,
        message:
          'Cloud identity is stored outside UNIFY and must be verified by model discovery or inference.',
      },
    };
  }

  private async validateCredentialKey(
    providerId: string,
    key: string,
    credential: string,
    baseUrl?: string,
  ) {
    if (baseUrl) validateProviderUrl(baseUrl);
    const result = record(
      await this.request('/api/providers/validate', 'POST', {
        key,
        value: credential,
        ...(baseUrl ? { base_url: baseUrl } : {}),
      }),
    );
    const accepted = result.ok === true;
    const reachable = result.reachable === true;
    return {
      providerId,
      accepted,
      reachable,
      verified: accepted && reachable,
      ...(typeof result.message === 'string' && result.message
        ? { message: result.message.slice(0, 500) }
        : {}),
    };
  }

  private async safeRemoveEnv(key: string) {
    try {
      await this.request('/api/env', 'DELETE', { key });
      return true;
    } catch (error) {
      if (error instanceof HermesManagementError && error.statusCode === 404) return false;
      throw error;
    }
  }

  private async providerCredentialKey(providerId: string) {
    const variables = record(await this.request('/api/env'));
    const matches = Object.entries(variables).filter(([, raw]) => {
      const row = record(raw);
      return (
        string(row.provider).toLowerCase() === providerId.toLowerCase() && row.is_password !== false
      );
    });
    if (matches.length !== 1)
      throw new HermesManagementError(
        422,
        matches.length === 0
          ? 'Provider does not advertise one API-key credential'
          : 'Provider advertises multiple credentials and requires a dedicated setup flow',
      );
    return matches[0]![0];
  }

  private async request(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), method === 'GET' ? 60_000 : 180_000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(this.sessionToken ? { 'x-hermes-session-token': this.sessionToken } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new HermesManagementError(
          response.status,
          `Hermes management API returned HTTP ${response.status}`,
        );
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof HermesManagementError) throw error;
      throw new HermesManagementError(503, 'Hermes management API is unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class HermesManagementError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function validateManagementBaseUrl(value: string) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!loopback || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/')
    throw new Error('HERMES_MANAGEMENT_BASE_URL must be a credential-free loopback HTTP origin');
  return url.origin;
}

function requiredSetupValue(values: ProviderSetupValues, id: string) {
  const value = values[id]?.trim();
  if (!value || value.length > 32_768) throw new HermesManagementError(422, `${id} is required`);
  return value;
}

function advertisedVariable(
  variables: JsonRecord,
  key: string,
  providerId: string,
  secret: boolean,
) {
  const row = record(variables[key]);
  return (
    string(row.provider).toLowerCase() === providerId && (row.is_password !== false) === secret
  );
}

function validateCloudField(id: string, value: string) {
  if (id === 'credentials') {
    if (!value.startsWith('/') || value.includes('\0') || value.includes('..'))
      throw new HermesManagementError(422, 'Credential path must be an absolute runtime path');
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
    throw new HermesManagementError(422, `${id} contains unsupported characters`);
}

function validateProviderUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HermesManagementError(422, 'Provider endpoint must be a valid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new HermesManagementError(422, 'Provider endpoint must be credential-free HTTPS');
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function string(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
