import { setTimeout as delay } from 'node:timers/promises';
import {
  MEMORY_V4_CONTRACT_VERSION,
  isScopeAllowed,
  type MemoryRoute,
  validateScopePath,
} from './types.js';

type JsonRecord = Record<string, unknown>;

export class MemoryV4AdapterError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface MemoryV4AdapterOptions {
  baseUrl: string;
  bearerToken: string;
  scopePath: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface MemoryV4Request {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  route: MemoryRoute;
  actorUserId: string;
  requestId: string;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
  reason?: string;
}

export interface MemoryV4Result {
  statusCode: number;
  body: unknown;
  contractVersion: string;
  idempotencyReplayed?: string;
}

export class MemoryV4Adapter {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly scopePath: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly retries: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitResetMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private failures = 0;
  private circuitOpenedAt = 0;

  constructor(options: MemoryV4AdapterOptions) {
    const base = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.pathname !== '/' && base.pathname !== '')
    )
      throw new Error('MEMORY_V4_URL must be an HTTP(S) origin without credentials or a path');
    if (base.protocol === 'http:' && !isLoopback(base.hostname))
      throw new Error('MEMORY_V4_URL requires HTTPS except for loopback development');
    if (!options.bearerToken.trim()) throw new Error('MEMORY_V4_TOKEN must not be empty');
    this.scopePath = validateScopePath(options.scopePath);
    this.baseUrl = base.origin;
    this.token = options.bearerToken;
    this.timeoutMs = finitePositive(options.timeoutMs ?? 8_000, 'timeoutMs');
    this.maxResponseBytes = finitePositive(
      options.maxResponseBytes ?? 16 * 1024 * 1024,
      'maxResponseBytes',
    );
    this.retries = finiteNonNegative(options.retries ?? 1, 'retries');
    this.circuitFailureThreshold = finitePositive(
      options.circuitFailureThreshold ?? 3,
      'circuitFailureThreshold',
    );
    this.circuitResetMs = finitePositive(options.circuitResetMs ?? 30_000, 'circuitResetMs');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  }

  async probe(
    actorUserId: string,
    requestId: string,
  ): Promise<{ status: 'ready'; contractVersion: string }> {
    await this.execute({
      method: 'GET',
      path: '/capabilities',
      route: {
        permission: 'memory.read',
        mutation: false,
        injectQueryScope: false,
        injectBodyScope: false,
      },
      actorUserId,
      requestId,
    });
    return { status: 'ready', contractVersion: MEMORY_V4_CONTRACT_VERSION };
  }

  async execute(input: MemoryV4Request): Promise<MemoryV4Result> {
    validateActor(input.actorUserId);
    validateRequestId(input.requestId);
    this.assertCircuit();
    const governed = this.govern(input);
    const canRetry = input.method === 'GET' || Boolean(governed.idempotencyKey);
    let lastError: unknown;
    for (let attempt = 0; attempt <= (canRetry ? this.retries : 0); attempt += 1) {
      try {
        const result = await this.once(governed);
        this.failures = 0;
        this.circuitOpenedAt = 0;
        return result;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof MemoryV4AdapterError ? error.retryable : error instanceof Error;
        if (!retryable || attempt === (canRetry ? this.retries : 0)) break;
        await this.sleep(50 * 2 ** attempt);
      }
    }
    this.recordFailure(lastError);
    if (lastError instanceof MemoryV4AdapterError) throw lastError;
    throw unavailable();
  }

  private govern(input: MemoryV4Request): MemoryV4Request {
    const query = cleanQuery(input.query ?? {});
    let body = input.body;
    if (input.route.injectQueryScope) {
      const requested = scalar(query.scope_path) ?? this.scopePath;
      this.assertScope(requested);
      query.scope_path = requested;
    } else if (query.scope_path !== undefined) {
      this.assertScope(requiredScalar(query.scope_path));
    }
    if (input.route.injectBodyScope) {
      if (!isRecord(body))
        throw new MemoryV4AdapterError(
          'MEMORY_REQUEST_INVALID',
          400,
          'Memory mutation body must be an object',
        );
      const requested = scalar(body.scope_path) ?? this.scopePath;
      this.assertScope(requested);
      body = { ...body, scope_path: requested };
    }
    if (input.route.mutation) {
      if (
        !input.idempotencyKey ||
        input.idempotencyKey.length < 8 ||
        !validHeader(input.idempotencyKey, 200)
      )
        throw new MemoryV4AdapterError(
          'MEMORY_IDEMPOTENCY_REQUIRED',
          428,
          'A valid Idempotency-Key is required',
        );
      if (input.ifMatch !== undefined && !validHeader(input.ifMatch, 100))
        throw new MemoryV4AdapterError('MEMORY_REQUEST_INVALID', 400, 'If-Match is invalid');
      if (input.reason !== undefined && !validHeader(input.reason, 500))
        throw new MemoryV4AdapterError(
          'MEMORY_REQUEST_INVALID',
          400,
          'Memory governance reason is invalid',
        );
    }
    return { ...input, query, body };
  }

  private assertScope(candidate: string): void {
    try {
      if (!isScopeAllowed(candidate, this.scopePath))
        throw new MemoryV4AdapterError(
          'MEMORY_SCOPE_FORBIDDEN',
          403,
          'Requested memory scope is outside the configured UNIFY scope',
        );
    } catch (error) {
      if (error instanceof MemoryV4AdapterError) throw error;
      throw new MemoryV4AdapterError('MEMORY_SCOPE_INVALID', 422, 'Memory scope is invalid');
    }
  }

  private async once(input: MemoryV4Request): Promise<MemoryV4Result> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {})) query.set(key, String(value));
    const suffix = query.size ? `?${query.toString()}` : '';
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${input.path}${suffix}`, {
        method: input.method,
        headers: {
          accept: 'application/json',
          authorization: ['Bearer', this.token].join(' '),
          'x-memoryv4-actor': `unify:${input.actorUserId}`,
          'x-request-id': input.requestId,
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
          ...(input.ifMatch ? { 'if-match': input.ifMatch } : {}),
          ...(input.reason ? { 'x-memoryv4-reason': input.reason } : {}),
        },
        redirect: 'error',
        signal: controller.signal,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > this.maxResponseBytes)
        throw contractError('MemoryV4 response exceeds the configured size limit');
      const text = await response.text();
      if (Buffer.byteLength(text) > this.maxResponseBytes)
        throw contractError('MemoryV4 response exceeds the configured size limit');
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (contentType !== 'application/json') throw contractError('MemoryV4 response is not JSON');
      const contractVersion = response.headers.get('x-memoryv4-contract-version');
      if (contractVersion !== MEMORY_V4_CONTRACT_VERSION)
        throw contractError('MemoryV4 contract version does not match the pinned adapter contract');
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        throw contractError('MemoryV4 returned invalid JSON');
      }
      if (!response.ok) throw upstreamError(response.status, body);
      return {
        statusCode: response.status,
        body,
        contractVersion,
        ...(response.headers.get('idempotency-replayed')
          ? { idempotencyReplayed: response.headers.get('idempotency-replayed')! }
          : {}),
      };
    } catch (error) {
      if (error instanceof MemoryV4AdapterError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private assertCircuit(): void {
    if (!this.circuitOpenedAt) return;
    if (Date.now() - this.circuitOpenedAt >= this.circuitResetMs) {
      this.circuitOpenedAt = 0;
      this.failures = 0;
      return;
    }
    throw new MemoryV4AdapterError(
      'MEMORY_CIRCUIT_OPEN',
      503,
      'MemoryV4 adapter circuit is open',
      true,
    );
  }

  private recordFailure(error: unknown): void {
    if (!(error instanceof MemoryV4AdapterError) || !error.retryable) return;
    this.failures += 1;
    if (this.failures >= this.circuitFailureThreshold) this.circuitOpenedAt = Date.now();
  }
}

function upstreamError(status: number, value: unknown): MemoryV4AdapterError {
  const error = isRecord(value) && isRecord(value.error) ? value.error : {};
  const code = scalar(error.code);
  const message = scalar(error.message);
  if (!code || !message) return contractError('MemoryV4 returned an invalid error envelope');
  const safeStatus = status >= 500 ? 503 : status;
  return new MemoryV4AdapterError(
    code,
    safeStatus,
    message.slice(0, 500),
    status === 429 || status >= 500,
  );
}
function unavailable() {
  return new MemoryV4AdapterError('MEMORY_UNAVAILABLE', 503, 'MemoryV4 is unavailable', true);
}
function contractError(message: string) {
  return new MemoryV4AdapterError('MEMORY_CONTRACT_INVALID', 502, message);
}
function cleanQuery(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
      throw new MemoryV4AdapterError('MEMORY_REQUEST_INVALID', 400, 'Memory query is invalid');
    out[key] = requiredScalar(value);
  }
  return out;
}
function requiredScalar(value: unknown): string {
  const result = scalar(value);
  if (result === undefined || result.length > 1_000 || hasControlCharacter(result))
    throw new MemoryV4AdapterError('MEMORY_REQUEST_INVALID', 400, 'Memory query is invalid');
  return result;
}
function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
}
function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function validateActor(value: string): void {
  if (!validHeader(value, 190))
    throw new MemoryV4AdapterError('MEMORY_ACTOR_INVALID', 400, 'Memory actor is invalid');
}
function validateRequestId(value: string): void {
  if (!validHeader(value, 200))
    throw new MemoryV4AdapterError('MEMORY_REQUEST_INVALID', 400, 'Request identifier is invalid');
}
function validHeader(value: string, max: number): boolean {
  return (
    value === value.trim() && value.length > 0 && value.length <= max && !hasControlCharacter(value)
  );
}
function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
}
function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}
function finiteNonNegative(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 5)
    throw new Error(`${name} must be an integer from 0 to 5`);
  return value;
}
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
