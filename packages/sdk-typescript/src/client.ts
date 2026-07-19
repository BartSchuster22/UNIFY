import type { components, paths } from './schema.js';

type MutationRequest = components['schemas']['MutationRequest'];

export interface GatewayClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  csrfToken?: () => string | undefined;
}
export class GatewayClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #csrf: (() => string | undefined) | undefined;
  constructor(options: GatewayClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? '/api/v1';
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#csrf = options.csrfToken;
  }
  async request<Path extends keyof paths & string>(
    path: Path,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    const csrf = this.#csrf?.();
    if (csrf) headers.set('x-csrf-token', csrf);
    headers.set('accept', 'application/json');
    return this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers, credentials: 'include' });
  }
  async executeMutation(body: MutationRequest, idempotencyKey: string): Promise<Response> {
    if (!idempotencyKey.trim()) throw new TypeError('idempotencyKey is required');
    return this.request('/mutations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
  }
  async downloadChatUpload(path: string): Promise<Response> {
    if (!/^\/uploads\/[a-zA-Z0-9._-]+$/.test(path)) throw new TypeError('Invalid Chat upload path');
    const headers = new Headers({ accept: 'application/octet-stream' });
    return this.#fetch(`${this.#baseUrl}/chat/download?path=${encodeURIComponent(path)}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
  }
}
