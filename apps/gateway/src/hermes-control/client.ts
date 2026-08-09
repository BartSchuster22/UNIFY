import { setTimeout as delay } from 'node:timers/promises';
import { Value } from '@sinclair/typebox/value';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  HermesBoardsResponseSchema,
  HermesCapabilitiesResponseSchema,
  HermesConversationResultSchema,
  HermesCronjobsResponseSchema,
  HermesControlErrorResponseSchema,
  HermesEventsResponseSchema,
  HermesHealthResponseSchema,
  HermesMessagesResponseSchema,
  HermesModelsResponseSchema,
  HermesModelManagementResultSchema,
  HermesProfileResultSchema,
  HermesProfilesResponseSchema,
  HermesProjectsResponseSchema,
  HermesProvidersResponseSchema,
  HermesReconcileResultSchema,
  HermesSessionsResponseSchema,
  HermesTasksResponseSchema,
  HermesWorkResultSchema,
  type HermesControlCommand,
  type HermesConversationCommand,
  type HermesBoard,
  type HermesCronjob,
  type HermesEventEnvelope,
  type HermesMessage,
  type HermesModel,
  type HermesModelManagementCommand,
  type HermesProfileCommand,
  type HermesProfile,
  type HermesProject,
  type HermesProvider,
  type HermesSession,
  type HermesTask,
  type HermesWorkCommand,
} from '@aquiero/contracts';

type CollectionResponse<T> = {
  contractVersion: 'hermes-control/v1';
  frameworkId: string;
  frameworkVersion: string;
  frameworkCommit: string;
  sourceVersion: string;
  observedAt: string;
  data: { items: T[]; page: { hasMore: boolean; nextCursor?: string } };
};
export type HermesProfilesResponse = CollectionResponse<HermesProfile>;
export type HermesProvidersResponse = CollectionResponse<HermesProvider>;
export type HermesModelsResponse = CollectionResponse<HermesModel>;
export type HermesProjectsResponse = CollectionResponse<HermesProject>;
export type HermesBoardsResponse = CollectionResponse<HermesBoard>;
export type HermesTasksResponse = CollectionResponse<HermesTask>;
export type HermesCronjobsResponse = CollectionResponse<HermesCronjob>;
export type HermesSessionsResponse = CollectionResponse<HermesSession>;
export type HermesMessagesResponse = CollectionResponse<HermesMessage>;
export type HermesEventsResponse = CollectionResponse<HermesEventEnvelope>;
export type HermesCapabilitiesResponse = Static<typeof HermesCapabilitiesResponseSchema>;
export type HermesHealthResponse = Static<typeof HermesHealthResponseSchema>;
export type HermesReconcileResponse = Static<typeof HermesReconcileResultSchema>;

export class HermesControlClientError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface HermesControlClientOptions {
  baseUrl: string;
  bearerToken: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class HermesControlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly retries: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitResetMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private failures = 0;
  private circuitOpenedAt = 0;

  constructor(private readonly options: HermesControlClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    this.retries = options.retries ?? 1;
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? 3;
    this.circuitResetMs = options.circuitResetMs ?? 30_000;
    this.sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  }

  health(): Promise<HermesHealthResponse> {
    return this.request('GET', '/control/v1/health', HermesHealthResponseSchema);
  }

  capabilities(): Promise<HermesCapabilitiesResponse> {
    return this.request('GET', '/control/v1/capabilities', HermesCapabilitiesResponseSchema);
  }

  profiles(query: PageQuery = {}): Promise<HermesProfilesResponse> {
    return this.request(
      'GET',
      pagePath('/control/v1/profiles', query),
      HermesProfilesResponseSchema,
    );
  }

  providers(query: PageQuery = {}): Promise<HermesProvidersResponse> {
    return this.request(
      'GET',
      pagePath('/control/v1/providers', query),
      HermesProvidersResponseSchema,
    );
  }

  models(query: PageQuery = {}): Promise<HermesModelsResponse> {
    return this.request('GET', pagePath('/control/v1/models', query), HermesModelsResponseSchema);
  }

  projects(query: PageQuery = {}): Promise<HermesProjectsResponse> {
    return this.request(
      'GET',
      pagePath('/control/v1/work/projects', query),
      HermesProjectsResponseSchema,
    );
  }

  boards(query: PageQuery = {}): Promise<HermesBoardsResponse> {
    return this.request(
      'GET',
      pagePath('/control/v1/work/boards', query),
      HermesBoardsResponseSchema,
    );
  }

  tasks(boardId: string, query: PageQuery = {}): Promise<HermesTasksResponse> {
    return this.request(
      'GET',
      pagePath(`/control/v1/work/boards/${segment(boardId)}/tasks`, query),
      HermesTasksResponseSchema,
    );
  }

  cronjobs(query: PageQuery = {}): Promise<HermesCronjobsResponse> {
    return this.request(
      'GET',
      pagePath('/control/v1/work/cronjobs', query),
      HermesCronjobsResponseSchema,
    );
  }

  sessions(query: PageQuery = {}): Promise<HermesSessionsResponse> {
    return this.request(
      'GET',
      pagePath('/control/v1/conversations/sessions', query),
      HermesSessionsResponseSchema,
    );
  }

  messages(sessionId: string, query: PageQuery = {}): Promise<HermesMessagesResponse> {
    return this.request(
      'GET',
      pagePath(`/control/v1/conversations/sessions/${segment(sessionId)}/messages`, query),
      HermesMessagesResponseSchema,
    );
  }

  events(query: PageQuery = {}): Promise<HermesEventsResponse> {
    return this.request('GET', pagePath('/control/v1/events', query), HermesEventsResponseSchema);
  }

  work(command: HermesWorkCommand): Promise<Static<typeof HermesWorkResultSchema>> {
    return this.request('POST', '/control/v1/commands/work', HermesWorkResultSchema, command);
  }

  modelManagement(
    command: HermesModelManagementCommand,
  ): Promise<Static<typeof HermesModelManagementResultSchema>> {
    return this.request(
      'POST',
      '/control/v1/commands/models',
      HermesModelManagementResultSchema,
      command,
      185_000,
    );
  }

  profileManagement(
    command: HermesProfileCommand,
  ): Promise<Static<typeof HermesProfileResultSchema>> {
    return this.request(
      'POST',
      '/control/v1/commands/profiles',
      HermesProfileResultSchema,
      command,
      185_000,
    );
  }

  conversation(
    command: HermesConversationCommand,
  ): Promise<Static<typeof HermesConversationResultSchema>> {
    return this.request(
      'POST',
      '/control/v1/commands/conversations',
      HermesConversationResultSchema,
      command,
      185_000,
    );
  }

  reconcile(command: HermesControlCommand): Promise<HermesReconcileResponse> {
    return this.request(
      'POST',
      '/control/v1/commands/reconcile',
      HermesReconcileResultSchema,
      command,
    );
  }

  private async request<T extends TSchema>(
    method: 'GET' | 'POST',
    path: string,
    schema: T,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<Static<T>> {
    this.assertCircuit();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const result = await this.once(method, path, schema, body, timeoutMs);
        this.failures = 0;
        this.circuitOpenedAt = 0;
        return result;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof HermesControlClientError ? error.retryable : error instanceof Error;
        if (!retryable || attempt === this.retries) break;
        await this.sleep(50 * 2 ** attempt);
      }
    }
    this.recordFailure();
    if (lastError instanceof HermesControlClientError) throw lastError;
    throw new HermesControlClientError(
      'FRAMEWORK_UNAVAILABLE',
      503,
      'Hermes framework is unavailable',
      true,
    );
  }

  private async once<T extends TSchema>(
    method: 'GET' | 'POST',
    path: string,
    schema: T,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<Static<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.options.bearerToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > this.maxResponseBytes)
        throw new HermesControlClientError(
          'FRAMEWORK_RESPONSE_TOO_LARGE',
          502,
          'Hermes response exceeds the configured limit',
        );
      const text = await response.text();
      if (Buffer.byteLength(text) > this.maxResponseBytes)
        throw new HermesControlClientError(
          'FRAMEWORK_RESPONSE_TOO_LARGE',
          502,
          'Hermes response exceeds the configured limit',
        );
      let value: unknown;
      try {
        value = text ? JSON.parse(text) : null;
      } catch {
        throw new HermesControlClientError(
          'FRAMEWORK_CONTRACT_INVALID',
          502,
          'Hermes returned invalid JSON',
        );
      }
      if (!response.ok) {
        if (Value.Check(HermesControlErrorResponseSchema, value))
          throw new HermesControlClientError(
            value.error.code,
            response.status,
            value.error.message,
            value.error.retryable,
          );
        throw new HermesControlClientError(
          'FRAMEWORK_REQUEST_FAILED',
          response.status >= 500 ? 503 : response.status,
          'Hermes rejected the request',
          response.status >= 500,
        );
      }
      if (!Value.Check(schema, value))
        throw new HermesControlClientError(
          'FRAMEWORK_CONTRACT_INVALID',
          502,
          'Hermes returned a response outside the registered contract',
        );
      return value as Static<T>;
    } catch (error) {
      if (error instanceof HermesControlClientError) throw error;
      throw new HermesControlClientError(
        'FRAMEWORK_UNAVAILABLE',
        503,
        'Hermes framework is unavailable',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private assertCircuit() {
    if (!this.circuitOpenedAt) return;
    if (Date.now() - this.circuitOpenedAt >= this.circuitResetMs) {
      this.circuitOpenedAt = 0;
      this.failures = 0;
      return;
    }
    throw new HermesControlClientError(
      'FRAMEWORK_CIRCUIT_OPEN',
      503,
      'Hermes framework circuit is open',
      true,
    );
  }

  private recordFailure() {
    this.failures += 1;
    if (this.failures >= this.circuitFailureThreshold) this.circuitOpenedAt = Date.now();
  }
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
  refresh?: boolean;
}

function pagePath(path: string, query: PageQuery) {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.refresh) params.set('refresh', 'true');
  const value = params.toString();
  return value ? `${path}?${value}` : path;
}

function segment(value: string) {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!value || value.length > 300 || hasControlCharacter)
    throw new HermesControlClientError('INVALID_NATIVE_ID', 400, 'Native identifier is invalid');
  return encodeURIComponent(value);
}
