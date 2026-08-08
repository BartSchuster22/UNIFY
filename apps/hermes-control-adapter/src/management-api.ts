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

  async setCredential(providerId: string, credential: string) {
    const key = await this.providerCredentialKey(providerId);
    const result = record(await this.request('/api/env', 'PUT', { key, value: credential }));
    return {
      configured: true,
      changed: result.changed !== false,
      providerId,
    };
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
