import { CircuitBreaker } from './circuit-breaker.js';
import { AdapterError } from './types.js';
export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  retries?: number;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
  defaultHeaders?: Readonly<Record<string, string>>;
}
export interface HttpRequest {
  method?: string;
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
}
export class ResilientHttpClient {
  readonly #base: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #breaker: CircuitBreaker;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #headers: Readonly<Record<string, string>>;
  constructor(options: HttpClientOptions) {
    this.#base = options.baseUrl.replace(/\/$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 10_000;
    this.#retries = options.retries ?? 2;
    this.#breaker = options.breaker ?? new CircuitBreaker();
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#headers = options.defaultHeaders ?? {};
  }
  async request<T>(input: HttpRequest): Promise<T> {
    this.#breaker.beforeRequest();
    const method = (input.method ?? 'GET').toUpperCase();
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(method) || Boolean(input.idempotencyKey);
    const attempts = safe ? this.#retries + 1 : 1;
    let last: AdapterError | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.once(method, input);
        if (!response.ok) {
          const error = await fromResponse(response);
          if (error.retryable && attempt + 1 < attempts) {
            last = error;
            await this.#sleep(delay(attempt, response.headers.get('retry-after')));
            continue;
          }
          throw error;
        }
        const data = await parse<T>(response);
        this.#breaker.success();
        return data;
      } catch (error) {
        const normalized = normalizeError(error, input.signal);
        if (normalized.category === 'cancelled') {
          this.#breaker.neutral();
          throw normalized;
        }
        if (normalized.retryable && attempt + 1 < attempts) {
          last = normalized;
          await this.#sleep(delay(attempt));
          continue;
        }
        this.#breaker.failure();
        throw normalized;
      }
    }
    this.#breaker.failure();
    throw last ?? new AdapterError('ADAPTER_UNKNOWN', 'unknown', false, 'Adapter request failed');
  }
  private async once(method: string, input: HttpRequest) {
    const timeout = AbortSignal.timeout(input.timeoutMs ?? this.#timeout);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.#headers,
      ...input.headers,
    };
    if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
    let body: string | undefined;
    if (input.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(input.body);
    }
    return this.#fetch(`${this.#base}${input.path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal,
    });
  }
}
async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const content = response.headers.get('content-type') ?? '';
  if (!content.includes('application/json'))
    throw new AdapterError(
      'ADAPTER_PROTOCOL',
      'protocol',
      false,
      'Expected JSON from adapter',
      response.status,
    );
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new AdapterError(
      'ADAPTER_PROTOCOL',
      'protocol',
      false,
      'Adapter returned invalid JSON',
      response.status,
      { cause: error },
    );
  }
}
async function fromResponse(response: Response) {
  let upstreamCode: string | undefined;
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    upstreamCode = body.error?.code;
  } catch {
    upstreamCode = undefined;
  }
  const status = response.status;
  const category =
    status === 401
      ? 'authentication'
      : status === 403
        ? 'authorization'
        : status === 404
          ? 'not_found'
          : status === 409
            ? 'conflict'
            : status === 429
              ? 'rate_limit'
              : status === 408
                ? 'timeout'
                : status >= 500
                  ? 'unavailable'
                  : 'validation';
  return new AdapterError(
    upstreamCode ?? `ADAPTER_HTTP_${status}`,
    category,
    status === 408 || status === 429 || status >= 500,
    `Adapter request failed with HTTP ${status}`,
    status,
  );
}
function normalizeError(error: unknown, caller?: AbortSignal): AdapterError {
  if (error instanceof AdapterError) return error;
  if (caller?.aborted)
    return new AdapterError(
      'ADAPTER_CANCELLED',
      'cancelled',
      false,
      'Adapter request cancelled',
      undefined,
      { cause: error },
    );
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return new AdapterError(
      'ADAPTER_TIMEOUT',
      'timeout',
      true,
      'Adapter request timed out',
      undefined,
      { cause: error },
    );
  return new AdapterError(
    'ADAPTER_UNAVAILABLE',
    'unavailable',
    true,
    'Adapter transport unavailable',
    undefined,
    { cause: error instanceof Error ? error : undefined },
  );
}
function delay(attempt: number, retryAfter?: string | null) {
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 30_000);
  return Math.min(100 * 2 ** attempt, 2_000);
}
