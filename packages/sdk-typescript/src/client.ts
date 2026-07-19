import type { paths } from './schema.js';

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
}
