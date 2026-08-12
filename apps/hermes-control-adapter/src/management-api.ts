type JsonRecord = Record<string, unknown>;

export type HermesManagementInventory = {
  providers: JsonRecord[];
  provider: string;
  model: string;
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
    return {
      providerId,
      accepted: result.ok === true,
      reachable: result.reachable === true,
      verified: result.ok === true && result.reachable === true,
      ...(typeof result.message === 'string' && result.message
        ? { message: result.message.slice(0, 500) }
        : {}),
    };
  }

  async setCredential(providerId: string, credential: string) {
    const validation = await this.validateCredential(providerId, credential);
    if (!validation.accepted)
      throw new HermesManagementError(
        422,
        validation.message ?? 'Hermes rejected the provider credential',
      );
    const key = await this.providerCredentialKey(providerId);
    const result = record(await this.request('/api/env', 'PUT', { key, value: credential }));
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
    const key = await this.providerCredentialKey(providerId);
    const env = record(await this.request('/api/env', 'GET'));
    const status = record(env[key]);
    return { providerId, configured: status.is_set === true, persisted: status.is_set === true };
  }

  async removeCredential(providerId: string) {
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

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function string(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
