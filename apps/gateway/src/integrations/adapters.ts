import { createHash } from 'node:crypto';
import { AdapterError, ResilientHttpClient } from '@aquiero/adapter-sdk';
import type { ResourceRef, UnifiedResource } from '@aquiero/contracts';
import type {
  IntegrationKind,
  IntegrationOwner,
  IntegrationSnapshot,
  SourceAdapter,
} from './types.js';

type JsonRecord = Record<string, unknown>;
type Auth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'session'; loginPath: string; body: JsonRecord };

interface Endpoint {
  path: string;
  key: string;
  kind: IntegrationKind;
  owner?: IntegrationOwner;
  expand?: (body: unknown) => JsonRecord[];
}

export interface AdapterDefinition {
  id: string;
  owners: IntegrationOwner[];
  baseUrl?: string | undefined;
  auth: Auth;
  endpoints: Endpoint[];
  fetch?: typeof globalThis.fetch;
}

class SourceClient {
  readonly #http: ResilientHttpClient;
  readonly #auth: Auth;
  #cookie: string | undefined;

  constructor(baseUrl: string, auth: Auth, fetchImpl?: typeof globalThis.fetch) {
    this.#auth = auth;
    const captureFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await (fetchImpl ?? globalThis.fetch)(input, init);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) this.#cookie = setCookie.split(';', 1)[0] ?? undefined;
      return response;
    };
    this.#http = new ResilientHttpClient({
      baseUrl,
      fetch: captureFetch,
      retries: 2,
      timeoutMs: 8_000,
    });
  }

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    await this.login(signal);
    try {
      return await this.#http.request<T>({
        path,
        headers: this.headers(),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof AdapterError && error.status === 401 && this.#auth.type === 'session') {
        this.#cookie = undefined;
        await this.login(signal);
        return this.#http.request<T>({
          path,
          headers: this.headers(),
          ...(signal ? { signal } : {}),
        });
      }
      throw error;
    }
  }

  private async login(signal?: AbortSignal): Promise<void> {
    if (this.#auth.type !== 'session' || this.#cookie) return;
    await this.#http.request({
      method: 'POST',
      path: this.#auth.loginPath,
      body: this.#auth.body,
      ...(signal ? { signal } : {}),
    });
    if (!this.#cookie) throw new Error('Upstream login did not issue a session cookie');
  }

  private headers(): Record<string, string> {
    if (this.#auth.type === 'bearer') return { authorization: `Bearer ${this.#auth.token}` };
    if (this.#auth.type === 'session' && this.#cookie) return { cookie: this.#cookie };
    return {};
  }
}

export class ConfiguredReadAdapter implements SourceAdapter {
  readonly id: string;
  readonly owners: IntegrationOwner[];
  readonly sourceRole = 'migration-only' as const;
  readonly writeEnabled = false as const;
  protected readonly definition: AdapterDefinition;
  protected readonly client: SourceClient | undefined;

  constructor(definition: AdapterDefinition) {
    this.definition = definition;
    this.id = definition.id;
    this.owners = definition.owners;
    this.client = definition.baseUrl
      ? new SourceClient(definition.baseUrl, definition.auth, definition.fetch)
      : undefined;
  }

  async snapshot(signal?: AbortSignal): Promise<IntegrationSnapshot> {
    const observedAt = new Date().toISOString();
    if (!this.client)
      return unavailable(this, observedAt, 'SOURCE_NOT_CONFIGURED', 'Source URL is not configured');
    const resources: UnifiedResource[] = [];
    const warnings: Array<{ code: string; message: string }> = [];
    for (const endpoint of this.definition.endpoints) {
      try {
        const body = await this.client.get(endpoint.path, signal);
        const rows = endpoint.expand ? endpoint.expand(body) : arrayFrom(body, endpoint.key);
        resources.push(
          ...rows.map((row, index) =>
            normalize({
              adapterId: this.id,
              owner: endpoint.owner ?? this.owners[0]!,
              kind: endpoint.kind,
              row,
              index,
              observedAt,
            }),
          ),
        );
      } catch (error) {
        warnings.push({ code: 'UPSTREAM_READ_FAILED', message: safeError(endpoint.path, error) });
      }
    }
    const status = warnings.length
      ? resources.length
        ? 'partial'
        : 'unavailable'
      : resources.length
        ? 'current'
        : 'empty';
    return {
      adapterId: this.id,
      owners: this.owners,
      sourceRole: this.sourceRole,
      writeEnabled: this.writeEnabled,
      status,
      observedAt,
      resources,
      warnings,
    };
  }
}

export class ChatReadAdapter extends ConfiguredReadAdapter {
  override async snapshot(signal?: AbortSignal): Promise<IntegrationSnapshot> {
    const base = await super.snapshot(signal);
    if (!this.client || base.status === 'unavailable') return base;
    const sessions = base.resources
      .filter((item) => item.resource.kind === 'chat-session')
      .slice(0, 50);
    for (const session of sessions) {
      try {
        const body = await this.client.get(
          `/api/chat/sessions/${encodeURIComponent(session.resource.nativeId)}/messages`,
          signal,
        );
        const messages = arrayFrom(body, 'messages');
        base.resources.push(
          ...messages.map((row, index) =>
            normalize({
              adapterId: this.id,
              owner: 'chat',
              kind: 'chat-message',
              row: { ...row, session_id: session.resource.nativeId },
              index,
              observedAt: base.observedAt,
            }),
          ),
        );
        const route = asRecord(session.data.surface ?? session.data.route);
        if (Object.keys(route).length) {
          base.resources.push(
            normalize({
              adapterId: this.id,
              owner: 'chat',
              kind: 'chat-route',
              row: {
                ...route,
                id: session.resource.nativeId,
                session_id: session.resource.nativeId,
              },
              index: 0,
              observedAt: base.observedAt,
            }),
          );
        }
      } catch (error) {
        base.warnings.push({
          code: 'CHAT_MESSAGES_READ_FAILED',
          message: safeError('messages', error),
        });
        base.status = 'partial';
      }
    }
    return base;
  }
}

export class MemoryReadAdapter extends ConfiguredReadAdapter {
  async search(query: string, signal?: AbortSignal): Promise<UnifiedResource[]> {
    if (!this.client) return [];
    const body = await this.client.get(
      `/search?q=${encodeURIComponent(query)}&scope_path=global`,
      signal,
    );
    return arrayFrom(body, 'results').map((item, index) => {
      const record = asRecord(item.record ?? item);
      return normalize({
        adapterId: this.id,
        owner: 'memory-v4',
        kind: 'memory-record',
        row: record,
        index,
        observedAt: new Date().toISOString(),
      });
    });
  }
}

export function createDefaultAdapters(env: NodeJS.ProcessEnv = process.env): SourceAdapter[] {
  const dmmAuth = sessionAuth(env.DMM_USERNAME, env.DMM_PASSWORD, '/api/auth/login');
  const chatAuth: Auth = env.CHAT_PASSWORD
    ? { type: 'session', loginPath: '/auth/login', body: { password: env.CHAT_PASSWORD } }
    : { type: 'none' };
  return [
    new ConfiguredReadAdapter({
      id: 'dmm-read-v1',
      owners: ['dmm'],
      baseUrl: env.DMM_URL,
      auth: dmmAuth,
      endpoints: [
        { path: '/api/providers', key: 'providers', kind: 'provider' },
        { path: '/api/models', key: 'models', kind: 'model' },
        { path: '/api/catalog/snapshots', key: 'snapshots', kind: 'catalog-snapshot' },
      ],
    }),
    new ConfiguredReadAdapter({
      id: 'worker-read-v1',
      owners: ['worker'],
      baseUrl: env.WORKER_URL,
      auth: env.WORKER_TOKEN ? { type: 'bearer', token: env.WORKER_TOKEN } : { type: 'none' },
      endpoints: [
        { path: '/api/projects', key: 'projects', kind: 'project' },
        { path: '/api/kanban/projects', key: 'boards', kind: 'kanban-board' },
        { path: '/api/kanban/tasks', key: 'tasks', kind: 'task' },
        { path: '/api/cron/jobs', key: 'jobs', kind: 'cronjob' },
        { path: '/api/notifications/inbox', key: 'notifications', kind: 'notification' },
      ],
    }),
    new ChatReadAdapter({
      id: 'chat-read-v1',
      owners: ['chat'],
      baseUrl: env.CHAT_URL,
      auth: chatAuth,
      endpoints: [{ path: '/api/chat/sessions', key: 'sessions', kind: 'chat-session' }],
    }),
    new MemoryReadAdapter({
      id: 'memory-v4-read-v1',
      owners: ['memory-v4'],
      baseUrl: env.MEMORY_V4_URL,
      auth: env.MEMORY_V4_TOKEN ? { type: 'bearer', token: env.MEMORY_V4_TOKEN } : { type: 'none' },
      endpoints: [{ path: '/records?scope_path=global', key: 'records', kind: 'memory-record' }],
    }),
  ];
}

function sessionAuth(
  username: string | undefined,
  password: string | undefined,
  loginPath: string,
): Auth {
  return username && password
    ? { type: 'session', loginPath, body: { username, password } }
    : { type: 'none' };
}

function arrayFrom(value: unknown, key: string): JsonRecord[] {
  const record = asRecord(value);
  const candidates = [record[key], asRecord(record.data)[key], asRecord(record.result)[key]];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(asRecord);
  }
  return [];
}

function normalize(input: {
  adapterId: string;
  owner: IntegrationOwner;
  kind: IntegrationKind;
  row: JsonRecord;
  index: number;
  observedAt: string;
}): UnifiedResource {
  const data = redact(input.row);
  const nativeId =
    text(
      data.id ??
        data.nativeId ??
        data.native_id ??
        data.slug ??
        data.key ??
        data.name ??
        data.username,
    ) || `${input.kind}-${input.index}`;
  const frameworkId = text(data.frameworkId ?? data.framework_id ?? data.harness);
  const title =
    text(
      data.displayName ??
        data.display_name ??
        data.label ??
        data.title ??
        data.name ??
        data.username,
    ) || nativeId;
  const sourceVersion = text(data.version ?? data.updatedAt ?? data.updated_at ?? data.revision);
  const canonicalId = `${input.owner}:${input.kind}:${Buffer.from(nativeId).toString('base64url')}`;
  const resource: ResourceRef = {
    canonicalId,
    kind: input.kind,
    owner: input.owner,
    nativeId,
    displayLabel: title,
    observedAt: input.observedAt,
    ...(frameworkId ? { frameworkId } : {}),
    ...(sourceVersion ? { sourceVersion } : {}),
  };
  return {
    resource,
    truth: 'current',
    authoritative: false,
    sourceRole: 'migration-only',
    adapterId: input.adapterId,
    fetchedAt: input.observedAt,
    title,
    searchableText: JSON.stringify(data).slice(0, 10_000),
    data,
  };
}

function redact(value: JsonRecord): JsonRecord {
  const out: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|secret|token|credential|authorization|cookie|api[_-]?key/i.test(key)) {
      out[key] = '[REDACTED]';
    } else if (Array.isArray(item)) {
      out[key] = item.map((entry) => (isRecord(entry) ? redact(entry) : entry));
    } else if (isRecord(item)) {
      out[key] = redact(item);
    } else {
      out[key] = item;
    }
  }
  return out;
}

function unavailable(
  adapter: SourceAdapter,
  observedAt: string,
  code: string,
  message: string,
): IntegrationSnapshot {
  return {
    adapterId: adapter.id,
    owners: adapter.owners,
    sourceRole: adapter.sourceRole,
    writeEnabled: adapter.writeEnabled,
    status: 'unavailable',
    observedAt,
    resources: [],
    warnings: [{ code, message }],
  };
}

function safeError(path: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'upstream read failed';
  return `${path}: ${message}`
    .replace(/(bearer\s+|token[=: ]+)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}
function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}
function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function resourceHash(resource: UnifiedResource): string {
  const ref = {
    canonicalId: resource.resource.canonicalId,
    kind: resource.resource.kind,
    owner: resource.resource.owner,
    nativeId: resource.resource.nativeId,
    displayLabel: resource.resource.displayLabel,
    frameworkId: resource.resource.frameworkId,
    sourceVersion: resource.resource.sourceVersion,
    links: resource.resource.links,
  };
  return createHash('sha256')
    .update(stableJson({ resource: ref, data: resource.data }))
    .digest('hex');
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
