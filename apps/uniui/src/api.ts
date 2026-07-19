import type {
  ApiFailure,
  Collection,
  MutationRequest,
  MutationResponse,
  Principal,
  UnifiedResource,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure,
  ) {
    super(failure.message);
  }
}

function csrfToken(): string | undefined {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith('aquiero_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && init.method && init.method !== 'GET')
    headers.set('x-csrf-token', decodeURIComponent(csrf));
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: ApiFailure };
    throw new ApiError(
      response.status,
      body.error ?? { code: 'REQUEST_FAILED', message: `Request failed (${response.status})` },
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const gateway = {
  me: () => api<Principal>('/auth/me'),
  login: (username: string, password: string) =>
    api<Principal>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, deviceLabel: 'UNIUI browser' }),
    }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  resources: (query: URLSearchParams) => api<Collection<UnifiedResource>>(`/resources?${query}`),
  mutate: (request: MutationRequest, idempotencyKey = crypto.randomUUID()) =>
    api<MutationResponse>('/mutations', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(request),
    }),
  chatDownloadUrl: (path: string) => `/api/v1/chat/download?path=${encodeURIComponent(path)}`,
};
